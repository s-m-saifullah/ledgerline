import {
  currencyDigits,
  hourlyTotal,
  hoursToHundredths,
} from "@ledgerline/shared";
import { decimalFromCents, formatMoney } from "../../lib/money";
import { positiveMoney } from "./form";

/** "3.5" for 350 hundredths, "0.25" for 25: no trailing zeros. */
function hoursText(hundredths: number) {
  return String(hundredths / 100);
}

type HourlyResult =
  | { ok: true; total: number; hours: string; rate: string }
  | { ok: false; message: string };

/** The total for hours at an hourly rate, in the currency's smallest unit (ADR 0026). Null while a box is empty. */
export function hourlyResult(
  hoursInput: string,
  rateInput: string,
  currency: string,
): HourlyResult | null {
  if (!hoursInput.trim() || !rateInput.trim()) return null;
  const hundredths = hoursToHundredths(hoursInput);
  if (hundredths === null)
    return {
      ok: false,
      message: "Enter hours as a number with up to two decimals, such as 3.5.",
    };
  let rate: number;
  try {
    rate = positiveMoney(rateInput, currency).amount;
  } catch (error) {
    return { ok: false, message: (error as Error).message };
  }
  const total = hourlyTotal(rate, hundredths);
  if (total === null || total < 1)
    return {
      ok: false,
      message: "That total is outside the amount range Ledgerline can store.",
    };
  return {
    ok: true,
    total,
    hours: hoursText(hundredths),
    rate: formatMoney(rate, currency),
  };
}

/** The amount box text for a total, e.g. "140.00" (no decimals for JPY, three for BHD). */
export const totalText = (total: number, currency: string) =>
  decimalFromCents(total, currencyDigits(currency));
