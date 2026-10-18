import {
  type CreateImport,
  createImportResultSchema,
  type ImportBatch,
  type ImportPreview,
  importBatchListSchema,
  importPreviewSchema,
  type JsonValue,
  type PreviewImport,
  undoImportResultSchema,
} from "@ledgerline/shared";
import { api, prepareFinancialWrite } from "../../lib/api";

const base = (ledgerId: string) => `/ledgers/${ledgerId}/imports`;

/** Checks mapped rows; the server saves nothing and keeps nothing. */
export async function previewImport(
  ledgerId: string,
  body: PreviewImport,
  signal?: AbortSignal,
): Promise<ImportPreview> {
  return importPreviewSchema.parse(
    await api(`${base(ledgerId)}/preview`, {
      method: "POST",
      body: JSON.stringify(body),
      ...(signal ? { signal } : {}),
    }),
  );
}

/** Prepare once per confirm, then reuse the returned function for retries (one idempotency key). */
export function prepareImport(ledgerId: string, body: CreateImport) {
  const run = prepareFinancialWrite<unknown>(
    base(ledgerId),
    "POST",
    body as unknown as JsonValue,
  );
  return async () => createImportResultSchema.parse(await run());
}

export async function getImports(ledgerId: string, signal?: AbortSignal) {
  return importBatchListSchema.parse(
    await api(base(ledgerId), { ...(signal ? { signal } : {}) }),
  ).items;
}

export function prepareUndoImport(ledgerId: string, batch: ImportBatch) {
  const run = prepareFinancialWrite<unknown>(
    `${base(ledgerId)}/${batch.id}/undo`,
    "POST",
    { expectedVersion: batch.version },
  );
  return async () => undoImportResultSchema.parse(await run());
}
