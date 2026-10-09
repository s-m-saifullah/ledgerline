import {
  type Account,
  accountTypeSchema,
  createAccountSchema,
  parseMinorUnits,
} from "@ledgerline/shared";
import { z } from "zod";
import { cleanAmountText, decimalFromCents } from "./money";

export const accountFormSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Give this account a name.")
    .max(100, "Use 100 characters or fewer."),
  type: accountTypeSchema,
  direction: z.enum(["positive", "negative"]),
  amount: z
    .string()
    .trim()
    .transform(cleanAmountText)
    .refine((value) => {
      if (!/^\d+(?:\.\d{1,2})?$/.test(value)) return false;
      try {
        parseMinorUnits(value);
        return true;
      } catch {
        return false;
      }
    }, "Enter an amount with up to two decimal places, within the supported range."),
});
export type AccountFormValues = z.infer<typeof accountFormSchema>;
export const accountTypes = {
  bank: "Bank account",
  cash: "Cash",
  card: "Credit card",
  wallet: "Mobile wallet",
  loan: "Loan",
  savings: "Savings",
} as const;
export const isLiability = (type: Account["type"]) =>
  type === "card" || type === "loan";
export function formDefaults(account?: Account): AccountFormValues {
  return {
    name: account?.name ?? "",
    type: account?.type ?? "bank",
    direction:
      (account?.openingBalance.amount ?? 0) < 0 ? "negative" : "positive",
    amount: decimalFromCents(Math.abs(account?.openingBalance.amount ?? 0)),
  };
}
export function accountBody(values: AccountFormValues) {
  const parsed = accountFormSchema.parse(values);
  const cents = parseMinorUnits(parsed.amount);
  return createAccountSchema.parse({
    name: parsed.name,
    type: parsed.type,
    openingBalance: {
      amount: parsed.direction === "negative" ? -cents : cents,
      currency: "USD",
    },
  });
}
