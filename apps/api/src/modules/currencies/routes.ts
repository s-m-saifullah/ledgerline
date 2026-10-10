import {
  currencyListSchema,
  currencyParamsSchema,
  deleteExchangeRateSchema,
  exchangeRateListQuerySchema,
  exchangeRateListSchema,
  exchangeRateParamsSchema,
  exchangeRateSchema,
  idempotencyKeySchema,
  ledgerParamsSchema,
  pinCurrencySchema,
  pinnedCurrencySchema,
  problemSchema,
  refreshRatesResultSchema,
  refreshRatesSchema,
  setExchangeRateSchema,
  unpinCurrencySchema,
} from "@ledgerline/shared";
import { fromNodeHeaders } from "better-auth/node";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import type { Config } from "../../config";
import type { Database } from "../../db/client";
import { ApiProblem } from "../../lib/problem";
import type { Auth } from "../auth/service";
import { financialWriteIdentity, sendFinancialWrite } from "../writes/http";
import type { RateFetcher } from "./provider";
import {
  deleteRate,
  listCurrencies,
  listRates,
  pinCurrency,
  refreshRates,
  setRate,
  unpinCurrency,
} from "./service";

const errors = {
  400: problemSchema,
  401: problemSchema,
  403: problemSchema,
  404: problemSchema,
  409: problemSchema,
  500: problemSchema,
};
const security = [{ sessionCookie: [] }];
const writeHeaders = z.looseObject({ "idempotency-key": idempotencyKeySchema });

export async function currencyRoutes(
  instance: FastifyInstance,
  {
    db,
    config,
    auth,
    fetchRate,
  }: { db: Database; config: Config; auth: Auth; fetchRate: RateFetcher },
) {
  const app = instance.withTypeProvider<ZodTypeProvider>();
  async function actor(request: FastifyRequest) {
    const session = await auth.api.getSession({
      headers: fromNodeHeaders(request.headers),
    });
    if (!session)
      throw new ApiProblem(401, "Unauthorized", "Sign in to continue.");
    return session.user.id;
  }
  app.get(
    "/api/v1/ledgers/:ledgerId/currencies",
    {
      schema: {
        summary: "List pinned currencies",
        description:
          "Currencies added to the ledger besides its base currency, each with its newest stored rate (the base-currency value of one unit).",
        tags: ["Currencies"],
        security,
        params: ledgerParamsSchema,
        response: { 200: currencyListSchema, ...errors },
      },
    },
    async (request) =>
      listCurrencies(db, await actor(request), request.params.ledgerId),
  );
  app.post(
    "/api/v1/ledgers/:ledgerId/currencies",
    {
      schema: {
        summary: "Add a currency",
        description:
          "Pins a currency. The base currency is always available and cannot be added. Fetch its rates with the refresh endpoint.",
        tags: ["Currencies"],
        security,
        params: ledgerParamsSchema,
        headers: writeHeaders,
        body: pinCurrencySchema,
        response: { 201: pinnedCurrencySchema, ...errors },
      },
    },
    async (request, reply) =>
      sendFinancialWrite(
        reply,
        await pinCurrency(
          db,
          await financialWriteIdentity(auth, config, request),
          request.body,
        ),
      ),
  );
  app.delete(
    "/api/v1/ledgers/:ledgerId/currencies/:currencyId",
    {
      schema: {
        summary: "Remove a currency",
        description:
          "Unpins a currency. Stored rates and existing entries are kept. Requires expectedVersion.",
        tags: ["Currencies"],
        security,
        params: currencyParamsSchema,
        headers: writeHeaders,
        body: unpinCurrencySchema,
        response: { 204: z.null(), ...errors },
      },
    },
    async (request, reply) =>
      sendFinancialWrite(
        reply,
        await unpinCurrency(
          db,
          await financialWriteIdentity(auth, config, request),
          request.params.currencyId,
          request.body,
        ),
      ),
  );
  app.get(
    "/api/v1/ledgers/:ledgerId/exchange-rates",
    {
      schema: {
        summary: "List stored rates for a currency",
        description: "Newest first. Each rate is exact decimal text.",
        tags: ["Currencies"],
        security,
        params: ledgerParamsSchema,
        querystring: exchangeRateListQuerySchema,
        response: { 200: exchangeRateListSchema, ...errors },
      },
    },
    async (request) =>
      listRates(
        db,
        await actor(request),
        request.params.ledgerId,
        request.query.code,
        request.query.limit,
      ),
  );
  app.put(
    "/api/v1/ledgers/:ledgerId/exchange-rates",
    {
      schema: {
        summary: "Set a rate by hand",
        description:
          "Creates the rate for a currency and date (201) or, with expectedVersion, edits it (200). The rate is marked manual and is never overwritten by a fetch.",
        tags: ["Currencies"],
        security,
        params: ledgerParamsSchema,
        headers: writeHeaders,
        body: setExchangeRateSchema,
        response: {
          200: exchangeRateSchema,
          201: exchangeRateSchema,
          ...errors,
        },
      },
    },
    async (request, reply) =>
      sendFinancialWrite(
        reply,
        await setRate(
          db,
          await financialWriteIdentity(auth, config, request),
          request.body,
        ),
      ),
  );
  app.delete(
    "/api/v1/ledgers/:ledgerId/exchange-rates/:rateId",
    {
      schema: {
        summary: "Remove a stored rate",
        description:
          "Removes one stored rate so a later refresh can fetch it again. Requires expectedVersion.",
        tags: ["Currencies"],
        security,
        params: exchangeRateParamsSchema,
        headers: writeHeaders,
        body: deleteExchangeRateSchema,
        response: { 204: z.null(), ...errors },
      },
    },
    async (request, reply) =>
      sendFinancialWrite(
        reply,
        await deleteRate(
          db,
          await financialWriteIdentity(auth, config, request),
          request.params.rateId,
          request.body,
        ),
      ),
  );
  app.post(
    "/api/v1/ledgers/:ledgerId/exchange-rates/refresh",
    {
      schema: {
        summary: "Fetch current rates",
        description:
          "Fetches the newest rate for each pinned currency (or one) from the public rate source, with a fallback source. Only currency codes leave the server. Manual rates are kept. Currencies that could not be fetched are listed in failed; the response is still 200.",
        tags: ["Currencies"],
        security,
        params: ledgerParamsSchema,
        headers: writeHeaders,
        body: refreshRatesSchema,
        response: { 200: refreshRatesResultSchema, ...errors },
      },
    },
    async (request, reply) =>
      sendFinancialWrite(
        reply,
        await refreshRates(
          db,
          await financialWriteIdentity(auth, config, request),
          request.body,
          fetchRate,
        ),
      ),
  );
}
