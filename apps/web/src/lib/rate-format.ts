import { invertRate } from "@ledgerline/shared";

const names = new Intl.DisplayNames("en-US", { type: "currency" });
export const currencyName = (code: string) => names.of(code) ?? code;
/** "1 USD = 0.8915 EUR": the base currency always first, as people say it. */
export const rateSentence = (code: string, rate: string, base: string) =>
  `1 ${base} = ${invertRate(rate)} ${code}`;
/** Every ISO currency the platform knows, minus those already taken. */
export function addableCurrencies(taken: string[]) {
  return Intl.supportedValuesOf("currency")
    .filter((code) => !taken.includes(code))
    .map((code) => ({ code, name: currencyName(code) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
/** The device's current calendar date as YYYY-MM-DD (never shifted through UTC). */
export function today(now = new Date()) {
  return `${String(now.getFullYear()).padStart(4, "0")}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}
