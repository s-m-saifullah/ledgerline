import {
  type Account,
  accountTypeSchema,
  createAccountSchema,
  currencyDigits,
  currencySchema,
  parseMinorUnits,
} from "@ledgerline/shared";
import { z } from "zod";
import { defaultFeeText, parseFee } from "../transactions/fee";
import {
  bpsToPercent,
  cleanAmountText,
  decimalFromCents,
  percentToBps,
} from "./money";

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
    // Optional bonus on incoming transfers (ADR 0023): a percentage such as 2.5; empty is off.
    bonusRate: z.string().trim(),
    bonusCategoryId: z.string(),
    // Optional default fee on outgoing transfers (ADR 0025): "2" is fixed, "2%" a percentage.
    defaultFee: z.string().trim(),
    feeCategoryId: z.string(),
  })
  .superRefine((values, ctx) => {
    const fee = parseFee(values.defaultFee, values.currency);
    if (fee.kind === "invalid")
      ctx.addIssue({
        code: "custom",
        path: ["defaultFee"],
        message: fee.message,
      });
    if (values.bonusRate !== "" && percentToBps(values.bonusRate) === null)
      ctx.addIssue({
        code: "custom",
        path: ["bonusRate"],
        message:
          "Enter a percentage between 0.01 and 100, with up to two decimals.",
      });
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
export { bpsToPercent, percentToBps };
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
    bonusRate: bpsToPercent(account?.inboundBonusBps),
    bonusCategoryId: account?.bonusCategoryId ?? "",
    defaultFee: defaultFeeText(account),
    feeCategoryId: account?.feeCategoryId ?? "",
  };
}
export function accountBody(values: AccountFormValues) {
  const parsed = accountFormSchema.parse(values);
  const cents = parseMinorUnits(parsed.amount, currencyDigits(parsed.currency));
  const fee = parseFee(parsed.defaultFee, parsed.currency);
  return createAccountSchema.parse({
    name: parsed.name,
    type: parsed.type,
    openingBalance: {
      amount: parsed.direction === "negative" ? -cents : cents,
      currency: parsed.currency,
    },
    inboundBonusBps: percentToBps(parsed.bonusRate),
    bonusCategoryId: parsed.bonusRate ? parsed.bonusCategoryId || null : null,
    feeCategoryId: parsed.feeCategoryId || null,
    defaultFee:
      fee.kind === "fixed"
        ? { amount: { amount: fee.minor, currency: parsed.currency } }
        : fee.kind === "percent"
          ? { basisPoints: fee.bps }
          : null,
  });
}
