import {
  createTransactionSchema,
  deleteTransactionSchema,
  idempotencyKeySchema,
  ledgerParamsSchema,
  problemSchema,
  restoreTransactionSchema,
  transactionListQuerySchema,
  transactionListSchema,
  transactionParamsSchema,
  transactionSchema,
  updateTransactionSchema,
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
  createTransaction,
  deleteTransaction,
  getTransaction,
  listTransactions,
  restoreTransaction,
  updateTransaction,
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
// Preserve cookies/origin while validating and documenting the write key.
const writeHeaders = z.looseObject({ "idempotency-key": idempotencyKeySchema });

export async function transactionRoutes(
  instance: FastifyInstance,
  { db, config, auth }: { db: Database; config: Config; auth: Auth },
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
    "/api/v1/ledgers/:ledgerId/transactions",
    {
      schema: {
        summary: "List transactions",
        description:
          "Lists non-deleted entries by date descending, then UUID descending. Cursors contain the date and ID; retain the same filters for subsequent pages. Date bounds are inclusive. Text is a case-insensitive literal substring of payee or note. Pending entries do not affect posted balances. Split parents appear once; categoryId filters match any active allocation. Responses include ordered split lines.",
        tags: ["Transactions"],
        security,
        params: ledgerParamsSchema,
        querystring: transactionListQuerySchema,
        response: { 200: transactionListSchema, ...errors },
      },
    },
    async (request) =>
      listTransactions(
        db,
        await actor(request),
        request.params.ledgerId,
        request.query,
      ),
  );
  app.get(
    "/api/v1/ledgers/:ledgerId/transactions/:transactionId",
    {
      schema: {
        summary: "Get a transaction",
        tags: ["Transactions"],
        security,
        params: transactionParamsSchema,
        response: { 200: transactionSchema, ...errors },
      },
    },
    async (request) =>
      getTransaction(
        db,
        await actor(request),
        request.params.ledgerId,
        request.params.transactionId,
      ),
  );
  app.post(
    "/api/v1/ledgers/:ledgerId/transactions",
    {
      schema: {
        summary: "Create a transaction",
        description:
          "Optional splits contain 2–50 same-direction USD category lines totaling the parent exactly, with categoryId null. New lines omit IDs. Parent and lines commit atomically. Expense amounts are negative; income amounts are positive. Zero is rejected. USD-only: fxRate is 1 and baseAmount equals amount. Requires active same-ledger account/category references, an owner/editor session and a trusted browser Origin.",
        tags: ["Transactions"],
        security,
        params: ledgerParamsSchema,
        headers: writeHeaders,
        body: createTransactionSchema,
        response: { 201: transactionSchema, ...errors },
      },
    },
    async (request, reply) =>
      sendFinancialWrite(
        reply,
        await createTransaction(
          db,
          await financialWriteIdentity(auth, config, request),
          request.body,
        ),
      ),
  );
  app.patch(
    "/api/v1/ledgers/:ledgerId/transactions/:transactionId",
    {
      schema: {
        summary: "Edit a transaction",
        description:
          "Supplied splits replace the complete allocation; retained IDs must belong to current lines. Omitted splits preserve allocations; null removes them and requires an ordinary categoryId. All live lines share the parent version. Partial correction requires expectedVersion. Existing archived account/category assignments may be retained; new assignments must be active. The complete resulting entry must have the correct sign and category kind. Transfer legs cannot be edited here.",
        tags: ["Transactions"],
        security,
        params: transactionParamsSchema,
        headers: writeHeaders,
        body: updateTransactionSchema,
        response: { 200: transactionSchema, ...errors },
      },
    },
    async (request, reply) =>
      sendFinancialWrite(
        reply,
        await updateTransaction(
          db,
          await financialWriteIdentity(auth, config, request),
          request.params.transactionId,
          request.body,
        ),
      ),
  );
  app.delete(
    "/api/v1/ledgers/:ledgerId/transactions/:transactionId",
    {
      schema: {
        summary: "Delete a transaction",
        description:
          "Atomically soft-deletes the parent and its current split lines. Soft-deletes the transaction and removes its posted balance effect. Requires expectedVersion. Same-key retries replay 204; new actions on deleted targets return 404. Transfer legs cannot be deleted here.",
        tags: ["Transactions"],
        security,
        params: transactionParamsSchema,
        headers: writeHeaders,
        body: deleteTransactionSchema,
        response: { 204: z.null(), ...errors },
      },
    },
    async (request, reply) =>
      sendFinancialWrite(
        reply,
        await deleteTransaction(
          db,
          await financialWriteIdentity(auth, config, request),
          request.params.transactionId,
          request.body,
        ),
      ),
  );
  app.post(
    "/api/v1/ledgers/:ledgerId/transactions/:transactionId/restore",
    {
      schema: {
        summary: "Restore a deleted transaction",
        description:
          "Restores the same transaction with its historical references and a new version. Requires the deleted version, owner/editor access, a trusted Origin and an idempotency key. Archived references may be retained; tombstoned references and independent transfer legs cannot be restored. Posted balance overflow rolls back restoration.",
        tags: ["Transactions"],
        security,
        params: transactionParamsSchema,
        headers: writeHeaders,
        body: restoreTransactionSchema,
        response: { 200: transactionSchema, ...errors },
      },
    },
    async (request, reply) =>
      sendFinancialWrite(
        reply,
        await restoreTransaction(
          db,
          await financialWriteIdentity(auth, config, request),
          request.params.transactionId,
          request.body,
        ),
      ),
  );
}
