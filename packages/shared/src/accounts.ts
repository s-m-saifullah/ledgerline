import { z } from "zod";
import {
  currencySchema,
  idSchema,
  ledgerParamsSchema,
  moneySchema,
  versionSchema,
} from "./contracts";

export const accountTypeSchema = z.enum([
  "bank",
  "cash",
  "card",
  "wallet",
  "loan",
  "savings",
]);
/** Accounts that hold money you can spend; cards and loans are debts and stay off Home's "In hand". */
export const assetAccountTypes = ["bank", "cash", "wallet", "savings"] as const;
export const isAssetAccountType = (type: z.infer<typeof accountTypeSchema>) =>
  (assetAccountTypes as readonly string[]).includes(type);
const accountNameSchema = z.string().trim().min(1).max(100);
// Optional bonus on transfers into the account (ADR 0023): whole basis points (2.5% is 250)
// and the income category the bonus entry uses by default. Null turns it off.
const bonusFields = {
  inboundBonusBps: z.number().int().min(1).max(10_000).nullable().optional(),
  bonusCategoryId: idSchema.nullable().optional(),
};
// Optional defaults for the fee on transfers out of the account (ADR 0025): the expense category
// and a fee that prefills the form, either a fixed amount in the account's currency or whole
// basis points of the amount sent. Null turns it off.
export const defaultFeeSchema = z.union([
  z.strictObject({
    amount: moneySchema.refine((money) => money.amount > 0, {
      path: ["amount"],
      message: "Enter a positive fee.",
    }),
  }),
  z.strictObject({ basisPoints: z.number().int().min(1).max(10_000) }),
]);
const feeFields = {
  feeCategoryId: idSchema.nullable().optional(),
  defaultFee: defaultFeeSchema.nullable().optional(),
};
export const createAccountSchema = z.strictObject({
  name: accountNameSchema,
  type: accountTypeSchema,
  // The opening balance's currency is the account's currency (USD, or a currency the ledger has added).
  openingBalance: moneySchema,
  ...bonusFields,
  ...feeFields,
});
export const updateAccountSchema = z
  .strictObject({
    expectedVersion: versionSchema,
    name: accountNameSchema.optional(),
    type: accountTypeSchema.optional(),
    openingBalance: moneySchema.optional(),
    ...bonusFields,
    ...feeFields,
  })
  .refine(
    (body) =>
      body.name !== undefined ||
      body.type !== undefined ||
      body.openingBalance !== undefined ||
      body.inboundBonusBps !== undefined ||
      body.bonusCategoryId !== undefined ||
      body.feeCategoryId !== undefined ||
      body.defaultFee !== undefined,
    "Provide an account field to update.",
  );
export const archiveAccountSchema = z.strictObject({
  expectedVersion: versionSchema,
});
export const accountParamsSchema = ledgerParamsSchema.extend({
  accountId: idSchema,
});
export const accountListQuerySchema = z.object({
  status: z.enum(["all", "active", "archived"]).default("all"),
  cursor: idSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export const accountSchema = z.object({
  id: idSchema,
  ledgerId: idSchema,
  name: accountNameSchema,
  type: accountTypeSchema,
  currency: currencySchema,
  openingBalance: moneySchema,
  // Older saved responses lack the bonus settings; they read as off.
  inboundBonusBps: z.number().int().min(1).max(10_000).nullable().default(null),
  bonusCategoryId: idSchema.nullable().default(null),
  feeCategoryId: idSchema.nullable().default(null),
  defaultFee: defaultFeeSchema.nullable().default(null),
  // Set on the balance account that tracks money lent to or borrowed from one client (ADR 0030).
  contactId: idSchema.nullable().default(null),
  balance: moneySchema,
  archivedAt: z.iso.datetime().nullable(),
  version: versionSchema,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export const accountListSchema = z.object({
  items: z.array(accountSchema),
  nextCursor: idSchema.nullable(),
});
export type Account = z.infer<typeof accountSchema>;
export type CreateAccount = z.infer<typeof createAccountSchema>;
export type UpdateAccount = z.infer<typeof updateAccountSchema>;
export type ArchiveAccount = z.infer<typeof archiveAccountSchema>;
export type AccountListQuery = z.infer<typeof accountListQuerySchema>;

export const deleteAccountSchema = z.strictObject({
  expectedVersion: versionSchema,
});
export type DeleteAccount = z.infer<typeof deleteAccountSchema>;
