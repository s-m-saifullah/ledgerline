import {
  type Category,
  currencyDigits,
  parseMinorUnits,
} from "@ledgerline/shared";
import { cleanAmountText } from "../accounts/money";
export function paymentDefault(
  categories: Category[],
  remembered: string | null,
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
        c.name.trim().toLowerCase() === "services",
    )?.id ??
    ""
  );
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
