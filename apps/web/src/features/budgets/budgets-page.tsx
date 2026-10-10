import type { BudgetLine } from "@ledgerline/shared";
import { Button } from "@ledgerline/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useState } from "react";
import { getLedgers } from "../../lib/api";
import { Amount } from "../home/amount";
import { monthLabel, useCurrentMonth } from "../home/month";
import { getBudgetMonth, prepareBudgetCopy } from "./api";
import { BudgetEditor } from "./budget-editor";
import { shiftMonth } from "./month";

/** How much of the month's allowance (budget plus carried-in) is used, capped to the bar. */
export function usedShare(line: BudgetLine) {
  if (!line.budget) return 0;
  const allowance = line.budget.amount.amount + line.carriedIn.amount;
  if (allowance <= 0) return line.spent.amount > 0 ? 1 : 0;
  return Math.min(1, Math.max(0, line.spent.amount / allowance));
}

function LeftText({ line }: { line: BudgetLine }) {
  if (!line.left) return <span className="muted">No budget</span>;
  const over = line.left.amount < 0;
  return (
    <span className={over ? "budget-over" : undefined}>
      <Amount cents={Math.abs(line.left.amount)} /> {over ? "over" : "left"}
    </span>
  );
}

function Line({
  line,
  writable,
  onOpen,
}: {
  line: BudgetLine;
  writable: boolean;
  onOpen: () => void;
}) {
  const over = (line.left?.amount ?? 0) < 0;
  const body = (
    <>
      <span className="budget-line-top">
        <strong>{line.name}</strong>
        <LeftText line={line} />
      </span>
      {line.budget && (
        <span className={`budget-bar${over ? " over" : ""}`} aria-hidden="true">
          <span
            className="budget-bar-fill"
            style={{ width: `${Math.round(usedShare(line) * 100)}%` }}
          />
        </span>
      )}
      <span className="budget-line-detail muted">
        {line.budget ? (
          <>
            Spent <Amount cents={line.spent.amount} /> of{" "}
            <Amount cents={line.budget.amount.amount} />
            {line.carriedIn.amount !== 0 && (
              <>
                {" "}
                · {line.carriedIn.amount > 0 ? "Carried over " : "Overspent "}
                <Amount cents={Math.abs(line.carriedIn.amount)} />
              </>
            )}
          </>
        ) : (
          <>
            {line.spent.amount > 0 ? (
              <>
                Spent <Amount cents={line.spent.amount} />
              </>
            ) : (
              "Nothing spent"
            )}
            {writable && " · Tap to set a budget"}
          </>
        )}
      </span>
    </>
  );
  return (
    <li>
      {writable ? (
        <button
          type="button"
          id={`budget-line-${line.categoryId}`}
          className="budget-line"
          onClick={onOpen}
        >
          {body}
        </button>
      ) : (
        <div className="budget-line">{body}</div>
      )}
    </li>
  );
}

export function BudgetsPage() {
  const current = useCurrentMonth();
  const [chosen, setChosen] = useState<string | null>(null);
  const month = chosen ?? current;
  const [editing, setEditing] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [copying, setCopying] = useState(false);
  const client = useQueryClient();
  const ledgers = useQuery({ queryKey: ["ledgers"], queryFn: getLedgers });
  const ledger = ledgers.data?.items[0];
  const writable = !!ledger && ledger.role !== "viewer";
  const view = useQuery({
    queryKey: ["budgets", ledger?.id, month],
    queryFn: ({ signal }) =>
      getBudgetMonth(ledger?.id as string, month, signal),
    enabled: !!ledger,
    staleTime: 0,
  });
  const data = view.data;
  const refresh = () => {
    void client.invalidateQueries({ queryKey: ["budgets", ledger?.id] });
    // Budgets feed no Home number yet, but keep the cache honest if that changes.
  };
  const hasBudgets = !!data?.items.some((line) => line.budget);
  const editingLine = data?.items.find((line) => line.categoryId === editing);
  const previous = shiftMonth(month, -1);
  const copy = async () => {
    if (!ledger) return;
    setCopying(true);
    setNotice("");
    try {
      const result = await prepareBudgetCopy(ledger.id, previous, month)();
      setNotice(
        result.items.length
          ? `Copied ${result.items.length} ${result.items.length === 1 ? "budget" : "budgets"} from ${monthLabel(previous)}.`
          : `Nothing to copy from ${monthLabel(previous)}.`,
      );
      refresh();
    } catch {
      setNotice("Couldn't copy the budgets. Please try again.");
    } finally {
      setCopying(false);
    }
  };
  return (
    <>
      <div className="page-heading">
        <p className="eyebrow">YOUR PERSONAL LEDGER</p>
        <h1 id="budgets-title" tabIndex={-1}>
          Budgets
        </h1>
        <div className="month-switcher">
          <button
            type="button"
            className="icon-button"
            aria-label="Previous month"
            onClick={() => setChosen(previous)}
          >
            <ChevronLeft size={20} />
          </button>
          <p className="muted" aria-live="polite">
            {monthLabel(month)}
          </p>
          <button
            type="button"
            className="icon-button"
            aria-label="Next month"
            onClick={() => setChosen(shiftMonth(month, 1))}
          >
            <ChevronRight size={20} />
          </button>
        </div>
      </div>
      {(ledgers.isError || view.isError) && (
        <div className="account-error">
          <p role="alert">
            {data
              ? "Couldn't refresh. Showing the last numbers we loaded."
              : "Couldn't load your budgets."}
          </p>
          <button
            type="button"
            className="secondary-button"
            onClick={() => {
              void ledgers.refetch();
              if (ledger) void view.refetch();
            }}
          >
            Try again
          </button>
        </div>
      )}
      {!data && !view.isError && !ledgers.isError && (
        <p className="muted" role="status">
          Loading your budgets…
        </p>
      )}
      {ledgers.data && !ledger && (
        <p className="account-error">No ledger is available.</p>
      )}
      {data && (
        <>
          {hasBudgets ? (
            <section className="stat-card budget-summary">
              <p>Left this month</p>
              <div
                className={`amount${data.totals.left.amount < 0 ? " budget-over" : ""}`}
              >
                <Amount cents={data.totals.left.amount} />
              </div>
              <span className="muted">
                Budgeted <Amount cents={data.totals.budgeted.amount} /> · Spent{" "}
                <Amount cents={data.totals.spent.amount} />
                {data.totals.carriedIn.amount !== 0 && (
                  <>
                    {" "}
                    · Carried in <Amount cents={data.totals.carriedIn.amount} />
                  </>
                )}
              </span>
            </section>
          ) : (
            <section className="stat-card budget-summary">
              <p>No budgets for {monthLabel(month)} yet.</p>
              <span className="muted">
                {writable
                  ? "Pick a category below to set one, or start from last month."
                  : "Nothing has been budgeted for this month."}
              </span>
              {writable && (
                <div className="account-dialog-actions">
                  <Button type="button" disabled={copying} onClick={copy}>
                    {copying ? "Copying…" : `Copy from ${monthLabel(previous)}`}
                  </Button>
                </div>
              )}
            </section>
          )}
          {notice && (
            <p role="status" className="muted">
              {notice}
            </p>
          )}
          {data.items.length === 0 ? (
            <p className="muted">
              Add an expense category first, then budget it here.
            </p>
          ) : (
            <ul className="budget-list" aria-label="Budgets by category">
              {data.items.map((line) => (
                <Line
                  key={line.categoryId}
                  line={line}
                  writable={writable}
                  onOpen={() => setEditing(line.categoryId)}
                />
              ))}
            </ul>
          )}
          {hasBudgets && data.totals.unbudgetedSpent.amount > 0 && (
            <p className="muted">
              Spent without a budget:{" "}
              <Amount cents={data.totals.unbudgetedSpent.amount} />
            </p>
          )}
        </>
      )}
      {ledger && editingLine && (
        <BudgetEditor
          key={`${editingLine.categoryId}-${month}-${editingLine.budget?.version ?? 0}`}
          ledgerId={ledger.id}
          month={month}
          line={editingLine}
          onDismiss={() => setEditing(null)}
          onChanged={refresh}
        />
      )}
    </>
  );
}
