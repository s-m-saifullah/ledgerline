import type { BudgetLine } from "@ledgerline/shared";
import {
  Avatar,
  cn,
  EmptyState,
  Hero,
  ListCard,
  ProportionBar,
  RowBody,
} from "@ledgerline/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown } from "lucide-react";
import { useState } from "react";
import { Amount } from "../../components/amount-text";
import { MonthControl } from "../../components/month-control";
import { Toast } from "../../components/toast";
import { getLedgers } from "../../lib/api";
import { monthLabel, shiftMonth, useCurrentMonth } from "../../lib/month";
import { getBudgetMonth, prepareBudgetCopy } from "./api";
import { LimitSheet } from "./limit-sheet";
import {
  allowanceOf,
  daysLeft,
  lineState,
  percentUsed,
  shareOf,
  splitLines,
  usedShare,
} from "./model";
import "./budgets.css";

/** The days left in the month, in words, for the hero's line; nothing for another month. */
function daysText(days: number | null) {
  if (days === null) return "";
  if (days === 0) return " · Last day";
  return ` · ${days} ${days === 1 ? "day" : "days"} left`;
}

/** One budgeted category: avatar, name, what is left, the bar and one hint. */
function BudgetRow({
  line,
  writable,
  onOpen,
}: {
  line: BudgetLine;
  writable: boolean;
  onOpen: () => void;
}) {
  const left = line.left?.amount ?? 0;
  const over = left < 0;
  const share = usedShare(line);
  const carried = line.carriedIn.amount;
  const body = (
    <>
      <Avatar name={line.name} />
      <span className="ui-row-main bud-main">
        <span className="bud-top">
          <span className="ui-row-title">{line.name}</span>
          <span className={cn("bud-left", over && "bud-over")}>
            <Amount cents={Math.abs(left)} /> {over ? "over" : "left"}
          </span>
        </span>
        <ProportionBar
          share={share}
          state={lineState(line)}
          label={`${Math.round(share * 100)}% used`}
        />
        <span className="ui-row-hint">
          <Amount cents={line.spent.amount} /> of{" "}
          <Amount cents={allowanceOf(line)} />
          {carried !== 0 && (
            <>
              {" "}
              · {carried > 0 ? "Carried over " : "Overspent "}
              <Amount cents={Math.abs(carried)} />
            </>
          )}
        </span>
      </span>
    </>
  );
  return writable ? (
    <button
      type="button"
      id={`budget-line-${line.categoryId}`}
      className="ui-row ui-row-press bud-row"
      onClick={onOpen}
    >
      {body}
    </button>
  ) : (
    <div className="ui-row ui-row-static bud-row">{body}</div>
  );
}

/** A category without a budget, inside the fold: what it spent, and for a writer a tap to set a limit. */
function FoldRow({
  line,
  writable,
  onOpen,
}: {
  line: BudgetLine;
  writable: boolean;
  onOpen: () => void;
}) {
  const body = (
    <RowBody
      lead={<Avatar name={line.name} />}
      title={line.name}
      {...(line.spent.amount > 0
        ? { value: <Amount cents={line.spent.amount} /> }
        : {})}
    />
  );
  return writable ? (
    <button
      type="button"
      id={`budget-line-${line.categoryId}`}
      className="ui-row ui-row-press"
      onClick={onOpen}
    >
      {body}
    </button>
  ) : (
    <div className="ui-row ui-row-static">{body}</div>
  );
}

export function BudgetsPage() {
  const current = useCurrentMonth();
  const [chosen, setChosen] = useState<string | null>(null);
  const month = chosen ?? current;
  const [editing, setEditing] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ id: number; text: string } | null>(
    null,
  );
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
  // One notice for the page; its number restarts the timer when the same words come twice in a row.
  const tell = (text: string) =>
    setNotice((last) => ({ id: (last?.id ?? 0) + 1, text }));
  const { budgeted, unbudgeted } = splitLines(data?.items ?? []);
  const hasBudgets = budgeted.length > 0;
  const editingLine = data?.items.find((line) => line.categoryId === editing);
  const previous = shiftMonth(month, -1);
  const copy = async () => {
    if (!ledger) return;
    setCopying(true);
    try {
      const result = await prepareBudgetCopy(ledger.id, previous, month)();
      tell(
        result.items.length
          ? `Copied ${result.items.length} ${result.items.length === 1 ? "budget" : "budgets"} from ${monthLabel(previous)}.`
          : `Nothing to copy from ${monthLabel(previous)}.`,
      );
      refresh();
    } catch {
      tell("Couldn't copy the budgets. Please try again.");
    } finally {
      setCopying(false);
    }
  };
  const totals = data?.totals;
  const allowance = totals
    ? totals.budgeted.amount + totals.carriedIn.amount
    : 0;
  return (
    <div className="bud-page">
      <div className="page-heading bud-head">
        <h1 id="budgets-title" tabIndex={-1}>
          Budgets
        </h1>
        <div className="bud-month">
          <MonthControl month={month} onChange={setChosen} />
        </div>
      </div>
      {(ledgers.isError || view.isError) && (
        <div className="ui-card bud-error">
          <p role="alert">
            {data
              ? "Couldn't refresh. Showing the last numbers we loaded."
              : "Couldn't load your budgets."}
          </p>
          <button
            type="button"
            className="ui-btn ui-btn-secondary"
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
      {data &&
        totals &&
        (data.items.length === 0 ? (
          <p className="muted">
            Add an expense category first, then budget it here.
          </p>
        ) : (
          <div className="bud-cols">
            <div className="bud-side">
              {hasBudgets ? (
                <Hero
                  label="Left this month"
                  figure={<Amount cents={totals.left.amount} />}
                  {...(totals.left.amount < 0
                    ? { tone: "danger" as const }
                    : {})}
                  meter={
                    <>
                      <ProportionBar
                        share={shareOf(totals.spent.amount, allowance)}
                        label={`${percentUsed({ spent: totals.spent.amount, allowance })}% used`}
                      />
                      <span>
                        {percentUsed({ spent: totals.spent.amount, allowance })}
                        % used{daysText(daysLeft(month, new Date()))}
                      </span>
                    </>
                  }
                  {...(totals.unbudgetedSpent.amount > 0
                    ? {
                        note: (
                          <>
                            Spent without a budget{" "}
                            <Amount cents={totals.unbudgetedSpent.amount} />
                          </>
                        ),
                      }
                    : {})}
                />
              ) : (
                <div className="ui-card">
                  <EmptyState
                    text={
                      writable
                        ? `No budgets for ${monthLabel(month)} yet.`
                        : "Nothing has been budgeted for this month."
                    }
                    {...(writable
                      ? {
                          action: {
                            label: copying
                              ? "Copying…"
                              : `Copy from ${monthLabel(previous).split(" ")[0]}`,
                            onClick: () => void copy(),
                            disabled: copying,
                          },
                        }
                      : {})}
                  />
                </div>
              )}
            </div>
            <section className="bud-list" aria-label="Budgets by category">
              <ListCard>
                {budgeted.map((line) => (
                  <BudgetRow
                    key={line.categoryId}
                    line={line}
                    writable={writable}
                    onOpen={() => setEditing(line.categoryId)}
                  />
                ))}
                {unbudgeted.length > 0 && (
                  <details className="bud-fold" open={!hasBudgets}>
                    <summary className="ui-row ui-row-press bud-fold-head">
                      <span className="ui-row-main">
                        <span className="ui-row-title bud-fold-title">
                          {unbudgeted.length} without a budget
                        </span>
                      </span>
                      <ChevronDown size={18} aria-hidden="true" />
                    </summary>
                    {unbudgeted.map((line) => (
                      <FoldRow
                        key={line.categoryId}
                        line={line}
                        writable={writable}
                        onOpen={() => setEditing(line.categoryId)}
                      />
                    ))}
                  </details>
                )}
              </ListCard>
            </section>
          </div>
        ))}
      {ledger && editingLine && (
        <LimitSheet
          key={`${editingLine.categoryId}-${month}-${editingLine.budget?.version ?? 0}`}
          ledgerId={ledger.id}
          month={month}
          line={editingLine}
          onDismiss={() => setEditing(null)}
          onChanged={(text) => {
            refresh();
            if (text) tell(text);
          }}
        />
      )}
      {notice && (
        <Toast
          key={notice.id}
          label="Budgets notification"
          durationMs={4000}
          onExpire={() => setNotice(null)}
        >
          <p role="status">{notice.text}</p>
        </Toast>
      )}
    </div>
  );
}
