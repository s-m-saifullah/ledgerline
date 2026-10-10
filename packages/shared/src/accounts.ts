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
export const createAccountSchema = z.strictObject({
  name: accountNameSchema,
  type: accountTypeSchema,
  // The opening balance's currency is the account's currency (USD, or a currency the ledger has added).
  openingBalance: moneySchema,
});
export const updateAccountSchema = z
  .strictObject({
    expectedVersion: versionSchema,
    name: accountNameSchema.optional(),
    type: accountTypeSchema.optional(),
    openingBalance: moneySchema.optional(),
  })
  .refine(
    (body) =>
      body.name !== undefined ||
      body.type !== undefined ||
      body.openingBalance !== undefined,
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
