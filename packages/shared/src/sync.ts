import { z } from "zod";
import {
  idSchema,
  ledgerParamsSchema,
  moneySchema,
  usdMoneySchema,
  versionSchema,
} from "./contracts";

// The pull side of Android sync (ADR 0042). Each table is sent as its own rows, not as the joined shapes
// the web screens use: a tag rename or a deleted tag link then needs no refresh of the entries, and the
// phone joins names itself. A row with `deletedAt` set is a tombstone: delete it from the mirror.

export const syncParamsSchema = ledgerParamsSchema;
export const syncQuerySchema = z.strictObject({
  cursor: z.string().min(1).max(4000).optional(),
  limit: z.coerce.number().int().min(1).max(1000).default(500),
});

const timestamp = z.iso.datetime();
const audit = {
  id: idSchema,
  createdAt: timestamp,
  updatedAt: timestamp,
  deletedAt: timestamp.nullable(),
};
const versioned = { ...audit, version: versionSchema };
const optionalId = idSchema.nullable();

export const syncAccountSchema = z.object({
  ...versioned,
  name: z.string(),
  type: z.enum(["bank", "cash", "card", "wallet", "loan", "savings"]),
  currency: z.string(),
  openingBalance: moneySchema,
  inboundBonusBps: z.number().int().nullable(),
  bonusCategoryId: optionalId,
  feeCategoryId: optionalId,
  defaultFeeAmount: moneySchema.nullable(),
  defaultFeeBps: z.number().int().nullable(),
  // Set for the hidden balance account kept for a client or a person lent to or borrowed from.
  contactId: optionalId,
  archivedAt: timestamp.nullable(),
});
export const syncCategorySchema = z.object({
  ...versioned,
  parentId: optionalId,
  name: z.string(),
  kind: z.enum(["income", "expense"]),
  icon: z.string().nullable(),
  color: z.string().nullable(),
  sortOrder: z.number().int(),
  archivedAt: timestamp.nullable(),
});
export const syncTagSchema = z.object({
  ...versioned,
  name: z.string(),
  archivedAt: timestamp.nullable(),
});
export const syncTransactionSchema = z.object({
  ...versioned,
  accountId: idSchema,
  categoryId: optionalId,
  kind: z.enum(["expense", "income", "transfer"]),
  isSplit: z.boolean(),
  date: z.iso.date(),
  time: z.string().nullable(),
  amount: moneySchema,
  payee: z.string().nullable(),
  note: z.string().nullable(),
  transferId: optionalId,
  relatedTransferId: optionalId,
  feeTransferId: optionalId,
  tipPaymentId: optionalId,
  importBatchId: optionalId,
  receivablePaymentId: optionalId,
  receivableId: optionalId,
  status: z.enum(["cleared", "pending"]),
  fxRate: z.string(),
  baseAmount: usdMoneySchema,
});
export const syncSplitSchema = z.object({
  ...versioned,
  transactionId: idSchema,
  categoryId: idSchema,
  kind: z.enum(["expense", "income"]),
  // In the entry's currency.
  amount: moneySchema,
  baseAmount: usdMoneySchema,
  note: z.string().nullable(),
  position: z.number().int(),
});
// A tag on an entry has no version of its own: apply it by `updatedAt`.
export const syncTransactionTagSchema = z.object({
  ...audit,
  transactionId: idSchema,
  tagId: idSchema,
});
export const syncCurrencySchema = z.object({ ...versioned, code: z.string() });
export const syncRateSchema = z.object({
  ...versioned,
  code: z.string(),
  date: z.iso.date(),
  rate: z.string(),
  source: z.enum(["api", "manual"]),
});

export const syncResponseSchema = z.object({
  changes: z.object({
    accounts: z.array(syncAccountSchema),
    categories: z.array(syncCategorySchema),
    tags: z.array(syncTagSchema),
    currencies: z.array(syncCurrencySchema),
    exchangeRates: z.array(syncRateSchema),
    transactions: z.array(syncTransactionSchema),
    transactionSplits: z.array(syncSplitSchema),
    transactionTags: z.array(syncTransactionTagSchema),
  }),
  // Opaque: send it back as `cursor` for the next page or the next pull. It runs a little behind the newest
  // row on purpose, so a change that commits late is sent again; apply rows by id and ignore any that are
  // not newer than the copy you hold.
  cursor: z.string(),
  hasMore: z.boolean(),
  serverTime: timestamp,
});
export type SyncResponse = z.infer<typeof syncResponseSchema>;
