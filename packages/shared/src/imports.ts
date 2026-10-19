import { z } from "zod";
import {
  expectedVersionSchema,
  idSchema,
  ledgerParamsSchema,
  versionSchema,
} from "./contracts";
import {
  transactionDateSchema,
  transactionStatusSchema,
  transactionTimeSchema,
} from "./transactions";

/** One import holds at most this many rows. */
export const IMPORT_MAX_ROWS = 5000;

/**
 * A row the web app has already read and mapped from the file (ADR 0034). The file itself never
 * reaches the server. `amount` is positive minor units in the target account's currency; `kind`
 * is the direction.
 */
export const importRowSchema = z.strictObject({
  // Position in the file, so messages can point at it.
  line: z.number().int().min(1).max(1_000_000),
  date: transactionDateSchema,
  time: transactionTimeSchema.nullable(),
  kind: z.enum(["expense", "income"]),
  amount: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  categoryId: idSchema,
  payee: z.string().trim().max(200).nullable(),
  note: z.string().trim().max(2000).nullable(),
  status: transactionStatusSchema,
  // The `id` column of a file this app exported, for an exact duplicate match.
  sourceId: idSchema.nullable(),
  // Tag names from the file (ADR 0035). The server finds each by name, ignoring case, or creates
  // it; more than ten, or a name that is not a valid tag name, makes the row a problem.
  tags: z.array(z.string().max(200)).max(50).default([]),
});
export const importParamsSchema = ledgerParamsSchema;
export const importBatchParamsSchema = ledgerParamsSchema.extend({
  batchId: idSchema,
});
export const previewImportSchema = z.strictObject({
  accountId: idSchema,
  rows: z.array(importRowSchema).min(1).max(IMPORT_MAX_ROWS),
});
export const createImportSchema = previewImportSchema.extend({
  // The file's name for the history list; contents are never kept.
  sourceName: z.string().trim().min(1).max(200).nullable(),
});
export const importRowStateSchema = z.enum(["ready", "duplicate", "problem"]);
export const importPreviewSchema = z.object({
  rows: z.array(
    z.object({
      line: z.number().int(),
      state: importRowStateSchema,
      reason: z.string().nullable(),
    }),
  ),
  counts: z.object({
    ready: z.number().int(),
    duplicate: z.number().int(),
    problem: z.number().int(),
  }),
  // Tag names in the rows that no tag has yet; confirming creates them.
  newTags: z.array(z.string()).default([]),
});
export const importBatchSchema = z.object({
  id: idSchema,
  accountId: idSchema,
  sourceName: z.string().nullable(),
  rowCount: z.number().int(),
  // Entries from this import that are still in the ledger.
  remaining: z.number().int(),
  createdAt: z.iso.datetime(),
  version: versionSchema,
});
export const createImportResultSchema = z.object({
  batch: importBatchSchema,
  // Rows imported although they matched an existing entry (the owner chose to include them).
  duplicatesIncluded: z.number().int(),
  // Tags the import created because the file named them and no tag had that name.
  tagsCreated: z.number().int().default(0),
});
export const importBatchListSchema = z.object({
  items: z.array(importBatchSchema),
});
export const undoImportSchema = expectedVersionSchema;
export const undoImportResultSchema = z.object({
  removed: z.number().int(),
});
export type ImportRow = z.infer<typeof importRowSchema>;
export type PreviewImport = z.infer<typeof previewImportSchema>;
export type CreateImport = z.infer<typeof createImportSchema>;
export type ImportPreview = z.infer<typeof importPreviewSchema>;
export type ImportBatch = z.infer<typeof importBatchSchema>;
