import {
  type Account,
  createTransactionSchema,
  currencyDigits,
  currencySchema,
  idSchema,
  parseMinorUnits,
  rateSchema,
  type Transaction,
  transactionKindSchema,
  transactionStatusSchema,
  transactionTimeSchema,
} from "@ledgerline/shared";
import { z } from "zod";
import { cleanAmountText, decimalFromCents } from "../accounts/money";
export function localToday(now = new Date()) {
  return `${String(now.getFullYear()).padStart(4, "0")}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}
/** Is `text` (already cleaned) a positive amount that fits the currency's minor units? */
export function isPositiveAmount(text: string, currency: string) {
  const digits = currencyDigits(currency);
  const pattern =
    digits === 0 ? /^\d+$/ : new RegExp(`^\\d+(?:\\.\\d{1,${digits}})?$`);
  if (!pattern.test(text)) return false;
  try {
    return parseMinorUnits(text, digits) > 0;
  } catch {
    return false;
  }
}
export function amountMessage(currency: string) {
  const digits = currencyDigits(currency);
  return digits === 0
    ? "Enter a positive whole amount, within the supported range."
    : `Enter a positive amount with up to ${digits === 2 ? "two" : digits} decimal places, within the supported range.`;
}
/** What the user has typed so far as smallest units, or null while it is not a valid amount. */
export function amountMinor(text: string, currency: string): number | null {
  try {
    const value = parseMinorUnits(
      cleanAmountText(text),
      currencyDigits(currency),
    );
    return value > 0 ? value : null;
  } catch {
    return null;
  }
}
export const transactionFormSchema = z
  .object({
    amount: z.string().trim().transform(cleanAmountText),
    // The chosen account's currency, and a rate set by hand ("" means use the stored rate).
    currency: currencySchema,
    fxRate: z.string(),
    accountId: idSchema,
    categoryId: z.string(),
    splitEnabled: z.boolean().optional(),
    splits: z
      .array(
        z.object({
          id: idSchema.optional(),
          categoryId: z.string(),
          amount: z.string(),
          note: z.string().trim().max(2000),
        }),
      )
      .optional(),
    kind: transactionKindSchema,
    date: createTransactionSchema.shape.date,
    time: z.union([z.literal(""), transactionTimeSchema]),
    status: transactionStatusSchema,
    payee: z.string().trim().max(200),
    note: z.string().trim().max(2000),
  })
  .superRefine((values, ctx) => {
    const digits = currencyDigits(values.currency);
    const valid = (text: string) => isPositiveAmount(text, values.currency);
    if (!valid(values.amount))
      ctx.addIssue({
        code: "custom",
        path: ["amount"],
        message: amountMessage(values.currency),
      });
    if (values.fxRate !== "" && !rateSchema.safeParse(values.fxRate).success)
      ctx.addIssue({
        code: "custom",
        path: ["fxRate"],
        message: "Enter a valid exchange rate.",
      });
    if (!values.splitEnabled) {
      if (!idSchema.safeParse(values.categoryId).success)
        ctx.addIssue({
          code: "custom",
          path: ["categoryId"],
          message: "Choose a category.",
        });
      return;
    }
    const lines = values.splits ?? [];
    if (lines.length < 2 || lines.length > 50)
      ctx.addIssue({
        code: "custom",
        path: ["splits"],
        message: "Use 2–50 split lines.",
      });
    let total = 0n;
    for (const [index, line] of lines.entries()) {
      if (!idSchema.safeParse(line.categoryId).success)
        ctx.addIssue({
          code: "custom",
          path: ["splits", index, "categoryId"],
          message: "Choose a category.",
        });
      const text = cleanAmountText(line.amount);
      if (valid(text)) total += BigInt(parseMinorUnits(text, digits));
      else
        ctx.addIssue({
          code: "custom",
          path: ["splits", index, "amount"],
          message: `Enter a positive exact ${values.currency} amount.`,
        });
    }
    try {
      if (total !== BigInt(parseMinorUnits(values.amount, digits)))
        ctx.addIssue({
          code: "custom",
          path: ["splits"],
          message: "Split lines must total the transaction exactly.",
        });
    } catch {
      /* Main amount reports its own error. */
    }
  });
export type TransactionFormValues = z.infer<typeof transactionFormSchema>;
export function transactionBody(values: TransactionFormValues) {
  const parsed = transactionFormSchema.parse(values);
  const digits = currencyDigits(parsed.currency);
  const cents = parseMinorUnits(parsed.amount, digits);
  const { splitEnabled, splits, currency, fxRate, ...fields } = parsed;
  return createTransactionSchema.parse({
    ...fields,
    ...(fxRate ? { fxRate } : {}),
    categoryId: splitEnabled ? null : parsed.categoryId,
    ...(splitEnabled
      ? {
          splits: (splits ?? []).map((line) => ({
            ...(line.id ? { id: line.id } : {}),
            categoryId: line.categoryId,
            amount: {
              amount:
                (parsed.kind === "expense" ? -1 : 1) *
                parseMinorUnits(cleanAmountText(line.amount), digits),
              currency,
            },
            note: line.note || null,
          })),
        }
      : {}),
    amount: {
      amount: parsed.kind === "expense" ? -cents : cents,
      currency,
    },
    time: parsed.time || null,
    payee: parsed.payee || null,
    note: parsed.note || null,
  });
}
const accountKey = (actorId: string, ledgerId: string) =>
  `ledgerline.last-account.${actorId}.${ledgerId}`;
export function lastActiveAccount(
  actorId: string,
  ledgerId: string,
  accounts: readonly Account[],
) {
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(accountKey(actorId, ledgerId));
  } catch {
    /* Storage may be disabled. */
  }
  return (
    accounts.find((row) => row.id === stored && !row.archivedAt)?.id ??
    accounts.find((row) => !row.archivedAt)?.id ??
    ""
  );
}
export function rememberAccount(actorId: string, ledgerId: string, id: string) {
  try {
    localStorage.setItem(accountKey(actorId, ledgerId), id);
  } catch {
    /* A preference failure must not turn a confirmed save into a retry. */
  }
}
export function transactionDefaults(
  actorId: string,
  ledgerId: string,
  accounts: readonly Account[],
): TransactionFormValues {
  const accountId = lastActiveAccount(actorId, ledgerId, accounts);
  return {
    amount: "",
    currency: accounts.find((row) => row.id === accountId)?.currency ?? "USD",
    fxRate: "",
    accountId,
    categoryId: "",
    splitEnabled: false,
    splits: [],
    kind: "expense",
    date: localToday(),
    time: "",
    status: "cleared",
    payee: "",
    note: "",
  };
}

export function transactionEditDefaults(
  row: Transaction,
): TransactionFormValues {
  const digits = currencyDigits(row.amount.currency);
  return {
    amount: decimalFromCents(row.amount.amount, digits).replace(/^-/, ""),
    currency: row.amount.currency,
    // The entry keeps its saved rate unless one is set here.
    fxRate: "",
    accountId: row.accountId,
    categoryId: row.categoryId ?? "",
    splitEnabled: row.isSplit,
    splits: row.splits.map((line) => ({
      id: line.id,
      categoryId: line.categoryId,
      amount: decimalFromCents(line.amount.amount, digits).replace(/^-/, ""),
      note: line.note ?? "",
    })),
    kind: row.kind === "transfer" ? "expense" : row.kind,
    date: row.date,
    time: row.time ?? "",
    status: row.status,
    payee: row.payee ?? "",
    note: row.note ?? "",
  };
}
