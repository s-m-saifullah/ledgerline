import { type Account, currencyDigits, feeFromBps } from "@ledgerline/shared";
import {
  bpsToPercent,
  cleanAmountText,
  decimalFromCents,
  percentToBps,
} from "../../lib/money";
import { amountMinor, isPositiveAmount } from "./form";

/** What the one Fee box holds (ADR 0025): nothing, a fixed amount, a percentage, or a mistake. */
type FeeInput =
  | { kind: "none" }
  | { kind: "fixed"; minor: number }
  | { kind: "percent"; bps: number }
  | { kind: "invalid"; message: string };

export const feeHint =
  "Type 2 for a fixed fee, or 2% for a percentage of the amount sent.";

/** A plain number is a fixed fee in the sending currency; a number with % is a percentage. */
export function parseFee(text: string, currency: string): FeeInput {
  const typed = text.trim();
  if (typed === "") return { kind: "none" };
  if (typed.endsWith("%")) {
    const bps = percentToBps(cleanAmountText(typed.slice(0, -1)));
    return bps === null
      ? {
          kind: "invalid",
          message:
            "Enter a percentage between 0.01% and 100%, with up to two decimals.",
        }
      : { kind: "percent", bps };
  }
  const digits = currencyDigits(currency);
  const clean = cleanAmountText(typed);
  if (!isPositiveAmount(clean, currency))
    return {
      kind: "invalid",
      message:
        digits === 0
          ? "Enter a fee as a whole amount like 2, or a percentage like 2%."
          : "Enter a fee as an amount like 2 or 1.50, or a percentage like 2%.",
    };
  const minor = amountMinor(clean, currency);
  return minor === null
    ? { kind: "invalid", message: "Enter a smaller fee." }
    : { kind: "fixed", minor };
}

/** What the fee comes to in the sending currency's smallest unit; null until it can be known. */
export function feeMinor(fee: FeeInput, sent: number | null): number | null {
  if (fee.kind === "fixed") return fee.minor;
  if (fee.kind === "percent" && sent !== null) return feeFromBps(sent, fee.bps);
  return null;
}

/** An account's remembered fee as it would be typed into the box ("2.00" or "1.5%"). */
export function defaultFeeText(account: Account | undefined): string {
  const fee = account?.defaultFee;
  if (!fee) return "";
  return "basisPoints" in fee
    ? `${bpsToPercent(fee.basisPoints)}%`
    : decimalFromCents(fee.amount.amount, currencyDigits(fee.amount.currency));
}
