import {
  ledgerParamsSchema,
  loanActionParamsSchema,
  loanListSchema,
  loanMoveSchema,
  loanOpeningSchema,
  loanParamsSchema,
  loanPeopleQuerySchema,
  loanPeopleSchema,
  loanResultSchema,
  removeLoanParamsSchema,
  removeLoanSchema,
  waiveLoanSchema,
} from "@ledgerline/shared";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import type { Config } from "../../config";
import type { Database } from "../../db/client";
import { ApiProblem } from "../../lib/problem";
import { createActor, errors, writeHeaders } from "../../lib/route-helpers";
import type { Auth } from "../auth/service";
import { financialWriteIdentity, sendFinancialWrite } from "../writes/http";
import {
  listLoanPeople,
  listLoans,
  moveLoan,
  removeLoan,
  setLoanOpening,
  waiveLoan,
} from "./service";

const bodies = {
  lend: loanMoveSchema,
  borrow: loanMoveSchema,
  repay: loanMoveSchema,
  waive: waiveLoanSchema,
  opening: loanOpeningSchema,
};
const summaries = {
  lend: "Lend money to a client",
  borrow: "Borrow money from a client",
  repay: "Record a repayment",
  waive: "Waive what is left",
  opening: "Add an existing loan",
};

/** Money lent to or borrowed from clients (ADR 0030). */
export async function loanRoutes(
  instance: FastifyInstance,
  { db, config, auth }: { db: Database; config: Config; auth: Auth },
) {
  const app = instance.withTypeProvider<ZodTypeProvider>();
  const actor = createActor(auth);
  app.get(
    "/api/v1/ledgers/:ledgerId/loans",
    {
      schema: {
        summary: "List the people you lend to or borrow from",
        description:
          "People added for loans or holding a loan balance, each with a balance per currency (positive: they owe you; negative: you owe them).",
        tags: ["Clients"],
        security: [{ sessionCookie: [] }],
        params: ledgerParamsSchema,
        querystring: loanPeopleQuerySchema,
        response: { 200: loanPeopleSchema, ...errors },
      },
    },
    async (r) => listLoanPeople(db, await actor(r), r.params.ledgerId, r.query),
  );
  app.get(
    "/api/v1/ledgers/:ledgerId/contacts/:contactId/loans",
    {
      schema: {
        summary: "Get a client's loan balances",
        description:
          "One running balance per currency: positive means the client owes you, negative means you owe the client.",
        tags: ["Clients"],
        security: [{ sessionCookie: [] }],
        params: loanParamsSchema,
        response: { 200: loanListSchema, ...errors },
      },
    },
    async (r) =>
      listLoans(db, await actor(r), r.params.ledgerId, r.params.contactId),
  );
  app.post(
    "/api/v1/ledgers/:ledgerId/contacts/:contactId/loans/:action",
    {
      schema: {
        summary: "Lend, borrow, repay, waive or add an existing loan",
        description:
          "Action is lend, borrow, repay, waive or opening. Lend, borrow and repay save an ordinary transfer between one of your accounts and the client's balance account. Waive writes off the whole open balance as an expense or income entry. Opening sets the balance before Ledgerline without moving money. Idempotency-Key required.",
        tags: ["Clients"],
        security: [{ sessionCookie: [] }],
        params: loanActionParamsSchema,
        headers: writeHeaders,
        body: z.union([loanMoveSchema, waiveLoanSchema, loanOpeningSchema]),
        response: { 200: loanResultSchema, 201: loanResultSchema, ...errors },
      },
    },
    async (r, reply) => {
      const identity = await financialWriteIdentity(auth, config, r);
      const { contactId, action } = r.params;
      const parsed = bodies[action].safeParse(r.body);
      if (!parsed.success)
        throw new ApiProblem(
          400,
          "Invalid request",
          `That is not a valid ${summaries[action].toLowerCase()} request.`,
          parsed.error.issues.map((issue) => ({
            field: issue.path.join("."),
            message: issue.message,
          })),
        );
      const result =
        action === "waive"
          ? await waiveLoan(
              db,
              identity,
              contactId,
              waiveLoanSchema.parse(parsed.data),
            )
          : action === "opening"
            ? await setLoanOpening(
                db,
                identity,
                contactId,
                loanOpeningSchema.parse(parsed.data),
              )
            : await moveLoan(
                db,
                identity,
                contactId,
                action,
                loanMoveSchema.parse(parsed.data),
              );
      return sendFinancialWrite(reply, result);
    },
  );
  app.delete(
    "/api/v1/ledgers/:ledgerId/contacts/:contactId/loans/:accountId",
    {
      schema: {
        summary: "Remove a loan",
        description:
          "Soft-deletes a client's balance account for one currency, with its starting balance, so the loan disappears from the client, Home and net worth. Refused with 409 while any entry (lend, borrow, repayment, waiver) still uses it: delete those entries first. Requires expectedVersion. Idempotency-Key required; same-key retries replay 204.",
        tags: ["Clients"],
        security: [{ sessionCookie: [] }],
        params: removeLoanParamsSchema,
        headers: writeHeaders,
        body: removeLoanSchema,
        response: { 204: z.null(), ...errors },
      },
    },
    async (r, reply) =>
      sendFinancialWrite(
        reply,
        await removeLoan(
          db,
          await financialWriteIdentity(auth, config, r),
          r.params.contactId,
          r.params.accountId,
          r.body,
        ),
      ),
  );
}
