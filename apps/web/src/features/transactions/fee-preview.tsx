import { Amount } from "../home/amount";

/** What the fee comes to, and what leaves the sending account in all. */
export function FeePreview({
  fee,
  cost,
  sent,
  currency,
  accountName,
}: {
  fee: "none" | "fixed" | "percent" | "invalid";
  cost: number | null;
  sent: number | null;
  currency: string;
  accountName: string;
}) {
  if (fee === "none" || fee === "invalid") return null;
  if (cost === null) return <>Enter the amount to see the fee.</>;
  return (
    <>
      Fee <Amount cents={cost} currency={currency} />
      {sent !== null && (
        <>
          {" "}
          · <Amount cents={sent + cost} currency={currency} /> leaves{" "}
          {accountName}
        </>
      )}
    </>
  );
}
