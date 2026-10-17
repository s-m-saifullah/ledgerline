import {
  type Category,
  currencyDigits,
  parseMinorUnits,
} from "@ledgerline/shared";
import { cleanAmountText } from "../../lib/money";

/** The last confirmed active income category, otherwise an active income root with this name. */
function incomeDefault(
  categories: Category[],
  remembered: string | null,
  name: string,
) {
  return (
    categories.find(
      (c) => c.id === remembered && c.kind === "income" && !c.archivedAt,
    )?.id ??
    categories.find(
      (c) =>
        !c.archivedAt &&
        c.kind === "income" &&
        !c.parentId &&
        c.name.trim().toLowerCase() === name,
    )?.id ??
    ""
  );
}
export const paymentDefault = (
  categories: Category[],
  remembered: string | null,
) => incomeDefault(categories, remembered, "services");
/** Tips (ADR 0027) default the same way, to a root named Tips; it is never created silently. */
export const tipDefault = (categories: Category[], remembered: string | null) =>
  incomeDefault(categories, remembered, "tips");
/**
 * An amount typed above what is owed settles the open balance and the rest is a tip (ADR 0027).
 * Null while the text is not a valid positive amount.
 */
export function splitExtra(
  text: string,
  currency: string,
  outstanding: number,
): { settle: number; tip: number } | null {
  let amount: number;
  try {
    amount = positiveMoney(text, currency).amount;
  } catch {
    return null;
  }
  return amount > outstanding
    ? { settle: outstanding, tip: amount - outstanding }
    : { settle: amount, tip: 0 };
}
/** A positive amount typed in the currency's own units (USD 2 decimals, JPY none, BHD 3). */
export function positiveMoney(text: string, currency: string) {
  const digits = currencyDigits(currency);
  const cleaned = cleanAmountText(text);
  const pattern =
    digits === 0 ? /^\d+$/ : new RegExp(`^\\d+(?:\\.\\d{1,${digits}})?$`);
  if (!pattern.test(cleaned))
    throw new Error(
      digits === 0
        ? `Enter a whole positive ${currency} amount.`
        : `Enter a positive ${currency} amount with up to ${digits === 2 ? "two" : digits} decimal places.`,
    );
  const amount = parseMinorUnits(cleaned, digits);
  if (amount <= 0) throw new Error(`Enter a positive ${currency} amount.`);
  return { amount, currency };
}
export function positiveCents(text: string) {
  return { ...positiveMoney(text, "USD"), currency: "USD" as const };
}
