import {
  budgetCopyResultSchema,
  budgetMonthQuerySchema,
  budgetMonthSchemaView,
  budgetParamsSchema,
  budgetSchema,
  copyBudgetsSchema,
  deleteBudgetSchema,
  ledgerParamsSchema,
  setBudgetSchema,
} from "@ledgerline/shared";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import type { Config } from "../../config";
import type { Database } from "../../db/client";
import { createActor, errors, writeHeaders } from "../../lib/route-helpers";
import type { Auth } from "../auth/service";
import { financialWriteIdentity, sendFinancialWrite } from "../writes/http";
import {
  copyBudgets,
  deleteBudget,
  getBudgetMonth,
  setBudget,
} from "./service";

const security = [{ sessionCookie: [] }];

export async function budgetRoutes(
  instance: FastifyInstance,
  { db, config, auth }: { db: Database; config: Config; auth: Auth },
) {
  const app = instance.withTypeProvider<ZodTypeProvider>();
  const actor = createActor(auth);
  app.get(
    "/api/v1/ledgers/:ledgerId/budgets",
    {
      schema: {
        summary: "Get a month of budgets",
        description:
          "One line per top-level expense category with its budget, the leftover carried in from earlier months (computed, never stored), cleared spending this month including subcategories, and the amount left. Amounts are in the ledger's base currency.",
        tags: ["Budgets"],
        security,
        params: ledgerParamsSchema,
        querystring: budgetMonthQuerySchema,
        response: { 200: budgetMonthSchemaView, ...errors },
      },
    },
    async (request) =>
      getBudgetMonth(
        db,
        await actor(request),
        request.params.ledgerId,
        request.query.month,
      ),
  );
  app.put(
    "/api/v1/ledgers/:ledgerId/budgets",
    {
      schema: {
        summary: "Set a category's budget for a month",
        description:
          "Creates the budget (201) when expectedVersion is omitted, or edits the existing one (200) when it is given. Budgets live on active top-level expense categories. Requires owner/editor permission, a trusted Origin and an Idempotency-Key.",
        tags: ["Budgets"],
        security,
        params: ledgerParamsSchema,
        headers: writeHeaders,
        body: setBudgetSchema,
        response: { 200: budgetSchema, 201: budgetSchema, ...errors },
      },
    },
    async (request, reply) =>
      sendFinancialWrite(
        reply,
        await setBudget(
          db,
          await financialWriteIdentity(auth, config, request),
          request.body,
        ),
      ),
  );
  app.post(
    "/api/v1/ledgers/:ledgerId/budgets/copy",
    {
      schema: {
        summary: "Copy one month's budgets into another",
        description:
          "Creates budgets in the target month for categories that have one in the source month and none yet in the target. Archived categories are skipped. Returns the created budgets.",
        tags: ["Budgets"],
        security,
        params: ledgerParamsSchema,
        headers: writeHeaders,
        body: copyBudgetsSchema,
        response: { 201: budgetCopyResultSchema, ...errors },
      },
    },
    async (request, reply) =>
      sendFinancialWrite(
        reply,
        await copyBudgets(
          db,
          await financialWriteIdentity(auth, config, request),
          request.body,
        ),
      ),
  );
  app.delete(
    "/api/v1/ledgers/:ledgerId/budgets/:budgetId",
    {
      schema: {
        summary: "Remove a budget",
        description:
          "Soft-deletes the month's budget for a category. Requires expectedVersion. Later months' rollover recomputes automatically.",
        tags: ["Budgets"],
        security,
        params: budgetParamsSchema,
        headers: writeHeaders,
        body: deleteBudgetSchema,
        response: { 204: z.null(), ...errors },
      },
    },
    async (request, reply) =>
      sendFinancialWrite(
        reply,
        await deleteBudget(
          db,
          await financialWriteIdentity(auth, config, request),
          request.params.budgetId,
          request.body,
        ),
      ),
  );
}
