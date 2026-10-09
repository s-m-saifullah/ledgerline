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
/** Keep the last cent exact even at the shared contract's safe-integer boundary. */
export function decimalFromCents(amount: number): string {
  const cents = BigInt(amount);
  const absolute = cents < 0n ? -cents : cents;
  return `${cents < 0n ? "-" : ""}${absolute / 100n}.${String(absolute % 100n).padStart(2, "0")}`;
}
const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});
export function formatUsd(amount: number): string {
  const cents = BigInt(amount);
  const absolute = cents < 0n ? -cents : cents;
  const fraction = String(absolute % 100n).padStart(2, "0");
  return `${cents < 0n ? "-" : ""}${usd
    .formatToParts(absolute / 100n)
    .map((part) => (part.type === "fraction" ? fraction : part.value))
    .join("")}`;
}
