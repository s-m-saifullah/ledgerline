import { useContext } from "react";
import { formatUsd } from "../accounts/money";
import { PrivacyContext } from "../shell/preferences";

/** Privacy mode removes the digits from the page, not just from view. */
export function Amount({
  cents,
  className,
}: {
  cents: number;
  className?: string;
}) {
  const hidden = useContext(PrivacyContext);
  return hidden ? (
    <span className={className}>
      <span aria-hidden="true">••••</span>
      <span className="sr-only">Amount hidden</span>
    </span>
  ) : (
    <span className={className}>{formatUsd(cents)}</span>
  );
}
