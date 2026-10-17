import { parseMinorUnits } from "@ledgerline/shared";
import { cleanAmountText, decimalFromCents } from "../features/accounts/money";

/**
 * Cents-first entry: digits fill in from the right and the decimal point stays put, so 1, 2, 3
 * reads 0.01, 0.12, 1.23. These functions turn what the browser reports after a keystroke into
 * the next value of the box; the box always holds the plain decimal the ordinary box would.
 */

/** A typed or stored amount as whole minor units, or null when it is not a plain decimal. */
function minorOf(text: string, digits: number): bigint | null {
  const cleaned = cleanAmountText(text);
  const pattern =
    digits === 0 ? /^\d+$/ : new RegExp(`^\\d+(?:\\.\\d{1,${digits}})?$`);
  if (!pattern.test(cleaned)) return null;
  try {
    return BigInt(parseMinorUnits(cleaned, digits));
  } catch {
    return null;
  }
}
const SAFE_MAX = BigInt(Number.MAX_SAFE_INTEGER);
function show(minor: bigint, digits: number) {
  return decimalFromCents(Number(minor), digits);
}

/**
 * The box's next value after an edit. `previous` is what the box held before, `next` what the
 * browser shows now. Typing digits at the end appends them, deleting the last character drops
 * the last digit, anything else (select all and type, a mid-text edit) starts over from the
 * digits now present. Non-digits are ignored, and a value beyond the safe money range is refused.
 */
export function centsFirstValue(
  previous: string,
  next: string,
  digits: number,
): string {
  const before = previous.trim() === "" ? 0n : minorOf(previous, digits);
  const keep =
    before === null || previous.trim() === "" ? previous : show(before, digits);
  if (next.trim() === "") return "";
  let minor: bigint;
  if (before !== null && next.startsWith(previous)) {
    const typed = next.slice(previous.length).replace(/\D/g, "");
    if (typed === "") return keep;
    minor = before * 10n ** BigInt(typed.length) + BigInt(typed);
  } else if (
    before !== null &&
    previous.length - next.length === 1 &&
    previous.startsWith(next)
  ) {
    minor = before / 10n;
    if (minor === 0n) return "";
  } else {
    const all = next.replace(/\D/g, "");
    if (all === "") return keep;
    minor = BigInt(all);
  }
  return minor > SAFE_MAX ? keep : show(minor, digits);
}

/** A pasted amount is read the ordinary way ("12.50" is 12.50, "1250" is 1250.00); null if unclear. */
export function pastedValue(text: string, digits: number): string | null {
  const minor = minorOf(text, digits);
  if (minor === null || minor > SAFE_MAX) return null;
  return show(minor, digits);
}

/** What the empty box suggests, e.g. "0.00" for USD and "0" for JPY. */
export const amountPlaceholder = (digits: number) =>
  decimalFromCents(0, digits);
