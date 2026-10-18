import { deriveRate } from "@ledgerline/shared";
import { rateSentence } from "../../../lib/rate-format";

/**
 * When one account is in USD, the amounts themselves fix the rate; show it so a typo in the
 * received amount is easy to spot ("1 USD = 0.89 EUR").
 */
export function TransferRate({
  sent,
  received,
  fromCurrency,
  toCurrency,
}: {
  sent: number | null;
  received: number | null;
  fromCurrency: string;
  toCurrency: string;
}) {
  if (sent === null || received === null) return null;
  const base =
    fromCurrency === "USD" ? sent : toCurrency === "USD" ? received : null;
  if (base === null) return null;
  const foreign = fromCurrency === "USD" ? toCurrency : fromCurrency;
  const foreignAmount = fromCurrency === "USD" ? received : sent;
  return (
    <p className="form-help" aria-live="polite">
      {rateSentence(
        foreign,
        deriveRate(base, foreignAmount, foreign, "USD"),
        "USD",
      )}
    </p>
  );
}
