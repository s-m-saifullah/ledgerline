import { useQuery } from "@tanstack/react-query";
import { Amount } from "../home/amount";
import { getHome } from "../home/api";
import { useCurrentMonth } from "../home/month";

/** Net worth lives here, on purpose, not on Home: Home shows money in hand. */
export function NetWorthCard({ ledgerId }: { ledgerId: string }) {
  const month = useCurrentMonth();
  const summary = useQuery({
    queryKey: ["home", ledgerId, month],
    queryFn: ({ signal }) => getHome(ledgerId, month, signal),
    staleTime: 0,
  });
  const data = summary.data;
  if (!data?.setup.hasActiveAccount) return null;
  return (
    <section
      className="settings-card net-worth-card"
      aria-labelledby="net-worth"
    >
      <p id="net-worth">Net worth</p>
      <div className="amount">
        <Amount cents={data.netWorth.amount} />
      </div>
      <p className="muted">
        Everything you own minus everything you owe, across all accounts
        including archived ones. Money owed to you in People is not included.
      </p>
      {data.unconvertedCurrencies.length > 0 && (
        <p className="muted" role="note">
          Accounts in {data.unconvertedCurrencies.join(", ")} are left out until
          they have an exchange rate.
        </p>
      )}
      <p className="net-worth-owed">
        <span>Owed on cards and loans</span>
        <strong>
          <Amount cents={data.liabilitiesOwed.amount} />
        </strong>
      </p>
    </section>
  );
}
