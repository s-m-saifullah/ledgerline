import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { MonthHead } from "../../components/month-head";
import { getLedgers } from "../../lib/api";
import { useCurrentMonth } from "../../lib/month";
import { getAllAccounts } from "../transactions/api";
import { getCashFlowReport, getNetWorthReport, getSpendingReport } from "./api";
import { CashFlowCard } from "./cash-flow-card";
import { Figures } from "./figures";
import { fromHistory, showCashFlow, worthSnapshot } from "./model";
import { NetWorthCard } from "./net-worth-card";
import { NetWorthNow } from "./net-worth-now";
import { SpendingCard } from "./spending-card";
import { SummaryCard } from "./summary-card";
import "./insights.css";

/** Insights (ADR 0047): this month, spending by category, money in and out, net worth now and over time. */
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
  const worth = useQuery({
    queryKey: ["reports", "net-worth", ledger?.id, month],
    queryFn: ({ signal }) =>
      getNetWorthReport(ledger?.id as string, month, signal),
    enabled: !!ledger,
    staleTime: 0,
  });
  // Net worth now is today's, so it does not follow the month; the balances are the accounts' own.
  const accounts = useQuery({
    queryKey: ["accounts", ledger?.id, "insights"],
    queryFn: ({ signal }) => getAllAccounts(ledger?.id as string, signal),
    enabled: !!ledger,
    staleTime: 0,
  });
  const selected = flow.data?.months.find((row) => row.month === month);
  const failed =
    ledgers.isError || spending.isError || flow.isError || worth.isError;
  // Both charts and the figures begin on the month the ledger started to be used, where the net worth report says.
  const trimmed = flow.data
    ? fromHistory(flow.data, worth.data?.historyStart)
    : null;
  // Not drawn until that is known, so it never shows twelve months and then shrinks; if it fails, the chart is whole.
  const cash =
    trimmed && !worth.isPending && showCashFlow(trimmed) ? trimmed : null;
  const snapshot = accounts.data ? worthSnapshot(accounts.data) : null;
  return (
    <div className="ins-page">
      <MonthHead
        title="Insights"
        id="insights-title"
        month={month}
        onChange={setChosen}
      />
      {failed && (
        <div className="ui-card ins-error">
          <p role="alert">
            {spending.data || flow.data || worth.data
              ? "Couldn't refresh. Showing the last numbers we loaded."
              : "Couldn't load your insights."}
          </p>
          <button
            type="button"
            className="ui-btn ui-btn-secondary"
            onClick={() => {
              void ledgers.refetch();
              if (ledger) {
                void spending.refetch();
                void flow.refetch();
                void worth.refetch();
                void accounts.refetch();
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
        <SummaryCard
          spent={spending.data.total.amount}
          income={selected ? selected.income.amount : null}
          net={selected ? selected.net.amount : null}
        />
      )}
      {spending.data && (
        <div className={`ins-cols${cash || snapshot ? "" : " ins-cols-one"}`}>
          <SpendingCard report={spending.data} month={month} />
          {(cash || snapshot) && (
            <div className="ins-stack">
              {cash && <CashFlowCard report={cash} selected={month} />}
              {snapshot && <NetWorthNow snapshot={snapshot} />}
            </div>
          )}
        </div>
      )}
      {worth.data && <NetWorthCard report={worth.data} selected={month} />}
      <Figures flow={cash} worth={worth.data ?? null} />
    </div>
  );
}
