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

// The push side (ADR 0042): the phone sends what was entered offline, one mutation at a time.

export const syncMutationTypes = [
  "transaction.create",
  "transaction.update",
  "transaction.delete",
  "transfer.create",
  "transfer.update",
  "transfer.delete",
] as const;

export const syncMutationSchema = z.strictObject({
  // A UUIDv7 made on the phone. It is also the idempotency key, and for a create it is the new entry's id
  // (for a transfer, its `transferId`), so the phone can refer to the row before it has synced.
  id: idSchema,
  type: z.enum(syncMutationTypes),
  // When the person made the change on the phone; capped at the time the server receives it.
  editedAt: timestamp,
  // The entry (or the transfer's `transferId`) an update or delete is about.
  targetId: idSchema.optional(),
  // The version of the row the phone last saw, for an update or delete.
  baseVersion: versionSchema.optional(),
  // A create sends the same fields as `POST /transactions` or `POST /transfers`. An entry update sends only the
  // changed fields of `PATCH /transactions/{id}`; a transfer update sends every field of `PATCH /transfers/{id}`
  // (the whole transfer is replaced). Neither sends `expectedVersion`: `baseVersion` stands in for it. A transfer
  // delete may send `deleteBonus` and `deleteFee`.
  body: z.record(z.string(), z.unknown()).default({}),
});
export const syncPushSchema = z
  .strictObject({
    mutations: z.array(syncMutationSchema).min(1).max(50),
  })
  .refine(
    (body) =>
      new Set(body.mutations.map((item) => item.id.toLowerCase())).size ===
      body.mutations.length,
    { path: ["mutations"], message: "Each mutation id may appear only once." },
  );

export const syncResultSchema = z.object({
  id: idSchema,
  // applied: done now. replayed: this mutation id was already applied (nothing happened again).
  // superseded: the server's row is newer, so the change was not applied; `rows` holds the server's version.
  // rejected: the change is not valid or not allowed; see `problem`.
  status: z.enum(["applied", "replayed", "superseded", "rejected"]),
  // The entry (or both legs of a transfer, with its bonus and fee) as the server now has them.
  rows: z.array(syncTransactionSchema),
  problem: z
    .object({
      status: z.number().int(),
      title: z.string(),
      detail: z.string(),
      errors: z
        .array(z.object({ field: z.string(), message: z.string() }))
        .optional(),
    })
    .optional(),
});
export const syncPushResponseSchema = z.object({
  results: z.array(syncResultSchema),
});
export type SyncPushResponse = z.infer<typeof syncPushResponseSchema>;
export type SyncMutation = z.infer<typeof syncMutationSchema>;
export type SyncResult = z.infer<typeof syncResultSchema>;

// Live updates for open web pages (ADR 0044): a marker that moves whenever any row of the ledger changes.
export const changeMarkerSchema = z.object({
  // Opaque: compare it with the last one; a different value means something in the ledger changed.
  marker: z.string(),
});
export type ChangeMarker = z.infer<typeof changeMarkerSchema>;
