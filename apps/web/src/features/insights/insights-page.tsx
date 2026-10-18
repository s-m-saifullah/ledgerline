import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Amount } from "../../components/amount-text";
import { MonthSwitcher } from "../../components/month-switcher";
import { getLedgers } from "../../lib/api";
import { monthLabel, useCurrentMonth } from "../../lib/month";
import { getCashFlowReport, getSpendingReport } from "./api";
import { CashFlowChart } from "./cash-flow-chart";
import { SpendingList } from "./spending-list";

export function InsightsPage() {
  const current = useCurrentMonth();
  const [chosen, setChosen] = useState<string | null>(null);
  const month = chosen ?? current;
  const ledgers = useQuery({ queryKey: ["ledgers"], queryFn: getLedgers });
  const ledger = ledgers.data?.items[0];
  const spending = useQuery({
    queryKey: ["reports", "spending", ledger?.id, month],
    queryFn: ({ signal }) =>
      getSpendingReport(ledger?.id as string, month, signal),
    enabled: !!ledger,
    staleTime: 0,
  });
  const flow = useQuery({
    queryKey: ["reports", "cash-flow", ledger?.id, month],
    queryFn: ({ signal }) =>
      getCashFlowReport(ledger?.id as string, month, signal),
    enabled: !!ledger,
    staleTime: 0,
  });
  const selected = flow.data?.months.find((row) => row.month === month);
  const failed = ledgers.isError || spending.isError || flow.isError;
  const hasFlow = !!flow.data?.months.some(
    (row) => row.income.amount > 0 || row.spending.amount > 0,
  );
  return (
    <>
      <div className="page-heading">
        <p className="eyebrow">YOUR PERSONAL LEDGER</p>
        <h1 id="insights-title" tabIndex={-1}>
          Insights
        </h1>
        <MonthSwitcher month={month} onChange={setChosen} />
      </div>
      {failed && (
        <div className="account-error">
          <p role="alert">
            {spending.data || flow.data
              ? "Couldn't refresh. Showing the last numbers we loaded."
              : "Couldn't load your insights."}
          </p>
          <button
            type="button"
            className="secondary-button"
            onClick={() => {
              void ledgers.refetch();
              if (ledger) {
                void spending.refetch();
                void flow.refetch();
              }
            }}
          >
            Try again
          </button>
        </div>
      )}
      {!spending.data && !failed && (
        <p className="muted" role="status">
          Loading your insights…
        </p>
      )}
      {ledgers.data && !ledger && (
        <p className="account-error">No ledger is available.</p>
      )}
      {spending.data && (
        <>
          <section className="stat-card budget-summary">
            <p>Spent in {monthLabel(month)}</p>
            <div className="amount">
              <Amount cents={spending.data.total.amount} />
            </div>
            {selected && (
              <span className="muted">
                Money in <Amount cents={selected.income.amount} /> · Net{" "}
                <Amount cents={selected.net.amount} />
              </span>
            )}
          </section>
          <h2 className="insight-heading">Spending by category</h2>
          {spending.data.categories.length === 0 ? (
            <p className="muted">No spending in {monthLabel(month)}.</p>
          ) : (
            <SpendingList report={spending.data} />
          )}
        </>
      )}
      {flow.data && (
        <>
          <h2 className="insight-heading">
            Money in and out, 12 months to {monthLabel(month)}
          </h2>
          {hasFlow ? (
            <CashFlowChart report={flow.data} selected={month} />
          ) : (
            <p className="muted">Nothing recorded in these months.</p>
          )}
        </>
      )}
    </>
  );
}
