import { useContext } from "react";
import { formatMoney } from "../accounts/money";
import { PrivacyContext } from "../shell/preferences";

/** A money amount that follows privacy mode. */
export function Amount({
  value,
  currency = "USD",
}: {
  value: number;
  currency?: string;
}) {
  const hidden = useContext(PrivacyContext);
  return (
    <span className="amount">
      {hidden ? (
        <>
          <span aria-hidden="true">••••</span>
          <span className="sr-only">Amount hidden</span>
        </>
      ) : (
        formatMoney(value, currency)
      )}
    </span>
  );
}
