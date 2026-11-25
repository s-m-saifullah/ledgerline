import {
  createTransferSchema,
  ledgerParamsSchema,
  transferParamsSchema,
  transferSchema,
  transferVersionSchema,
  updateTransferSchema,
} from "@ledgerline/shared";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import type { Config } from "../../config";
import type { Database } from "../../db/client";
import {
  createActor,
  errors,
  security,
  writeHeaders,
} from "../../lib/route-helpers";
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
  const actor = createActor(auth);
  const common = {
    tags: ["Transfers"],
    security,
    params: transferParamsSchema,
  };
  app.get(
    "/api/v1/ledgers/:ledgerId/transfers/:transferId",
    {
      schema: {
        ...common,
        summary: "Get a transfer",
        response: { 200: transferSchema, ...errors },
      },
    },
    async (request) =>
      getTransfer(
        db,
        await actor(request),
        request.params.ledgerId,
        request.params.transferId,
      ),
  );
  app.post(
    "/api/v1/ledgers/:ledgerId/transfers",
    {
      schema: {
        ...common,
        params: ledgerParamsSchema,
        headers: writeHeaders,
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
        headers: writeHeaders,
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
        headers: writeHeaders,
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
        headers: writeHeaders,
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
