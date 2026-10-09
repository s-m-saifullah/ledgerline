import {
  createTransferSchema,
  idempotencyKeySchema,
  ledgerParamsSchema,
  problemSchema,
  transferParamsSchema,
  transferSchema,
  transferVersionSchema,
  updateTransferSchema,
} from "@ledgerline/shared";
import { fromNodeHeaders } from "better-auth/node";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import type { Config } from "../../config";
import type { Database } from "../../db/client";
import { ApiProblem } from "../../lib/problem";
import type { Auth } from "../auth/service";
import { financialWriteIdentity, sendFinancialWrite } from "../writes/http";
import {
  createTransfer,
  getTransfer,
  transferLifecycle,
  updateTransfer,
} from "./transfer-service";
export async function transferRoutes(
  instance: FastifyInstance,
  { db, config, auth }: { db: Database; config: Config; auth: Auth },
) {
  const app = instance.withTypeProvider<ZodTypeProvider>();
  const errors = {
    400: problemSchema,
    401: problemSchema,
    403: problemSchema,
    404: problemSchema,
    409: problemSchema,
    500: problemSchema,
  };
  const common = {
    tags: ["Transfers"],
    security: [{ sessionCookie: [] }],
    params: transferParamsSchema,
  };
  const headers = z.looseObject({ "idempotency-key": idempotencyKeySchema });
  app.get(
    "/api/v1/ledgers/:ledgerId/transfers/:transferId",
    {
      schema: {
        ...common,
        summary: "Get a transfer",
        response: { 200: transferSchema, ...errors },
      },
    },
    async (request) => {
      const session = await auth.api.getSession({
        headers: fromNodeHeaders(request.headers),
      });
      if (!session)
        throw new ApiProblem(401, "Unauthorized", "Sign in to continue.");
      return getTransfer(
        db,
        session.user.id,
        request.params.ledgerId,
        request.params.transferId,
      );
    },
  );
  app.post(
    "/api/v1/ledgers/:ledgerId/transfers",
    {
      schema: {
        ...common,
        params: ledgerParamsSchema,
        headers,
        summary: "Create a transfer",
        description:
          "Positive exact USD cents move from one active same-ledger account to another. Both cleared, uncategorized legs commit atomically; transfers are excluded from income/spending. fxRate is 1 and signed baseAmount equals amount on each leg. Discover transfer IDs through transaction history.",
        body: createTransferSchema,
        response: { 201: transferSchema, ...errors },
      },
    },
    async (request, reply) =>
      sendFinancialWrite(
        reply,
        await createTransfer(
          db,
          await financialWriteIdentity(auth, config, request),
          request.body,
        ),
      ),
  );
  app.patch(
    "/api/v1/ledgers/:ledgerId/transfers/:transferId",
    {
      schema: {
        ...common,
        headers,
        summary: "Edit a transfer",
        description:
          "Complete replacement of editable fields with one expectedVersion for both legs. Identity/direction are retained, both versions advance together. Unchanged archived assignments permit historical corrections; new assignments must be active.",
        body: updateTransferSchema,
        response: { 200: transferSchema, ...errors },
      },
    },
    async (request, reply) =>
      sendFinancialWrite(
        reply,
        await updateTransfer(
          db,
          await financialWriteIdentity(auth, config, request),
          request.params.transferId,
          request.body,
        ),
      ),
  );
  app.delete(
    "/api/v1/ledgers/:ledgerId/transfers/:transferId",
    {
      schema: {
        ...common,
        headers,
        summary: "Delete a transfer",
        description:
          "Atomically soft-deletes both legs and advances their shared version. Same-key retries replay 204.",
        body: transferVersionSchema,
        response: { 204: z.null(), ...errors },
      },
    },
    async (request, reply) =>
      sendFinancialWrite(
        reply,
        await transferLifecycle(
          db,
          await financialWriteIdentity(auth, config, request),
          request.params.transferId,
          request.body,
          false,
        ),
      ),
  );
  app.post(
    "/api/v1/ledgers/:ledgerId/transfers/:transferId/restore",
    {
      schema: {
        ...common,
        headers,
        summary: "Restore a transfer",
        description:
          "Undo deletion using the deleted version. Restores both original identities and historical archived references atomically; missing/deleted references, stale versions and balance overflow fail without partial changes.",
        body: transferVersionSchema,
        response: { 200: transferSchema, ...errors },
      },
    },
    async (request, reply) =>
      sendFinancialWrite(
        reply,
        await transferLifecycle(
          db,
          await financialWriteIdentity(auth, config, request),
          request.params.transferId,
          request.body,
          true,
        ),
      ),
  );
}
