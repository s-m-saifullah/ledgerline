import type { Contact, LoanBalance } from "@ledgerline/shared";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Banknote,
  CircleSlash,
  History,
} from "lucide-react";
import { ActionBar } from "../../components/action-bar";
import { getTransactions } from "../transactions/api";
import { Amount } from "./amount";
import { getLoans, type LoanAction } from "./loans-api";

/** Money lent to or borrowed from this client (ADR 0030): one balance per currency and recent activity. */
export function useLoans(
  ledgerId: string | undefined,
  clientId: string | null,
) {
  return useQuery({
    queryKey: ["loans", ledgerId, clientId],
    queryFn: ({ signal }) =>
      getLoans(ledgerId as string, clientId as string, signal),
    enabled: !!ledgerId && !!clientId,
    refetchOnMount: "always",
  });
}
export function LoansSection({
  ledgerId,
  client,
  loans,
  writable,
  disabled,
  onAction,
}: {
  ledgerId: string;
  client: Contact;
  loans: LoanBalance[];
  writable: boolean;
  /** Archived clients and busy workspaces cannot start a new loan action. */
  disabled: boolean;
  onAction: (action: LoanAction) => void;
}) {
  const ids = loans.map((loan) => loan.accountId);
  const activity = useQuery({
    queryKey: ["loans", ledgerId, client.id, "activity", ids],
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
  if (loans.length === 0 && !writable) return null;
  const hasOpen = loans.some((loan) => loan.balance.amount !== 0);
  const actions = (
    [
      ["lend", `Lend money to ${client.name}`, "Lend", ArrowUpRight, true],
      [
        "borrow",
        `Borrow money from ${client.name}`,
        "Borrow",
        ArrowDownLeft,
        true,
      ],
      ["repay", "Record repayment", "Repayment", Banknote, hasOpen],
      ["forgive", "Forgive what is left", "Forgive", CircleSlash, hasOpen],
      ["opening", "Add an existing loan", "Existing loan", History, true],
    ] as const
  )
    .filter(([, , , , shown]) => shown)
    .map(([mode, label, shortLabel, icon]) => ({
      key: `loan-${mode}`,
      label,
      shortLabel,
      icon,
      disabled,
      onSelect: () => onAction(mode),
    }));
  const before = loans.filter((loan) => loan.openingBalance.amount !== 0);
  return (
    <section aria-label="Lent and borrowed" className="client-section">
      <h2>Lent and borrowed</h2>
      {loans.length === 0 ? (
        <p className="muted">
          Nothing lent or borrowed yet. Use the menu to lend, borrow or add a
          loan you already had.
        </p>
      ) : (
        <ul className="client-rows" aria-label="Loan balances">
          {loans.map((loan) => {
            const amount = loan.balance.amount;
            return (
              <li key={loan.accountId} className="loan-row">
                <span>
                  {amount > 0
                    ? `${client.name} owes you`
                    : amount < 0
                      ? `You owe ${client.name}`
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
      {writable && (
        <ActionBar
          actions={actions}
          menuLabel={`Lend and borrow actions for ${client.name}`}
          menuId="loan-menu"
        />
      )}
      {(activity.data?.length ?? 0) > 0 && (
        <>
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
                      ? "Forgiven by you"
                      : "Forgiven to you"}
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
