import {
  type Account,
  accountTypeSchema,
  createAccountSchema,
  currencyDigits,
  currencySchema,
  parseMinorUnits,
} from "@ledgerline/shared";
import { z } from "zod";
import { cleanAmountText, decimalFromCents } from "./money";

export const accountFormSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, "Give this account a name.")
      .max(100, "Use 100 characters or fewer."),
    type: accountTypeSchema,
    // The account's currency: USD, or a currency added under Currencies.
    currency: currencySchema,
    direction: z.enum(["positive", "negative"]),
    amount: z.string().trim().transform(cleanAmountText),
  })
  .superRefine((values, ctx) => {
    const digits = currencyDigits(values.currency);
    const pattern = new RegExp(`^\\d+(?:\\.\\d{1,${Math.max(digits, 1)}})?$`);
    let valid =
      digits === 0 ? /^\d+$/.test(values.amount) : pattern.test(values.amount);
    if (valid)
      try {
        parseMinorUnits(values.amount, digits);
      } catch {
        valid = false;
      }
    if (!valid)
      ctx.addIssue({
        code: "custom",
        path: ["amount"],
        message:
          digits === 0
            ? "Enter a whole amount, within the supported range."
            : `Enter an amount with up to ${digits === 2 ? "two" : digits} decimal places, within the supported range.`,
      });
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
export function formDefaults(
  account?: Account,
  currency = "USD",
): AccountFormValues {
  const code = account?.currency ?? currency;
  return {
    name: account?.name ?? "",
    type: account?.type ?? "bank",
    currency: code,
    direction:
      (account?.openingBalance.amount ?? 0) < 0 ? "negative" : "positive",
    amount: decimalFromCents(
      Math.abs(account?.openingBalance.amount ?? 0),
      currencyDigits(code),
    ),
  };
}
export function accountBody(values: AccountFormValues) {
  const parsed = accountFormSchema.parse(values);
  const cents = parseMinorUnits(parsed.amount, currencyDigits(parsed.currency));
  return createAccountSchema.parse({
    name: parsed.name,
    type: parsed.type,
    openingBalance: {
      amount: parsed.direction === "negative" ? -cents : cents,
      currency: parsed.currency,
    },
  });
}
