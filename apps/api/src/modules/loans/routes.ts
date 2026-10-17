import {
  forgiveLoanSchema,
  idempotencyKeySchema,
  ledgerParamsSchema,
  loanActionParamsSchema,
  loanListSchema,
  loanMoveSchema,
  loanOpeningSchema,
  loanParamsSchema,
  loanPeopleQuerySchema,
  loanPeopleSchema,
  loanResultSchema,
  problemSchema,
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
import {
  forgiveLoan,
  listLoanPeople,
  listLoans,
  moveLoan,
  setLoanOpening,
} from "./service";

const errors = {
  400: problemSchema,
  401: problemSchema,
  403: problemSchema,
  404: problemSchema,
  409: problemSchema,
  500: problemSchema,
};
const writeHeaders = z.looseObject({ "idempotency-key": idempotencyKeySchema });
const bodies = {
  lend: loanMoveSchema,
  borrow: loanMoveSchema,
  repay: loanMoveSchema,
  forgive: forgiveLoanSchema,
  opening: loanOpeningSchema,
};
const summaries = {
  lend: "Lend money to a client",
  borrow: "Borrow money from a client",
  repay: "Record a repayment",
  forgive: "Forgive what is left",
  opening: "Add an existing loan",
};

/** Money lent to or borrowed from clients (ADR 0030). */
export async function loanRoutes(
  instance: FastifyInstance,
  { db, config, auth }: { db: Database; config: Config; auth: Auth },
) {
  const app = instance.withTypeProvider<ZodTypeProvider>();
  async function actor(request: FastifyRequest) {
    const s = await auth.api.getSession({
      headers: fromNodeHeaders(request.headers),
    });
    if (!s) throw new ApiProblem(401, "Unauthorized", "Sign in to continue.");
    return s.user.id;
  }
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
        summary: "Lend, borrow, repay, forgive or add an existing loan",
        description:
          "Action is lend, borrow, repay, forgive or opening. Lend, borrow and repay save an ordinary transfer between one of your accounts and the client's balance account. Forgive writes off the whole open balance as an expense or income entry. Opening sets the balance before Ledgerline without moving money. Idempotency-Key required.",
        tags: ["Clients"],
        security: [{ sessionCookie: [] }],
        params: loanActionParamsSchema,
        headers: writeHeaders,
        body: z.union([loanMoveSchema, forgiveLoanSchema, loanOpeningSchema]),
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
        action === "forgive"
          ? await forgiveLoan(
              db,
              identity,
              contactId,
              forgiveLoanSchema.parse(parsed.data),
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
}
