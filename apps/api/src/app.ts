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
import { createAuth } from "./modules/auth/service";
import { budgetRoutes } from "./modules/budgets/routes";
import { categoryRoutes } from "./modules/categories/routes";
import {
  createRateProvider,
  type RateFetcher,
} from "./modules/currencies/provider";
import { currencyRoutes } from "./modules/currencies/routes";
import { homeRoutes } from "./modules/home/routes";
import { ledgerService } from "./modules/ledgers/service";
import { receiptRoutes } from "./modules/receivables/receipt-routes";
import { peopleRoutes } from "./modules/receivables/routes";
import { transactionRoutes } from "./modules/transactions/routes";
import { transferRoutes } from "./modules/transactions/transfer-routes";

export async function buildApp(
  db: Database,
  config: Config,
  { fetchRate = createRateProvider() }: { fetchRate?: RateFetcher } = {},
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
      info: { title: "Ledgerline API", version: "0.1.23" },
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
    transform: jsonSchemaTransform,
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
  // Expose only the three browser-session endpoints required by Phase 0.
  app.route({
    method: ["GET", "POST"],
    url: "/api/v1/auth/*",
    schema: { hide: true },
    handler: async (request, reply) => {
      const path = new URL(request.url, config.APP_URL).pathname;
      const allowed =
        (request.method === "GET" && path === "/api/v1/auth/get-session") ||
        (request.method === "POST" &&
          ["/api/v1/auth/sign-in/email", "/api/v1/auth/sign-out"].includes(
            path,
          ));
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
          ...(request.body ? { body: JSON.stringify(request.body) } : {}),
        }),
      );
      reply.code(response.status);
      for (const [key, value] of response.headers)
        if (key !== "set-cookie") reply.header(key, value);
      const cookies = response.headers.getSetCookie();
      if (cookies.length) reply.header("set-cookie", cookies);
      if (response.status >= 400)
        return reply
          .type("application/problem+json")
          .send(
            problem(
              response.status,
              "Authentication failed",
              "Check your credentials and try again.",
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
  await app.register(accountRoutes, { db, config, auth });
  await app.register(peopleRoutes, { db, config, auth });
  await app.register(receiptRoutes, { db, config, auth });
  await app.register(categoryRoutes, { db, config, auth });
  await app.register(budgetRoutes, { db, config, auth });
  await app.register(currencyRoutes, { db, config, auth, fetchRate });
  await app.register(transactionRoutes, { db, config, auth });
  await app.register(transferRoutes, { db, config, auth });
  await app.register(homeRoutes, { db, config, auth });
  return app;
}
