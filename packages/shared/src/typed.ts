import { rateFromInverse } from "./currency";
import { hoursToHundredths } from "./receivables";

/**
 * What a person typed in a number box, read as they meant it: ".8" is 0.8 and "8." is 8 (a point with
 * nothing before or after it is what a decimal looks like while it is being typed). Anything else is
 * returned trimmed and otherwise unchanged, so it still fails the strict reader it is passed to.
 */
export function typedDecimal(text: string): string {
  let value = text.trim();
  if (/^\.\d/.test(value)) value = `0${value}`;
  if (/^\d+\.$/.test(value)) value = value.slice(0, -1);
  return value;
}

/** The rate to store for a typed rate ("1 USD is worth 122.5 BDT"): `rateFromInverse` after `typedDecimal`. */
export function rateFromTyped(text: string): string | null {
  return rateFromInverse(typedDecimal(text));
}

/** Hours typed in a box as hundredths of an hour: `hoursToHundredths` after `typedDecimal`. */
export function hoursFromTyped(text: string): number | null {
  return hoursToHundredths(typedDecimal(text));
}
