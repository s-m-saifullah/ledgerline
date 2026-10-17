import {
  createReceiptSchema,
  receiptActionSchema,
  receiptContactParamsSchema,
  receiptParamsSchema,
  receiptPreviewQuerySchema,
  receiptPreviewSchema,
  receiptSchema,
  updateReceiptSchema,
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
  changeReceipt,
  createReceipt,
  getReceipt,
  previewReceipt,
} from "./receipt-service";

const security = [{ sessionCookie: [] }];
const description =
  "Versioned ledger-scoped write with an atomic receipt. A client-level payment is applied to the client's open services oldest service date first; each service gets its own linked income entry and all commit or fail together.";

export async function receiptRoutes(
  instance: FastifyInstance,
  { db, config, auth }: { db: Database; config: Config; auth: Auth },
) {
  const app = instance.withTypeProvider<ZodTypeProvider>();
  const actor = createActor(auth);
  app.get(
    "/api/v1/ledgers/:ledgerId/contacts/:contactId/receipt-preview",
    {
      schema: {
        summary: "Preview how a client-level payment would be applied",
        description:
          "Read-only. Open services are paid oldest service date first, then by ID. Returns the exact allocation and service versions to send back when saving.",
        tags: ["Clients"],
        security,
        params: receiptContactParamsSchema,
        querystring: receiptPreviewQuerySchema,
        response: { 200: receiptPreviewSchema, ...errors },
      },
    },
    async (r) =>
      previewReceipt(
        db,
        await actor(r),
        r.params.ledgerId,
        r.params.contactId,
        r.query.amount,
        r.query.currency,
      ),
  );
  app.post(
    "/api/v1/ledgers/:ledgerId/contacts/:contactId/receipts",
    {
      schema: {
        summary: "Record one payment from a client across their open services",
        description,
        tags: ["Clients"],
        security,
        params: receiptContactParamsSchema,
        headers: writeHeaders,
        body: createReceiptSchema,
        response: { 201: receiptSchema, ...errors },
      },
    },
    async (r, reply) =>
      sendFinancialWrite(
        reply,
        await createReceipt(
          db,
          await financialWriteIdentity(auth, config, r),
          r.params.contactId,
          r.body,
        ),
      ),
  );
  app.get(
    "/api/v1/ledgers/:ledgerId/receipts/:receiptId",
    {
      schema: {
        summary: "Get a client-level receipt and its payments",
        tags: ["Clients"],
        security,
        params: receiptParamsSchema,
        response: { 200: receiptSchema, ...errors },
      },
    },
    async (r) =>
      getReceipt(db, await actor(r), r.params.ledgerId, r.params.receiptId),
  );
  app.patch(
    "/api/v1/ledgers/:ledgerId/receipts/:receiptId",
    {
      schema: {
        summary: "Correct receipt details",
        description: `${description} Amounts and allocations are fixed; delete and re-enter to change them.`,
        tags: ["Clients"],
        security,
        params: receiptParamsSchema,
        headers: writeHeaders,
        body: updateReceiptSchema,
        response: { 200: receiptSchema, ...errors },
      },
    },
    async (r, reply) =>
      sendFinancialWrite(
        reply,
        await changeReceipt(
          db,
          await financialWriteIdentity(auth, config, r),
          r.params.receiptId,
          r.body,
          "edit",
        ),
      ),
  );
  app.delete(
    "/api/v1/ledgers/:ledgerId/receipts/:receiptId",
    {
      schema: {
        summary: "Delete a receipt with all its payments and income entries",
        description,
        tags: ["Clients"],
        security,
        params: receiptParamsSchema,
        headers: writeHeaders,
        body: receiptActionSchema,
        response: { 204: z.null(), ...errors },
      },
    },
    async (r, reply) =>
      sendFinancialWrite(
        reply,
        await changeReceipt(
          db,
          await financialWriteIdentity(auth, config, r),
          r.params.receiptId,
          r.body,
          "delete",
        ),
      ),
  );
  app.post(
    "/api/v1/ledgers/:ledgerId/receipts/:receiptId/restore",
    {
      schema: {
        summary: "Restore a deleted receipt",
        description,
        tags: ["Clients"],
        security,
        params: receiptParamsSchema,
        headers: writeHeaders,
        body: receiptActionSchema,
        response: { 200: receiptSchema, ...errors },
      },
    },
    async (r, reply) =>
      sendFinancialWrite(
        reply,
        await changeReceipt(
          db,
          await financialWriteIdentity(auth, config, r),
          r.params.receiptId,
          r.body,
          "restore",
        ),
      ),
  );
}
