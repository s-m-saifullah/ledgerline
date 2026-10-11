import { z } from "zod";
import {
  currencySchema,
  idSchema,
  ledgerParamsSchema,
  moneySchema,
  usdMoneySchema,
  versionSchema,
} from "./contracts";
import { rateSchema } from "./currency";
import {
  transactionDateSchema,
  transactionSchema,
  transactionTimeSchema,
} from "./transactions";

const nullableText = (max: number) => z.string().trim().max(max).nullable();
export const positiveUsdSchema = usdMoneySchema.refine((v) => v.amount > 0, {
  path: ["amount"],
  message: "Use a positive amount.",
});
/** An amount owed or paid, in the item's currency (any currency the ledger uses). */
export const positiveMoneySchema = moneySchema.refine((v) => v.amount > 0, {
  path: ["amount"],
  message: "Use a positive amount.",
});
const contactFields = {
  name: z.string().trim().min(1).max(100),
  phone: nullableText(100),
  email: z.email().max(254).nullable(),
  note: nullableText(2000),
};
export const createContactSchema = z.strictObject({
  ...contactFields,
  phone: contactFields.phone.default(null),
  email: contactFields.email.default(null),
  note: contactFields.note.default(null),
});
export const updateContactSchema = z.strictObject({
  ...contactFields,
  expectedVersion: versionSchema,
});
export const contactActionSchema = z.strictObject({
  expectedVersion: versionSchema,
});
export const contactParamsSchema = ledgerParamsSchema.extend({
  contactId: idSchema,
});
export const peopleListQuerySchema = z.object({
  cursor: idSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  status: z.enum(["all", "active", "archived"]).default("all"),
  text: z.string().trim().min(1).max(200).optional(),
});
const timestamps = { createdAt: z.iso.datetime(), updatedAt: z.iso.datetime() };
export const contactSchema = z.object({
  ...contactFields,
  ...timestamps,
  id: idSchema,
  ledgerId: idSchema,
  version: versionSchema,
  archivedAt: z.iso.datetime().nullable(),
  // What the person owes in the base currency at the newest stored rates (ADR 0022); currencies
  // with no rate are left out of it and named in `unconvertedCurrencies`.
  openBalance: usdMoneySchema,
  // The open balance in each currency the person owes in (none when nothing is open).
  openBalances: z.array(moneySchema).default([]),
  unconvertedCurrencies: z.array(currencySchema).default([]),
  oldestOpenServiceDate: transactionDateSchema.nullable(),
});
export const contactListSchema = z.object({
  items: z.array(contactSchema),
  nextCursor: idSchema.nullable(),
});
const serviceFields = {
  contactId: idSchema,
  description: z.string().trim().min(1).max(2000),
  serviceDate: transactionDateSchema,
  serviceTime: transactionTimeSchema.nullable(),
  dueDate: transactionDateSchema.nullable(),
  // The item's currency: USD by default, any currency the ledger has added; fixed once a
  // payment exists.
  amount: positiveMoneySchema,
};
export const createReceivableSchema = z.strictObject({
  ...serviceFields,
  // Omitted time stays out of the write fingerprint so pre-upgrade retries match.
  serviceTime: serviceFields.serviceTime.optional(),
  dueDate: serviceFields.dueDate.default(null),
});
export const updateReceivableSchema = z.strictObject({
  ...serviceFields,
  // Omitted keeps the saved time; null clears it.
  serviceTime: serviceFields.serviceTime.optional(),
  expectedVersion: versionSchema,
});
export const receivableActionSchema = contactActionSchema;
export const writeOffSchema = z.strictObject({
  expectedVersion: versionSchema,
  reason: nullableText(2000).default(null),
});
export const receivableParamsSchema = ledgerParamsSchema.extend({
  receivableId: idSchema,
});
export const receivableStatusSchema = z.enum([
  "unpaid",
  "partlyPaid",
  "paid",
  "writtenOff",
]);
export const receivableListQuerySchema = z
  .object({
    cursor: idSchema.optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    contactId: idSchema.optional(),
    status: receivableStatusSchema.optional(),
    from: transactionDateSchema.optional(),
    to: transactionDateSchema.optional(),
    text: z.string().trim().min(1).max(200).optional(),
  })
  .refine((v) => !v.from || !v.to || v.from <= v.to, {
    path: ["to"],
    message: "End date must follow start date.",
  });
export const receivableSchema = z.object({
  ...serviceFields,
  ...timestamps,
  id: idSchema,
  ledgerId: idSchema,
  version: versionSchema,
  received: moneySchema,
  remaining: moneySchema,
  outstanding: moneySchema,
  status: receivableStatusSchema,
  writtenOffAt: z.iso.datetime().nullable(),
  writtenOffAmount: moneySchema.nullable(),
  writeOffReason: nullableText(2000),
});
export const receivableListSchema = z.object({
  items: z.array(receivableSchema),
  nextCursor: idSchema.nullable(),
});
const paymentFields = {
  // What the payment settles, in the item's currency.
  amount: positiveMoneySchema,
  // What arrives in the account, in the account's currency; needed only when it differs from
  // the item's currency (the amount then lands in the account as this figure).
  receivedAmount: positiveMoneySchema.optional(),
  // Base-currency value of one unit of the account's currency, set by hand; only accepted when
  // neither the item nor the account uses the base currency.
  fxRate: rateSchema.optional(),
  accountId: idSchema,
  categoryId: idSchema,
  date: transactionDateSchema,
  time: transactionTimeSchema.nullable(),
  note: nullableText(2000),
};
export const createPaymentSchema = z.strictObject({
  ...paymentFields,
  time: paymentFields.time.default(null),
  note: paymentFields.note.default(null),
  expectedReceivableVersion: versionSchema,
});
export const updatePaymentSchema = z.strictObject({
  ...paymentFields,
  expectedVersion: versionSchema,
  expectedReceivableVersion: versionSchema,
});
export const paymentActionSchema = z.strictObject({
  expectedVersion: versionSchema,
  expectedReceivableVersion: versionSchema,
});
export const paymentParamsSchema = receivableParamsSchema.extend({
  paymentId: idSchema,
});
export const pageQuerySchema = z.object({
  cursor: idSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export const paymentSchema = z.object({
  id: idSchema,
  ledgerId: idSchema,
  receivableId: idSchema,
  transactionId: idSchema,
  amount: positiveMoneySchema,
  // Payments created together from one person-level receipt share this ID.
  receiptId: idSchema.nullable().default(null),
  version: versionSchema,
  ...timestamps,
  transaction: transactionSchema,
  receivable: receivableSchema,
});
export const paymentListSchema = z.object({
  items: z.array(paymentSchema),
  nextCursor: idSchema.nullable(),
});
export const receivableEventActionSchema = z.enum([
  "created",
  "edited",
  "deleted",
  "restored",
  "writtenOff",
  "reopened",
  "paymentCreated",
  "paymentEdited",
  "paymentDeleted",
  "paymentRestored",
]);
// Typed bounded snapshots keep history readable without exposing arbitrary JSON contracts.
export const receivableSnapshotSchema = receivableSchema.extend({
  // History written before migration 0010 has no time.
  serviceTime: transactionTimeSchema.nullable().default(null),
  deletedAt: z.iso.datetime().nullable(),
});
export const paymentSnapshotSchema = transactionSchema.extend({
  deletedAt: z.iso.datetime().nullable(),
});
export const eventSnapshotSchema = z.object({
  service: receivableSnapshotSchema,
  payment: paymentSnapshotSchema.nullable(),
});
export const receivableEventSchema = z.object({
  id: idSchema,
  ledgerId: idSchema,
  contactId: idSchema,
  receivableId: idSchema,
  paymentId: idSchema.nullable(),
  transactionId: idSchema.nullable(),
  actorId: idSchema,
  action: receivableEventActionSchema,
  receivableVersion: versionSchema,
  before: eventSnapshotSchema.nullable(),
  after: eventSnapshotSchema,
  ...timestamps,
});
export const receivableEventListSchema = z.object({
  items: z.array(receivableEventSchema),
  nextCursor: idSchema.nullable(),
});
export type Contact = z.infer<typeof contactSchema>;
export type CreateContact = z.infer<typeof createContactSchema>;
export type UpdateContact = z.infer<typeof updateContactSchema>;
export type PeopleListQuery = z.infer<typeof peopleListQuerySchema>;
export type Receivable = z.infer<typeof receivableSchema>;
export type CreateReceivable = z.infer<typeof createReceivableSchema>;
export type UpdateReceivable = z.infer<typeof updateReceivableSchema>;
export type ReceivableListQuery = z.infer<typeof receivableListQuerySchema>;
export type CreatePayment = z.infer<typeof createPaymentSchema>;
export type UpdatePayment = z.infer<typeof updatePaymentSchema>;
export type PaymentAction = z.infer<typeof paymentActionSchema>;
export type ReceivablePayment = z.infer<typeof paymentSchema>;
export type ReceivableEvent = z.infer<typeof receivableEventSchema>;
export type EventSnapshot = z.infer<typeof eventSnapshotSchema>;
export type PageQuery = z.infer<typeof pageQuerySchema>;
