import { currencyDigits } from "@ledgerline/shared";

/**
 * Accept what people actually type ("$1,200.50", ".50", "5.") and return the plain
 * decimal the strict check expects. Anything that is not clearly one of those forms
 * is returned unchanged, so it still fails validation.
 */
export function cleanAmountText(text: string): string {
  let value = text
    .trim()
    .replace(/^\$\s*/, "")
    .replace(/\s+/g, "");
  if (/^\d{1,3}(,\d{3})+(\.\d*)?$/.test(value))
    value = value.replaceAll(",", "");
  if (/^\.\d/.test(value)) value = `0${value}`;
  if (/^\d+\.$/.test(value)) value = value.slice(0, -1);
  return value;
}
/** Keep the last unit exact even at the shared contract's safe-integer boundary. */
export function decimalFromCents(amount: number, digits = 2): string {
  const units = BigInt(amount);
  const absolute = units < 0n ? -units : units;
  const scale = 10n ** BigInt(digits);
  const whole = `${units < 0n ? "-" : ""}${absolute / scale}`;
  return digits === 0
    ? whole
    : `${whole}.${String(absolute % scale).padStart(digits, "0")}`;
}
const formatters = new Map<string, Intl.NumberFormat>();
function formatterFor(currency: string) {
  let found = formatters.get(currency);
  if (!found) {
    found = new Intl.NumberFormat("en-US", { style: "currency", currency });
    formatters.set(currency, found);
  }
  return found;
}
/** An amount in the smallest unit of `currency`, exact to the last unit ("$1,250.50", "¥1,000"). */
export function formatMoney(amount: number, currency = "USD"): string {
  const digits = currencyDigits(currency);
  const units = BigInt(amount);
  const absolute = units < 0n ? -units : units;
  const scale = 10n ** BigInt(digits);
  const fraction = String(absolute % scale).padStart(digits, "0");
  return `${units < 0n ? "-" : ""}${formatterFor(currency)
    .formatToParts(absolute / scale)
    .map((part) => (part.type === "fraction" ? fraction : part.value))
    .join("")}`;
}
export const formatUsd = (amount: number) => formatMoney(amount, "USD");
