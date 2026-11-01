import type { Contact } from "@ledgerline/shared";
import { Amount } from "../../components/amount-text";

/**
 * What a client owes: each currency's balance and, when any is not dollars, its worth in dollars at today's
 * rates. `short` keeps only "About $X" for a list row; the card says "at today's rates" and names a currency
 * that has no rate yet.
 */
export function Balances({
  client,
  short = false,
}: {
  client: Contact;
  short?: boolean;
}) {
  if (!client.openBalances.length) return <Amount cents={0} />;
  const foreign = client.openBalances.some((b) => b.currency !== "USD");
  return (
    <span className="cl-balances">
      {client.openBalances.map((b) => (
        <Amount key={b.currency} cents={b.amount} currency={b.currency} />
      ))}
      {foreign && (
        <span className="cl-about">
          About <Amount cents={client.openBalance.amount} />
          {short ? "" : " at today's rates"}
          {!short && client.unconvertedCurrencies.length > 0
            ? `, not counting ${client.unconvertedCurrencies.join(", ")} (no rate yet)`
            : ""}
        </span>
      )}
    </span>
  );
}
