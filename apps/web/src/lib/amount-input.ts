import { currencyDigits, parseMinorUnits } from "@ledgerline/shared";
import { cleanAmountText } from "./money";

/**
 * Money typed in a box, read as it is meant (a "$", spaces, "1,000", ".8" and "8." are fine), as exact minor units. It throws
 * like `parseMinorUnits` when the text is not one amount that fits the currency. Typed text is read here and nowhere else
 * (`typed-numbers-contract.test.ts`).
 */
export function typedMinor(text: string, digits = 2): number {
  return parseMinorUnits(cleanAmountText(text), digits);
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
