import helmet from "@fastify/helmet";
import swagger, { type FastifyDynamicSwaggerOptions } from "@fastify/swagger";
import {
  calendarDateSchema,
  expectedVersionSchema,
  idempotencyKeySchema,
  idSchema,
  ledgerSchema,
  problemSchema,
  usdMoneySchema,
} from "@ledgerline/shared";
import { fromNodeHeaders } from "better-auth/node";
import { sql } from "drizzle-orm";
import Fastify, { type FastifyError, LogController } from "fastify";
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from "fastify-type-provider-zod";
import { z } from "zod";
import type { Config } from "./config";
import type { Database } from "./db/client";
import { safeErrorFields } from "./lib/error-log";
import { ApiProblem, problem } from "./lib/problem";
import { accountRoutes } from "./modules/accounts/routes";
import { mayReceiveDeviceToken } from "./modules/auth/device-token";
import { createAuth } from "./modules/auth/service";
import { budgetRoutes } from "./modules/budgets/routes";
import { categoryRoutes } from "./modules/categories/routes";
import {
  createRateProvider,
  type RateFetcher,
} from "./modules/currencies/provider";
import { currencyRoutes } from "./modules/currencies/routes";
import { exportRoutes } from "./modules/exports/routes";
import { homeRoutes } from "./modules/home/routes";
import { importRoutes } from "./modules/imports/routes";
import { ledgerRoutes } from "./modules/ledgers/routes";
import { ledgerService } from "./modules/ledgers/service";
import { loanRoutes } from "./modules/loans/routes";
import { receiptRoutes } from "./modules/receivables/receipt-routes";
import { clientRoutes } from "./modules/receivables/routes";
import { recurringRoutes } from "./modules/recurring/routes";
import { reportRoutes } from "./modules/reports/routes";
import { tagRoutes } from "./modules/tags/routes";
import { transactionRoutes } from "./modules/transactions/routes";
import { transferRoutes } from "./modules/transactions/transfer-routes";

/** The two-factor routes the browser may call (ADR 0038); every other auth route stays disabled. */
const twoFactorPaths = [
  "/api/v1/auth/two-factor/enable",
  "/api/v1/auth/two-factor/verify-totp",
  "/api/v1/auth/two-factor/verify-backup-code",
  "/api/v1/auth/two-factor/generate-backup-codes",
  "/api/v1/auth/two-factor/disable",
];

export async function buildApp(
  db: Database,
  config: Config,
  {
    fetchRate = createRateProvider(),
    now = () => new Date(),
  }: { fetchRate?: RateFetcher; now?: () => Date } = {},
) {
  // Deliberately log only request IDs, methods and status; URLs may contain private filters.
  const app = Fastify({
    logger: config.NODE_ENV === "test" ? false : { level: "info" },
    logController: new LogController({ disableRequestLogging: true }),
    bodyLimit: 1024 * 1024,
  }).withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  await app.register(helmet);
  await app.register(swagger, {
    openapi: {
      openapi: "3.1.0",
      info: { title: "Ledgerline API", version: "0.1.46" },
      components: {
        schemas: {
          UsdMoney: z.toJSONSchema(usdMoneySchema),
          CalendarDate: z.toJSONSchema(calendarDateSchema),
          ExpectedVersion: z.toJSONSchema(expectedVersionSchema),
        },
        parameters: {
          IdempotencyKey: {
            name: "Idempotency-Key",
            in: "header",
            required: true,
            description:
              "Financial writes use one key per user intent, retained for retries. Keys are scoped to actor and ledger; reuse with another request returns 409.",
            schema: z.toJSONSchema(idempotencyKeySchema),
          },
        },
        securitySchemes: {
          bearerAuth: {
            type: "http",
            scheme: "bearer",
            description:
              "The Android app's session token (the `set-auth-token` header of a sign-in that sends `X-Ledgerline-Client: android`). Send it as `Authorization: Bearer <token>` together with `Origin` set to the app address.",
          },
          sessionCookie: {
            type: "apiKey",
            in: "cookie",
            name: "__Secure-better-auth.session_token",
            description:
              "HTTPS production session cookie. Local development uses better-auth.session_token.",
          },
        },
      },
    } as NonNullable<FastifyDynamicSwaggerOptions["openapi"]>, // Zod emits JSON Schema 2020-12, supported by OpenAPI 3.1.
    transform: (route) => {
      const result = jsonSchemaTransform(route);
      // CSV downloads are not JSON: describe the 200 response as text/csv.
      const response = (
        result.schema as { response?: Record<string, unknown> } | undefined
      )?.response;
      if (route.url.endsWith(".csv") && response?.["200"])
        response["200"] = {
          description: (response["200"] as { description?: string })
            .description,
          content: { "text/csv": { schema: { type: "string" } } },
        };
      return result;
    },
  });
  const auth = createAuth(db, config);
  app.setErrorHandler<FastifyError>((error, request, reply) => {
    if (error instanceof ApiProblem)
      return reply
        .code(error.statusCode)
        .type("application/problem+json")
        .send(
          problem(error.statusCode, error.title, error.detail, error.errors),
        );
    const status = error.validation
      ? 400
      : error.statusCode && error.statusCode < 500
        ? error.statusCode
        : 500;
    if (status === 500)
      app.log.error(
        {
          code: "INTERNAL_ERROR",
          requestId: request.id,
          ...safeErrorFields(error),
        },
        "Request failed",
      );
    reply
      .code(status)
      .type("application/problem+json")
      .send(
        problem(
          status,
          status === 400
            ? "Invalid request"
            : status === 500
              ? "Internal server error"
              : "Request failed",
          status === 400
            ? "Check the request fields."
            : status === 500
              ? "Please try again later."
              : "The request could not be completed.",
          error.validation?.map((issue) => ({
            field:
              [
                error.validationContext,
                issue.instancePath.replace(/^\//, "").replaceAll("/", "."),
              ]
                .filter(Boolean)
                .join(".") || "request",
            message: "Check this field.",
          })) ?? [],
        ),
      );
  });
  app.setNotFoundHandler((_request, reply) =>
    reply
      .code(404)
      .type("application/problem+json")
      .send(problem(404, "Not found", "The requested resource was not found.")),
  );
  app.addHook("onResponse", async (request, reply) => {
    app.log.info(
      {
        requestId: request.id,
        method: request.method,
        status: reply.statusCode,
      },
      "Request completed",
    );
  });
  app.get(
    "/api/health",
    {
      schema: {
        response: {
          200: z.object({ status: z.literal("ok") }),
          503: problemSchema,
        },
      },
    },
    async (_request, reply) => {
      try {
        await db.execute(sql`SELECT 1`);
        return reply.send({ status: "ok" });
      } catch {
        return reply
          .code(503)
          .type("application/problem+json")
          .send(problem(503, "Unavailable", "Database is not ready."));
      }
    },
  );
  app.get("/api/v1/openapi.json", { schema: { hide: true } }, async () =>
    app.swagger(),
  );
  // Expose only the browser-session endpoints (Phase 0) and the two-factor routes of ADR 0038.
  app.route({
    method: ["GET", "POST"],
    url: "/api/v1/auth/*",
    schema: { hide: true },
    handler: async (request, reply) => {
      const path = new URL(request.url, config.APP_URL).pathname;
      const allowed =
        (request.method === "GET" && path === "/api/v1/auth/get-session") ||
        (request.method === "POST" &&
          [
            "/api/v1/auth/sign-in/email",
            "/api/v1/auth/sign-out",
            ...twoFactorPaths,
          ].includes(path));
      if (!allowed)
        return reply
          .code(404)
          .type("application/problem+json")
          .send(
            problem(
              404,
              "Not found",
              "This authentication endpoint is disabled.",
            ),
          );
      if (
        request.method === "POST" &&
        request.headers.origin !== new URL(config.APP_URL).origin
      ) {
        return reply
          .code(403)
          .type("application/problem+json")
          .send(problem(403, "Forbidden", "Request origin is not allowed."));
      }
      const response = await auth.handler(
        new Request(new URL(request.url, config.APP_URL), {
          method: request.method,
          headers: fromNodeHeaders(request.headers),
          ...(request.body
            ? {
                // No trusted-device cookie (ADR 0038): the verify routes never get to set one.
                body: JSON.stringify(
                  path.startsWith("/api/v1/auth/two-factor/verify-")
                    ? { ...(request.body as object), trustDevice: false }
                    : request.body,
                ),
              }
            : {}),
        }),
      );
      reply.code(response.status);
      // The bearer plugin adds the session token to the response whenever it sets the session cookie; only the
      // Android app may see it (ADR 0042), so a browser's JavaScript never gets the token behind its cookie.
      const sendToken = mayReceiveDeviceToken(
        request.headers,
        request.method,
        path,
      );
      for (const [key, value] of response.headers) {
        if (key === "set-cookie") continue;
        if (
          !sendToken &&
          (key === "set-auth-token" || key === "access-control-expose-headers")
        )
          continue;
        reply.header(key, value);
      }
      const cookies = response.headers.getSetCookie();
      if (cookies.length) reply.header("set-cookie", cookies);
      if (response.status >= 400)
        return reply
          .type("application/problem+json")
          .send(
            problem(
              response.status,
              "Authentication failed",
              response.status === 429
                ? "Too many attempts. Wait a few minutes and try again."
                : "Check your credentials and try again.",
            ),
          );
      return reply.send(await response.text());
    },
  });
  const errors = { 401: problemSchema, 404: problemSchema };
  app.get(
    "/api/v1/ledgers",
    {
      schema: {
        security: [{ sessionCookie: [] }],
        response: {
          200: z.object({ items: z.array(ledgerSchema) }),
          ...errors,
        },
      },
    },
    async (request, reply) => {
      const session = await auth.api.getSession({
        headers: fromNodeHeaders(request.headers),
      });
      if (!session)
        return reply
          .code(401)
          .type("application/problem+json")
          .send(problem(401, "Unauthorized", "Sign in to continue."));
      return { items: await ledgerService(db, session.user.id).list() };
    },
  );
  app.get(
    "/api/v1/ledgers/:ledgerId",
    {
      schema: {
        security: [{ sessionCookie: [] }],
        params: z.object({ ledgerId: idSchema }),
        response: { 200: ledgerSchema, ...errors },
      },
    },
    async (request, reply) => {
      const session = await auth.api.getSession({
        headers: fromNodeHeaders(request.headers),
      });
      if (!session)
        return reply
          .code(401)
          .type("application/problem+json")
          .send(problem(401, "Unauthorized", "Sign in to continue."));
      const ledger = await ledgerService(db, session.user.id).find(
        request.params.ledgerId,
      );
      if (!ledger)
        return reply
          .code(404)
          .type("application/problem+json")
          .send(problem(404, "Not found", "Ledger not found."));
      return ledger;
    },
  );
  await app.register(ledgerRoutes, { db, config, auth });
  await app.register(accountRoutes, { db, config, auth });
  await app.register(clientRoutes, { db, config, auth });
  await app.register(loanRoutes, { db, config, auth });
  await app.register(receiptRoutes, { db, config, auth });
  await app.register(categoryRoutes, { db, config, auth });
  await app.register(recurringRoutes, { db, config, auth, now });
  await app.register(budgetRoutes, { db, config, auth });
  await app.register(currencyRoutes, { db, config, auth, fetchRate });
  await app.register(transactionRoutes, { db, config, auth });
  await app.register(transferRoutes, { db, config, auth });
  await app.register(homeRoutes, { db, config, auth });
  await app.register(reportRoutes, { db, config, auth });
  await app.register(exportRoutes, { db, config, auth });
  await app.register(importRoutes, { db, config, auth });
  await app.register(tagRoutes, { db, config, auth });
  return app;
}
