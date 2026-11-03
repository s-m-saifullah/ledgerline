import type { LoanBalance } from "@ledgerline/shared";
import { EmptyState, ListCard, ListRow, SectionLabel } from "@ledgerline/ui";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Amount } from "../../components/amount-text";
import { getTransactions } from "../transactions/api";
import { getLoans } from "./loans-api";
import { activityWord } from "./model";

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

/** An amount with a small text button under it, for a row that has one thing to do with its figure. */
function FigureWith({
  figure,
  button,
}: {
  figure: React.ReactNode;
  button: React.ReactNode;
}) {
  return (
    <span className="ln-end">
      {figure}
      {button}
    </span>
  );
}

/**
 * One person's balances, the balance from before Ledgerline and the latest moves (the prototype's
 * `personDetail`). A person can have a loan in several currencies, so each gets its own row.
 */
export function PersonLoans({
  ledgerId,
  personId,
  name,
  loans,
  writable,
  onEdit,
  onRemove,
}: {
  ledgerId: string;
  personId: string;
  name: string;
  loans: LoanBalance[];
  writable: boolean;
  onEdit: (currency: string) => void;
  onRemove: (loan: LoanBalance) => void;
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
  const moves = activity.data ?? [];
  return (
    <section aria-label="Balance and activity" className="ln-sections">
      <div>
        <SectionLabel>Balance</SectionLabel>
        {loans.length === 0 ? (
          <div className="ui-card">
            <EmptyState text="Nothing lent or borrowed yet." />
          </div>
        ) : (
          <ListCard>
            {loans.map((loan) => {
              const amount = loan.balance.amount;
              return (
                <ListRow
                  key={loan.accountId}
                  title={
                    amount > 0
                      ? `${name} owes you`
                      : amount < 0
                        ? `You owe ${name}`
                        : `Settled (${loan.currency})`
                  }
                  value={
                    <FigureWith
                      figure={
                        amount !== 0 ? (
                          <Amount
                            cents={Math.abs(amount)}
                            currency={loan.balance.currency}
                          />
                        ) : null
                      }
                      button={
                        writable && (
                          <button
                            type="button"
                            id={`loan-remove-${loan.currency}`}
                            className="ui-btn ui-btn-text ln-small"
                            aria-label={`Remove the ${loan.currency} loan`}
                            onClick={() => onRemove(loan)}
                          >
                            Remove
                          </button>
                        )
                      }
                    />
                  }
                />
              );
            })}
          </ListCard>
        )}
      </div>
      {before.length > 0 && (
        <div>
          <SectionLabel>Before Ledgerline</SectionLabel>
          <ListCard>
            {before.map((loan) => (
              <ListRow
                key={loan.accountId}
                title="Before Ledgerline"
                hint={
                  loan.openingBalance.amount > 0 ? "Owed to you" : "You owed"
                }
                value={
                  <FigureWith
                    figure={
                      <Amount
                        cents={Math.abs(loan.openingBalance.amount)}
                        currency={loan.openingBalance.currency}
                      />
                    }
                    button={
                      writable && (
                        <button
                          type="button"
                          id={`loan-edit-${loan.currency}`}
                          className="ui-btn ui-btn-text ln-small"
                          aria-label={`Change the balance from before Ledgerline (${loan.currency})`}
                          onClick={() => onEdit(loan.currency)}
                        >
                          Change
                        </button>
                      )
                    }
                  />
                }
              />
            ))}
          </ListCard>
        </div>
      )}
      {moves.length > 0 && (
        <div>
          <SectionLabel>Activity</SectionLabel>
          <ListCard>
            {moves.map((entry) => (
              <ListRow
                key={entry.id}
                title={activityWord(entry)}
                hint={entry.date}
                value={
                  <Amount
                    cents={Math.abs(entry.amount.amount)}
                    currency={entry.amount.currency}
                  />
                }
              />
            ))}
          </ListCard>
          <Link to="/transactions" className="ui-btn ui-btn-text ln-all">
            See every entry in Transactions
          </Link>
        </div>
      )}
    </section>
  );
}
