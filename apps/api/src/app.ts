import helmet from "@fastify/helmet";
import swagger, { type FastifyDynamicSwaggerOptions } from "@fastify/swagger";
import {
  calendarDateSchema,
  expectedVersionSchema,
  idempotencyKeySchema,
  problemSchema,
  usdMoneySchema,
} from "@ledgerline/shared";
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
import { addApiNoStore } from "./lib/api-cache";
import { API_VERSION } from "./lib/api-version";
import { safeErrorFields } from "./lib/error-log";
import { ApiProblem, problem } from "./lib/problem";
import { isQuietRequest } from "./lib/request-log";
import { accountRoutes } from "./modules/accounts/routes";
import { accountGuard } from "./modules/auth/guard";
import { authProxyRoutes } from "./modules/auth/proxy-routes";
import { createAuth } from "./modules/auth/service";
import { sessionRoutes } from "./modules/auth/sessions-routes";
import { budgetRoutes } from "./modules/budgets/routes";
import { categoryRoutes } from "./modules/categories/routes";
import { changeRoutes } from "./modules/changes/routes";
import {
  type RateFetcher,
  rateFetcherFor,
} from "./modules/currencies/provider";
import { currencyRoutes } from "./modules/currencies/routes";
import { exportRoutes } from "./modules/exports/routes";
import { homeRoutes } from "./modules/home/routes";
import { importRoutes } from "./modules/imports/routes";
import { ledgerRoutes } from "./modules/ledgers/routes";
import { loanRoutes } from "./modules/loans/routes";
import { meRoutes } from "./modules/me/routes";
import { receiptRoutes } from "./modules/receivables/receipt-routes";
import { clientRoutes } from "./modules/receivables/routes";
import { recurringRoutes } from "./modules/recurring/routes";
import { reportRoutes } from "./modules/reports/routes";
import { syncRoutes } from "./modules/sync/routes";
import { tagRoutes } from "./modules/tags/routes";
import { transactionRoutes } from "./modules/transactions/routes";
import { transferRoutes } from "./modules/transactions/transfer-routes";
import { userRoutes } from "./modules/users/routes";

export async function buildApp(
  db: Database,
  config: Config,
  {
    fetchRate = rateFetcherFor(config.RATES_ENABLED),
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
      info: { title: "Ledgerline API", version: API_VERSION },
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
  // A person on a temporary password, or whose sign-in was stopped, is refused on every /api/v1 route (ADR 0048).
  app.addHook("onRequest", accountGuard(auth));
  app.setErrorHandler<FastifyError>((error, request, reply) => {
    if (error instanceof ApiProblem)
      return reply
        .code(error.statusCode)
        .type("application/problem+json")
        .send(
          problem(
            error.statusCode,
            error.title,
            error.detail,
            error.errors,
            error.type,
          ),
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
  addApiNoStore(app);
  app.addHook("onResponse", async (request, reply) => {
    if (isQuietRequest(request.url)) return;
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
  await app.register(authProxyRoutes, { db, config, auth });
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
  await app.register(syncRoutes, { db, config, auth });
  await app.register(changeRoutes, { db, auth });
  await app.register(sessionRoutes, { db, config, auth });
  await app.register(meRoutes, { db, config, auth, now });
  await app.register(userRoutes, { db, config, auth });
  await app.register(exportRoutes, { db, config, auth });
  await app.register(importRoutes, { db, config, auth });
  await app.register(tagRoutes, { db, config, auth });
  return app;
}
