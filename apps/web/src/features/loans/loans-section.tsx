import type { LoanBalance } from "@ledgerline/shared";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Amount } from "../../components/amount";
import { getTransactions } from "../transactions/api";
import { getLoans } from "./loans-api";

export function useLoans(
  ledgerId: string | undefined,
  personId: string | null,
) {
  return useQuery({
    queryKey: ["loans", ledgerId, personId],
    queryFn: ({ signal }) =>
      getLoans(ledgerId as string, personId as string, signal),
    enabled: !!ledgerId && !!personId,
    refetchOnMount: "always",
  });
}
/** What one person owes you or you owe them, per currency (positive: they owe you). */
export function BalanceLines({
  name,
  loans,
}: {
  name: string;
  loans: LoanBalance[];
}) {
  return (
    <ul className="client-rows" aria-label="Loan balances">
      {loans.map((loan) => {
        const amount = loan.balance.amount;
        return (
          <li key={loan.accountId} className="loan-row">
            <span>
              {amount > 0
                ? `${name} owes you`
                : amount < 0
                  ? `You owe ${name}`
                  : `Settled (${loan.currency})`}
            </span>
            {amount !== 0 && (
              <strong>
                <Amount
                  value={Math.abs(amount)}
                  currency={loan.balance.currency}
                />
              </strong>
            )}
          </li>
        );
      })}
    </ul>
  );
}
/** One person's balances, the balance from before Ledgerline, and the latest moves. */
export function PersonLoans({
  ledgerId,
  personId,
  name,
  loans,
}: {
  ledgerId: string;
  personId: string;
  name: string;
  loans: LoanBalance[];
}) {
  const ids = loans.map((loan) => loan.accountId);
  const activity = useQuery({
    queryKey: ["loans", ledgerId, personId, "activity", ids],
    queryFn: async ({ signal }) => {
      const pages = await Promise.all(
        ids.map((accountId) =>
          getTransactions(ledgerId, { accountId, limit: "8" }, null, signal),
        ),
      );
      return pages
        .flatMap((page) => page.items)
        .sort((a, b) =>
          a.date === b.date ? (a.id < b.id ? 1 : -1) : a.date < b.date ? 1 : -1,
        )
        .slice(0, 8);
    },
    enabled: ids.length > 0,
  });
  const before = loans.filter((loan) => loan.openingBalance.amount !== 0);
  return (
    <section aria-label="Balance and activity" className="client-section">
      <h2>Balance</h2>
      {loans.length === 0 ? (
        <p className="muted">
          Nothing lent or borrowed yet. Use the actions above to lend, borrow or
          add a loan you already had.
        </p>
      ) : (
        <BalanceLines name={name} loans={loans} />
      )}
      {before.length > 0 && (
        <p className="muted loan-note">
          Before Ledgerline:{" "}
          {before.map((loan, index) => (
            <span key={loan.accountId}>
              {index > 0 && ", "}
              {loan.openingBalance.amount > 0 ? "owed to you " : "you owed "}
              <Amount
                value={Math.abs(loan.openingBalance.amount)}
                currency={loan.openingBalance.currency}
              />
            </span>
          ))}
        </p>
      )}
      {(activity.data?.length ?? 0) > 0 && (
        <>
          <h2>Activity</h2>
          <ul className="client-rows" aria-label="Loan activity">
            {activity.data?.map((entry) => (
              <li className="loan-row" key={entry.id}>
                <span>
                  {entry.date}{" "}
                  {entry.kind === "transfer"
                    ? entry.amount.amount > 0
                      ? "You paid out"
                      : "You received"
                    : entry.kind === "expense"
                      ? "You waived"
                      : "They waived"}
                </span>
                <Amount
                  value={Math.abs(entry.amount.amount)}
                  currency={entry.amount.currency}
                />
              </li>
            ))}
          </ul>
          <p className="muted">
            <Link to="/transactions">See every entry in Transactions</Link>
          </p>
        </>
      )}
    </section>
  );
}
