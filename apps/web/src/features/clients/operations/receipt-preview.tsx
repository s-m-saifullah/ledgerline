import type { ReceiptPreview as ReceiptPreviewData } from "@ledgerline/shared";
import { formatMoney } from "../../../lib/money";

export function ReceiptPreview({
  query,
  hasAmount,
  hidden,
  currency,
}: {
  currency: string;
  query: {
    data: ReceiptPreviewData | undefined;
    isError: boolean;
  };
  hasAmount: boolean;
  hidden: boolean;
}) {
  const money = (cents: number) =>
    hidden ? "••••" : formatMoney(cents, currency);
  if (!hasAmount)
    return (
      <p className="muted">
        Enter an amount to see which services it pays, oldest first.
      </p>
    );
  if (query.isError)
    return (
      <p role="alert">Could not preview this payment. Check the amount.</p>
    );
  const data = query.data;
  if (!data) return <p role="status">Checking open services…</p>;
  if (data.exceedsBalance)
    return (
      <p role="alert">
        That is more than the open balance of {money(data.openTotal.amount)}.
      </p>
    );
  if (data.tooManyServices)
    return (
      <p role="alert">
        This would cover more than 100 services. Record a smaller payment first.
      </p>
    );
  const full = data.allocations.filter((a) => a.remainingAfter.amount === 0);
  return (
    <div className="receipt-preview" aria-live="polite">
      <p>
        {full.length === data.allocations.length
          ? `Pays ${full.length} ${full.length === 1 ? "service" : "services"} in full.`
          : `Pays ${full.length} ${full.length === 1 ? "service" : "services"} in full and part of one more.`}
      </p>
      <ul className="client-rows">
        {data.allocations.map((a) => (
          <li className="service-row" key={a.receivableId}>
            <div className="row-main">
              <div className="row-text">
                <h3>{a.description}</h3>
                <p className="muted">
                  {a.serviceDate} ·{" "}
                  {a.remainingAfter.amount === 0
                    ? "Paid in full"
                    : `${money(a.remainingAfter.amount)} left`}
                </p>
              </div>
              <div className="row-figure">{money(a.applied.amount)}</div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
