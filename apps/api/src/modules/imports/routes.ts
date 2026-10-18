import {
  createImportResultSchema,
  createImportSchema,
  importBatchListSchema,
  importBatchParamsSchema,
  importParamsSchema,
  importPreviewSchema,
  previewImportSchema,
  undoImportResultSchema,
  undoImportSchema,
} from "@ledgerline/shared";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import type { Config } from "../../config";
import type { Database } from "../../db/client";
import { createActor, errors, writeHeaders } from "../../lib/route-helpers";
import type { Auth } from "../auth/service";
import { financialWriteIdentity, sendFinancialWrite } from "../writes/http";
import {
  createImport,
  listImports,
  previewImport,
  undoImport,
} from "./service";

const security = [{ sessionCookie: [] }];
// Up to 5,000 rows of JSON; everything else keeps the default limit.
const bodyLimit = 4 * 1024 * 1024;

export async function importRoutes(
  instance: FastifyInstance,
  { db, config, auth }: { db: Database; config: Config; auth: Auth },
) {
  const app = instance.withTypeProvider<ZodTypeProvider>();
  const actor = createActor(auth);
  app.post(
    "/api/v1/ledgers/:ledgerId/imports/preview",
    {
      bodyLimit,
      schema: {
        summary: "Check rows before importing them",
        description:
          "Read-only: nothing is saved and the rows are not kept. The web app reads the CSV file itself and sends the mapped rows (positive minor units, direction in `kind`, a category id each). Each row comes back `ready`, `duplicate` (same entry id, or same account, date and amount as an existing entry; each existing entry matches one row) or `problem` with a reason (category missing, archived or of the other kind; no exchange rate for the date).",
        tags: ["Imports"],
        security,
        params: importParamsSchema,
        body: previewImportSchema,
        response: { 200: importPreviewSchema, ...errors },
      },
    },
    async (request) =>
      previewImport(
        db,
        await actor(request),
        request.params.ledgerId,
        request.body,
      ),
  );
  app.post(
    "/api/v1/ledgers/:ledgerId/imports",
    {
      bodyLimit,
      schema: {
        summary: "Import rows as entries",
        description:
          "Saves every row as a cleared or pending income or expense entry in the account, in one all-or-nothing write that can be undone as a batch. Rows are re-checked here; a row that matches an existing entry is saved only because the caller included it (`duplicatesIncluded` counts them). At most 5,000 rows. Requires an owner/editor session, a trusted browser Origin and `Idempotency-Key`.",
        tags: ["Imports"],
        security,
        params: importParamsSchema,
        headers: writeHeaders,
        body: createImportSchema,
        response: { 201: createImportResultSchema, ...errors },
      },
    },
    async (request, reply) =>
      sendFinancialWrite(
        reply,
        await createImport(
          db,
          await financialWriteIdentity(auth, config, request),
          request.body,
        ),
      ),
  );
  app.get(
    "/api/v1/ledgers/:ledgerId/imports",
    {
      schema: {
        summary: "List recent imports",
        description:
          "The 20 newest imports that have not been undone, each with how many of its entries are still in the ledger.",
        tags: ["Imports"],
        security,
        params: importParamsSchema,
        response: { 200: importBatchListSchema, ...errors },
      },
    },
    async (request) =>
      listImports(db, await actor(request), request.params.ledgerId),
  );
  app.post(
    "/api/v1/ledgers/:ledgerId/imports/:batchId/undo",
    {
      schema: {
        summary: "Undo an import",
        description:
          "Deletes every entry of the import that is still in the ledger (entries already deleted stay as they are) and retires the batch. Requires expectedVersion. A batch already undone is 404.",
        tags: ["Imports"],
        security,
        params: importBatchParamsSchema,
        headers: writeHeaders,
        body: undoImportSchema,
        response: { 200: undoImportResultSchema, ...errors },
      },
    },
    async (request, reply) =>
      sendFinancialWrite(
        reply,
        await undoImport(
          db,
          await financialWriteIdentity(auth, config, request),
          request.params.batchId,
          request.body.expectedVersion,
        ),
      ),
  );
}
