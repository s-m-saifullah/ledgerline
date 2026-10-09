import {
  accountListQuerySchema,
  accountListSchema,
  accountParamsSchema,
  accountSchema,
  archiveAccountSchema,
  createAccountSchema,
  deleteAccountSchema,
  idempotencyKeySchema,
  ledgerParamsSchema,
  problemSchema,
  updateAccountSchema,
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
  archiveAccount,
  createAccount,
  deleteAccount,
  getAccount,
  listAccounts,
  unarchiveAccount,
  updateAccount,
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

export async function accountRoutes(
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
    "/api/v1/ledgers/:ledgerId/accounts",
    {
      schema: {
        summary: "List accounts",
        description:
          "Includes archived accounts by default. Filter status=active for new-entry pickers. UUIDv7 cursors page in ascending ID order.",
        tags: ["Accounts"],
        security,
        params: ledgerParamsSchema,
        querystring: accountListQuerySchema,
        response: { 200: accountListSchema, ...errors },
      },
    },
    async (request) =>
      listAccounts(
        db,
        await actor(request),
        request.params.ledgerId,
        request.query,
      ),
  );
  app.get(
    "/api/v1/ledgers/:ledgerId/accounts/:accountId",
    {
      schema: {
        summary: "Get an account",
        tags: ["Accounts"],
        security,
        params: accountParamsSchema,
        response: { 200: accountSchema, ...errors },
      },
    },
    async (request) =>
      getAccount(
        db,
        await actor(request),
        request.params.ledgerId,
        request.params.accountId,
      ),
  );
  app.post(
    "/api/v1/ledgers/:ledgerId/accounts",
    {
      schema: {
        summary: "Create an account",
        description:
          "Opening balance is signed USD cents before recorded history. Debt is negative; credit is positive. Requires an owner/editor session and a trusted browser Origin.",
        tags: ["Accounts"],
        security,
        params: ledgerParamsSchema,
        headers: writeHeaders,
        body: createAccountSchema,
        response: { 201: accountSchema, ...errors },
      },
    },
    async (request, reply) =>
      sendFinancialWrite(
        reply,
        await createAccount(
          db,
          await financialWriteIdentity(auth, config, request),
          request.body,
        ),
      ),
  );
  app.patch(
    "/api/v1/ledgers/:ledgerId/accounts/:accountId",
    {
      schema: {
        summary: "Edit an account",
        description:
          "Requires expectedVersion from the latest account. Editing an archived account preserves its archive state. Currency is USD-only in Phase 1.",
        tags: ["Accounts"],
        security,
        params: accountParamsSchema,
        headers: writeHeaders,
        body: updateAccountSchema,
        response: { 200: accountSchema, ...errors },
      },
    },
    async (request, reply) =>
      sendFinancialWrite(
        reply,
        await updateAccount(
          db,
          await financialWriteIdentity(auth, config, request),
          request.params.accountId,
          request.body,
        ),
      ),
  );
  app.post(
    "/api/v1/ledgers/:ledgerId/accounts/:accountId/archive",
    {
      schema: {
        summary: "Archive an account",
        description:
          "Retains the account and its balance/history. Requires expectedVersion. Reusing the same key replays the original result; a new action on an already archived account conflicts.",
        tags: ["Accounts"],
        security,
        params: accountParamsSchema,
        headers: writeHeaders,
        body: archiveAccountSchema,
        response: { 200: accountSchema, ...errors },
      },
    },
    async (request, reply) =>
      sendFinancialWrite(
        reply,
        await archiveAccount(
          db,
          await financialWriteIdentity(auth, config, request),
          request.params.accountId,
          request.body,
        ),
      ),
  );
  app.post(
    "/api/v1/ledgers/:ledgerId/accounts/:accountId/unarchive",
    {
      schema: {
        summary: "Unarchive an account",
        description:
          "Makes an archived account available for new entries again; identity, balance and history are unchanged. Requires expectedVersion. Reusing the same key replays the original result; a new action on an account that is not archived conflicts.",
        tags: ["Accounts"],
        security,
        params: accountParamsSchema,
        headers: writeHeaders,
        body: archiveAccountSchema,
        response: { 200: accountSchema, ...errors },
      },
    },
    async (request, reply) =>
      sendFinancialWrite(
        reply,
        await unarchiveAccount(
          db,
          await financialWriteIdentity(auth, config, request),
          request.params.accountId,
          request.body,
        ),
      ),
  );
  app.delete(
    "/api/v1/ledgers/:ledgerId/accounts/:accountId",
    {
      schema: {
        summary: "Delete an account",
        description:
          "Soft-deletes an active or archived account only after all connected transactions, including pending entries and transfer legs, are deleted. Requires expectedVersion. Deleted entries retain this reference ID; their Undo fails while the account is deleted. Removes its opening balance from ledger totals. Same-key retries replay 204.",
        tags: ["Accounts"],
        security,
        params: accountParamsSchema,
        headers: writeHeaders,
        body: deleteAccountSchema,
        response: { 204: z.null(), ...errors },
      },
    },
    async (request, reply) =>
      sendFinancialWrite(
        reply,
        await deleteAccount(
          db,
          await financialWriteIdentity(auth, config, request),
          request.params.accountId,
          request.body,
        ),
      ),
  );
}
