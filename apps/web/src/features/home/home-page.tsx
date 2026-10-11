import type { HomeLatest, HomeSummary } from "@ledgerline/shared";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ArrowLeftRight, ArrowUpRight, Wallet } from "lucide-react";
import { getLedgers } from "../../lib/api";
import { dayLabel } from "../transactions/filters";
import { useTransactionWorkspace } from "../transactions/workspace";
import { Amount, BaseNote } from "./amount";
import { getHome } from "./api";
import { monthLabel, useCurrentMonth } from "./month";

const typeLabels = {
  bank: "Bank",
  cash: "Cash",
  card: "Card",
  wallet: "Wallet",
  loan: "Loan",
  savings: "Savings",
} as const;

function latestTitle(row: HomeLatest) {
  const entry = row.transaction;
  if (entry.transferId)
    return `Transfer · ${row.accountName} → ${row.counterpartAccountName ?? "account"}`;
  return (
    entry.payee ||
    (entry.isSplit
      ? "Split transaction"
      : (row.categoryLabel ?? "Category unavailable"))
  );
}
function latestDetail(row: HomeLatest) {
  const entry = row.transaction;
  const parts = [dayLabel(entry.date)];
  if (!entry.transferId) parts.push(row.accountName);
  if (entry.isSplit) parts.push(`Split · ${entry.splits.length} categories`);
  if (entry.receivablePaymentId) parts.push("Service payment");
  return parts.join(" · ");
}

function LatestRow({ row }: { row: HomeLatest }) {
  const workspace = useTransactionWorkspace();
  const entry = row.transaction;
  const body = (
    <>
      <span className="transaction-row-description">
        <strong>{latestTitle(row)}</strong>
        <span>{latestDetail(row)}</span>
      </span>
      <span className="transaction-row-value">
        <strong>
          <Amount
            cents={entry.amount.amount}
            currency={entry.amount.currency}
          />
        </strong>
        <BaseNote amount={entry.amount} baseAmount={entry.baseAmount} />
        {entry.status === "pending" && (
          <span className="transaction-pending">Pending</span>
        )}
      </span>
    </>
  );
  return (
    <li>
      {workspace ? (
        <button
          type="button"
          className="transaction-row"
          disabled={workspace.blocked}
          onClick={() => workspace.openTransaction(entry)}
        >
          {body}
        </button>
      ) : (
        <Link to="/transactions" className="transaction-row">
          {body}
        </Link>
      )}
    </li>
  );
}

function Loading() {
  return (
    <div role="status" aria-live="polite">
      <p className="muted">Loading your overview…</p>
      <div className="home-skeleton" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
    </div>
  );
}

function Setup({
  summary,
  writable,
}: {
  summary: HomeSummary;
  writable: boolean;
}) {
  if (!summary.setup.hasActiveAccount)
    return (
      <section className="welcome-card" aria-labelledby="home-setup">
        <div className="welcome-art">
          <div className="orbit orbit-one" />
          <div className="orbit orbit-two" />
          <Wallet size={42} strokeWidth={1.3} />
        </div>
        <p className="eyebrow">ROOM FOR WHAT MATTERS</p>
        <h2 id="home-setup">Add your first account</h2>
        <p>
          {writable
            ? "Start with an account you use today and its current balance. Then use Add to record everyday income and expenses."
            : "This ledger has no accounts yet. Ask the ledger owner to add one."}
        </p>
        {writable && (
          <Link to="/more/accounts" className="button home-accounts-link">
            Set up accounts
            <ArrowUpRight size={18} />
          </Link>
        )}
      </section>
    );
  if (!summary.setup.hasCategory)
    return (
      <section className="home-notice">
        <p>
          {writable
            ? "Choose categories so every entry can be sorted."
            : "Categories haven't been set up yet."}
        </p>
        {writable && (
          <Link to="/more/categories" className="button secondary-button">
            Set up categories
          </Link>
        )}
      </section>
    );
  return null;
}

export function HomePage() {
  const month = useCurrentMonth();
  const ledgers = useQuery({ queryKey: ["ledgers"], queryFn: getLedgers });
  const ledger = ledgers.data?.items[0];
  const writable = !!ledger && ledger.role !== "viewer";
  const summary = useQuery({
    queryKey: ["home", ledger?.id, month],
    queryFn: ({ signal }) => getHome(ledger?.id as string, month, signal),
    enabled: !!ledger,
    staleTime: 0,
  });
  const data = summary.data;
  const failed = ledgers.isError || summary.isError;
  const label = monthLabel(month);
  return (
    <>
      <div className="page-heading">
        <p className="eyebrow">YOUR PERSONAL LEDGER</p>
        <h1>Home</h1>
        <p className="muted">{label}</p>
      </div>
      {failed && (
        <div className="account-error">
          <p role="alert">
            {data
              ? "Couldn't refresh. Showing the last numbers we loaded."
              : "Couldn't load your overview."}
          </p>
          <button
            type="button"
            className="secondary-button"
            onClick={() => {
              void ledgers.refetch();
              if (ledger) void summary.refetch();
            }}
          >
            Try again
          </button>
        </div>
      )}
      {!data && !failed && <Loading />}
      {ledgers.data && !ledger && (
        <p className="account-error">No ledger is available.</p>
      )}
      {data && (
        <>
          <Setup summary={data} writable={writable} />
          {data.setup.hasActiveAccount && (
            <>
              <section className="home-hero" aria-labelledby="home-in-hand">
                <p id="home-in-hand">In hand</p>
                <div className="amount">
                  <Amount cents={data.inHand.amount} />
                </div>
                <span className="muted">
                  Positive balances in bank, cash, wallet and savings accounts.
                  Cards, loans, pending entries and money owed to you are not
                  included.
                </span>
                {data.unconvertedCurrencies.length > 0 && (
                  <span className="muted" role="note">
                    {data.unconvertedCurrencies.join(", ")}{" "}
                    {data.unconvertedCurrencies.length === 1 ? "has" : "have"}{" "}
                    no exchange rate yet, so{" "}
                    {data.unconvertedCurrencies.length === 1
                      ? "that account is"
                      : "those accounts are"}{" "}
                    left out of these totals.{" "}
                    <Link to="/more/currencies">Add a rate</Link>
                  </span>
                )}
                {data.pendingCount > 0 && (
                  <span className="muted">
                    {data.pendingCount === 1
                      ? "1 pending entry isn't counted yet."
                      : `${data.pendingCount} pending entries aren't counted yet.`}
                  </span>
                )}
              </section>
              <section
                className="overview-grid"
                aria-label={`Totals for ${label}`}
              >
                <article className="stat-card">
                  <p>Money in this month</p>
                  <div className="amount">
                    <Amount cents={data.moneyIn.amount} />
                  </div>
                  <span className="muted">Cleared income in {label}</span>
                </article>
                <article className="stat-card">
                  <p>Money out this month</p>
                  <div className="amount">
                    <Amount cents={data.moneyOut.amount} />
                  </div>
                  <span className="muted">Cleared spending in {label}</span>
                </article>
                <Link
                  to="/more/people"
                  className="stat-card home-link-card"
                  aria-label="Owed to you. Open People"
                >
                  <p>Owed to you</p>
                  <div className="amount">
                    <Amount cents={data.owed.total.amount} />
                  </div>
                  <span className="muted">
                    {data.owed.personCount === 0
                      ? "Nobody owes you right now"
                      : data.owed.personCount === 1
                        ? "From 1 person"
                        : `From ${data.owed.personCount} people`}
                  </span>
                </Link>
              </section>
              <section className="activity-card">
                <div className="section-heading">
                  <h2>Accounts</h2>
                  <Link to="/more/accounts" className="quiet-link">
                    Manage accounts
                  </Link>
                </div>
                {data.accounts.length === 0 && data.otherActive.count === 0 && (
                  <p className="muted">
                    No bank, cash, wallet or savings accounts yet.
                  </p>
                )}
                <ul className="home-list">
                  {data.accounts.map((row) => (
                    <li key={row.id}>
                      <Link to="/more/accounts" className="home-account-row">
                        <span>
                          <strong>{row.name}</strong>
                          <span className="muted">
                            {typeLabels[row.type]}
                            {row.balance.amount < 0 ? " · Overdrawn" : ""}
                          </span>
                        </span>
                        <span className="home-account-amount">
                          <strong>
                            <Amount
                              cents={row.balance.amount}
                              currency={row.balance.currency}
                            />
                          </strong>
                          <BaseNote
                            amount={row.balance}
                            baseAmount={row.baseBalance}
                          />
                        </span>
                      </Link>
                    </li>
                  ))}
                  {data.otherActive.count > 0 && (
                    <li>
                      <Link to="/more/accounts" className="home-account-row">
                        <span>
                          <strong>
                            {data.otherActive.count} other{" "}
                            {data.otherActive.count === 1
                              ? "account"
                              : "accounts"}
                          </strong>
                        </span>
                        <strong>
                          <Amount cents={data.otherActive.balance.amount} />
                        </strong>
                      </Link>
                    </li>
                  )}
                  {data.archived.count > 0 && (
                    <li>
                      <Link to="/more/accounts" className="home-account-row">
                        <span>
                          <strong>Archived accounts</strong>
                          <span className="muted">
                            {data.archived.count} not counted in In hand
                          </span>
                        </span>
                        <strong>
                          <Amount cents={data.archived.balance.amount} />
                        </strong>
                      </Link>
                    </li>
                  )}
                </ul>
              </section>
            </>
          )}
          {data.setup.hasActiveAccount && (
            <section className="activity-card" aria-labelledby="home-latest">
              <div className="section-heading">
                <h2 id="home-latest">Latest transactions</h2>
                <Link to="/transactions" className="quiet-link">
                  View all
                </Link>
              </div>
              {data.latest.length === 0 ? (
                <div className="empty-activity">
                  <ArrowLeftRight size={24} strokeWidth={1.4} />
                  <p>
                    {writable
                      ? "Use Add to record your first entry"
                      : "No entries have been recorded yet"}
                  </p>
                </div>
              ) : (
                <ul className="home-list">
                  {data.latest.map((row) => (
                    <LatestRow key={row.transaction.id} row={row} />
                  ))}
                </ul>
              )}
            </section>
          )}
        </>
      )}
    </>
  );
}
