import { deriveRate } from "@ledgerline/shared";
import { rateSentence } from "../../../lib/rate-format";

/**
 * When one side of a payment is in USD, the two amounts fix the rate; show it so a typo in the
 * amount received is easy to spot ("1 USD = 120 BDT").
 */
export function PaymentRate({
  settled,
  received,
  itemCurrency,
  accountCurrency,
}: {
  settled: number | null;
  received: number | null;
  itemCurrency: string;
  accountCurrency: string;
}) {
  if (settled === null || received === null) return null;
  const base =
    itemCurrency === "USD"
      ? settled
      : accountCurrency === "USD"
        ? received
        : null;
  if (base === null) return null;
  const foreign = itemCurrency === "USD" ? accountCurrency : itemCurrency;
  const foreignAmount = itemCurrency === "USD" ? received : settled;
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
