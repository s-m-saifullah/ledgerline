import {
  cashFlowReportQuerySchema,
  cashFlowReportSchema,
  netWorthReportQuerySchema,
  netWorthReportSchema,
  reportParamsSchema,
  spendingReportQuerySchema,
  spendingReportSchema,
} from "@ledgerline/shared";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import type { Config } from "../../config";
import type { Database } from "../../db/client";
import { createActor, readErrors, security } from "../../lib/route-helpers";
import type { Auth } from "../auth/service";
import {
  getCashFlowReport,
  getNetWorthReport,
  getSpendingReport,
} from "./service";

export async function reportRoutes(
  instance: FastifyInstance,
  { db, auth }: { db: Database; config: Config; auth: Auth },
) {
  const app = instance.withTypeProvider<ZodTypeProvider>();
  const actor = createActor(auth);
  app.get(
    "/api/v1/ledgers/:ledgerId/reports/spending",
    {
      schema: {
        summary: "Spending by category for a month",
        description:
          "Read-only. Cleared spending for one calendar month (YYYY-MM) in the base currency, using each entry's frozen base amount, grouped by category with subcategories rolled up into their parent (largest first). Split entries count by line. Pending entries, deleted entries and transfers are excluded; transfer fees count as spending. Shares are rounded basis points.",
        tags: ["Reports"],
        security,
        params: reportParamsSchema,
        querystring: spendingReportQuerySchema,
        response: { 200: spendingReportSchema, ...readErrors },
      },
    },
    async (request) =>
      getSpendingReport(
        db,
        await actor(request),
        request.params.ledgerId,
        request.query.month,
      ),
  );
  app.get(
    "/api/v1/ledgers/:ledgerId/reports/cash-flow",
    {
      schema: {
        summary: "Income, spending and net by month",
        description:
          "Read-only. Cleared income and spending for each of the last `months` calendar months ending at `to` (YYYY-MM; default 12, at most 24), oldest first, with months that have no entries as zeros. Uses the same rows as Home's money in and out, so a month's figures equal Home's for that month. Transfers and pending entries are excluded.",
        tags: ["Reports"],
        security,
        params: reportParamsSchema,
        querystring: cashFlowReportQuerySchema,
        response: { 200: cashFlowReportSchema, ...readErrors },
      },
    },
    async (request) =>
      getCashFlowReport(
        db,
        await actor(request),
        request.params.ledgerId,
        request.query.to,
        request.query.months,
      ),
  );
  app.get(
    "/api/v1/ledgers/:ledgerId/reports/net-worth",
    {
      schema: {
        summary: "Net worth at the end of each month",
        description:
          "Read-only. Net worth in the base currency at the end of each of the last `months` calendar months ending at `to` (YYYY-MM; default 12, at most 24), oldest first. A point is every account's opening balance plus its cleared, live entries dated on or before that day (transfers count on each account; pending and deleted entries do not), valued at the newest stored rate on or before that day. The accounts are the same as Home's net worth (archived and client loan accounts included). A currency with no stored rate on or before a point leaves its accounts out of that point and is named in `unconvertedCurrencies`; a later rate is never borrowed. The current month's point is as of today (`asOf`).",
        tags: ["Reports"],
        security,
        params: reportParamsSchema,
        querystring: netWorthReportQuerySchema,
        response: { 200: netWorthReportSchema, ...readErrors },
      },
    },
    async (request) =>
      getNetWorthReport(
        db,
        await actor(request),
        request.params.ledgerId,
        request.query.to,
        request.query.months,
      ),
  );
}
