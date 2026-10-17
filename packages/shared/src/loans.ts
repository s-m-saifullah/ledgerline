import { z } from "zod";
import {
  currencySchema,
  idSchema,
  moneySchema,
  versionSchema,
} from "./contracts";
import {
  contactOriginSchema,
  contactParamsSchema,
  positiveMoneySchema,
} from "./receivables";
import { transactionDateSchema, transactionTimeSchema } from "./transactions";

/** Money lent to or borrowed from a client (ADR 0030): one running balance per client and currency. */
export const loanParamsSchema = contactParamsSchema;
export const loanActionParamsSchema = contactParamsSchema.extend({
  action: z.enum(["lend", "borrow", "repay", "forgive", "opening"]),
});
// Lend, borrow and repay all move money between one of your own accounts and the client's balance;
// the amount's currency is the loan's currency and must be the account's currency too.
export const loanMoveSchema = z.strictObject({
  accountId: idSchema,
  amount: positiveMoneySchema,
  date: transactionDateSchema,
  time: transactionTimeSchema.nullable().default(null),
  note: z.string().trim().max(2000).nullable().default(null),
});
// Forgiving writes off the whole open balance: an expense when the client owed you, income when
// you owed the client, in a category you choose.
export const forgiveLoanSchema = z.strictObject({
  currency: currencySchema,
  categoryId: idSchema,
  date: transactionDateSchema,
  note: z.string().trim().max(2000).nullable().default(null),
});
// An existing loan: sets the balance before Ledgerline (positive: they owe you; negative: you owe
// them) without moving money in any of your accounts. Changing one needs its version.
export const loanOpeningSchema = z.strictObject({
  amount: moneySchema,
  expectedVersion: versionSchema.optional(),
});
export const loanBalanceSchema = z.object({
  accountId: idSchema,
  currency: currencySchema,
  openingBalance: moneySchema,
  balance: moneySchema,
  version: versionSchema,
});
export const loanListSchema = z.object({
  items: z.array(loanBalanceSchema),
});
export const loanResultSchema = z.object({
  balance: loanBalanceSchema,
  transferId: idSchema.nullable(),
  transactionId: idSchema.nullable(),
});
// The people you lend to or borrow from, each with a balance per currency (ADR 0030).
export const loanPeopleQuerySchema = z.object({
  cursor: idSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  status: z.enum(["all", "active", "archived"]).default("all"),
  text: z.string().trim().min(1).max(200).optional(),
});
export const loanPersonSchema = z.object({
  id: idSchema,
  name: z.string(),
  origin: contactOriginSchema,
  archivedAt: z.iso.datetime().nullable(),
  version: versionSchema,
  balances: z.array(loanBalanceSchema),
});
export const loanPeopleSchema = z.object({
  items: z.array(loanPersonSchema),
  nextCursor: idSchema.nullable(),
});
export type LoanPeopleQuery = z.infer<typeof loanPeopleQuerySchema>;
export type LoanPerson = z.infer<typeof loanPersonSchema>;
export type LoanMove = z.infer<typeof loanMoveSchema>;
export type ForgiveLoan = z.infer<typeof forgiveLoanSchema>;
export type LoanOpening = z.infer<typeof loanOpeningSchema>;
export type LoanBalance = z.infer<typeof loanBalanceSchema>;
export type LoanResult = z.infer<typeof loanResultSchema>;
