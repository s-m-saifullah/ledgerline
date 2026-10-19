import { z } from "zod";
import { ledgerParamsSchema } from "./contracts";
import { transactionListQuerySchema } from "./transactions";

export const exportParamsSchema = ledgerParamsSchema;
/** The Transactions list filters (without paging), so an export can match what a screen shows. */
export const exportTransactionsQuerySchema = z
  .object(transactionListQuerySchema.def.shape)
  .omit({ cursor: true, limit: true })
  .refine((body) => !body.from || !body.to || body.from <= body.to, {
    path: ["to"],
    message: "End date must be on or after start date.",
  });
export type ExportTransactionsQuery = z.infer<
  typeof exportTransactionsQuerySchema
>;

/** The columns of the transactions file, in order. Import reads the same columns (ADR 0033). */
export const transactionCsvColumns = [
  "id",
  "date",
  "time",
  "type",
  "amount",
  "currency",
  "account",
  "to_account",
  "received_amount",
  "category",
  "subcategory",
  "payee",
  "note",
  "status",
  "line",
  "fx_rate",
  "base_amount",
  "tags",
] as const;
export const accountCsvColumns = [
  "id",
  "name",
  "type",
  "currency",
  "opening_balance",
  "archived",
] as const;
export const categoryCsvColumns = [
  "id",
  "name",
  "parent",
  "kind",
  "color",
  "archived",
] as const;
