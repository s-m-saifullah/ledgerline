import { useContext } from "react";
import { formatMoney } from "../accounts/money";
import { PrivacyContext } from "../shell/preferences";

/** Privacy mode removes the digits from the page, not just from view. */
export function Amount({
  cents,
  currency = "USD",
  className,
}: {
  cents: number;
  currency?: string;
  className?: string;
}) {
  const hidden = useContext(PrivacyContext);
  return hidden ? (
    <span className={className}>
      <span aria-hidden="true">••••</span>
      <span className="sr-only">Amount hidden</span>
    </span>
  ) : (
    <span className={className}>{formatMoney(cents, currency)}</span>
  );
}

/**
 * "About $112.17": what an amount in another currency is worth in the base currency. Shown
 * only when the currencies differ and a base value is known.
 */
export function BaseNote({
  amount,
  baseAmount,
}: {
  amount: { currency: string };
  baseAmount: { amount: number; currency: string } | null;
}) {
  if (!baseAmount || amount.currency === baseAmount.currency) return null;
  return (
    <span className="base-note muted">
      About <Amount cents={baseAmount.amount} currency={baseAmount.currency} />
    </span>
  );
}
