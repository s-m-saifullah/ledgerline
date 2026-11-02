import type { ReceiptPreview as ReceiptPreviewData } from "@ledgerline/shared";
import { ListCard, ListRow, SectionLabel } from "@ledgerline/ui";
import { Amount } from "../../../components/amount";
import { formatMoney } from "../../../lib/money";

/** What a new receipt pays, oldest first (`OV.receive`): one row a service with how much is left, and a line for the whole. */
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
      <p className="ed-note">
        Enter an amount to see which services it pays, oldest first.
      </p>
    );
  if (query.isError)
    return (
      <p role="alert" className="field-error">
        Could not preview this payment. Check the amount.
      </p>
    );
  const data = query.data;
  if (!data)
    return (
      <p role="status" className="ed-note">
        Checking open services…
      </p>
    );
  if (data.exceedsBalance)
    return (
      <p role="alert" className="field-error">
        That is more than the open balance of {money(data.openTotal.amount)}.
      </p>
    );
  if (data.tooManyServices)
    return (
      <p role="alert" className="field-error">
        This would cover more than 100 services. Record a smaller payment first.
      </p>
    );
  const full = data.allocations.filter((a) => a.remainingAfter.amount === 0);
  return (
    <div className="receipt-preview ed-preview" aria-live="polite">
      <SectionLabel>Pays, oldest first</SectionLabel>
      <ListCard>
        {data.allocations.map((a) => (
          <ListRow
            key={a.receivableId}
            title={a.description}
            hint={
              a.remainingAfter.amount === 0
                ? "Paid in full"
                : `${money(a.remainingAfter.amount)} left`
            }
            value={<Amount value={a.applied.amount} currency={currency} />}
          />
        ))}
      </ListCard>
      <p className="ed-note">
        {full.length === data.allocations.length
          ? `Pays ${full.length} ${full.length === 1 ? "service" : "services"} in full.`
          : `Pays ${full.length} ${full.length === 1 ? "service" : "services"} in full and part of one more.`}
      </p>
    </div>
  );
}
