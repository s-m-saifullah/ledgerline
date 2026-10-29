import type { RecurringRule } from "@ledgerline/shared";
import { Button } from "@ledgerline/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { Amount } from "../../components/amount-text";
import { getLedgers } from "../../lib/api";
import { getCategories } from "../categories/api";
import { getAllAccounts } from "../transactions/api";
import { getRules } from "./api";
import { RuleEditor } from "./rule-editor";
import { everySentence, formatDate } from "./schedule";

const kindLabel = {
  expense: "Expense",
  income: "Income",
  transfer: "Transfer",
};

function RuleRow({ rule }: { rule: RecurringRule }) {
  const status = rule.paused
    ? rule.pausedReason === "access"
      ? "Paused, the person it runs as can no longer write"
      : "Paused"
    : rule.nextDate
      ? `Next ${formatDate(rule.nextDate)}`
      : "Ended";
  return (
    <>
      <span className="budget-line-top">
        <strong>{rule.title}</strong>
        <Amount
          className="amount-figure"
          cents={Math.abs(rule.amount.amount)}
          currency={rule.amount.currency}
        />
      </span>
      <span className="budget-line-detail muted">
        {kindLabel[rule.kind]} · {everySentence(rule.frequency, rule.interval)}{" "}
        · {status}
      </span>
      {rule.needsAttention > 0 && (
        <span className="account-badge">
          {rule.needsAttention === 1
            ? "1 entry needs attention"
            : `${rule.needsAttention} entries need attention`}
        </span>
      )}
    </>
  );
}

export function RecurringPage() {
  const client = useQueryClient();
  const ledgers = useQuery({ queryKey: ["ledgers"], queryFn: getLedgers });
  const ledger = ledgers.data?.items[0];
  const writable = !!ledger && ledger.role !== "viewer";
  const rules = useQuery({
    queryKey: ["recurring", ledger?.id],
    queryFn: ({ signal }) => getRules(ledger?.id as string, signal),
    enabled: !!ledger,
    staleTime: 0,
  });
  const accounts = useQuery({
    queryKey: ["accounts", ledger?.id, "history"],
    queryFn: ({ signal }) => getAllAccounts(ledger?.id as string, signal),
    enabled: !!ledger,
  });
  const categories = useQuery({
    queryKey: ["categories", ledger?.id],
    queryFn: ({ signal }) => getCategories(ledger?.id as string, signal),
    enabled: !!ledger,
  });
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const refresh = () => {
    void client.invalidateQueries({ queryKey: ["recurring", ledger?.id] });
    // Entries made by a rule change balances, lists and totals.
    void client.invalidateQueries({ queryKey: ["accounts"] });
    void client.invalidateQueries({ queryKey: ["transactions"] });
    void client.invalidateQueries({ queryKey: ["home"] });
  };
  const failed = ledgers.isError || rules.isError;
  const timeZone = ledger?.timeZone ?? null;
  const editingRule = rules.data?.find((rule) => rule.id === editing);
  const ready = !!ledger && !!timeZone && !!accounts.data && !!categories.data;
  return (
    <>
      <div className="page-heading">
        <p className="eyebrow">MAKE IT YOURS</p>
        <h1 id="recurring-title" tabIndex={-1}>
          Recurring
        </h1>
        <p className="muted">
          Rent, salary, subscriptions and regular transfers, created for you on
          their dates.
        </p>
      </div>
      {failed && (
        <div className="account-error">
          <p role="alert">Couldn't load your recurring entries.</p>
          <button
            type="button"
            className="secondary-button"
            onClick={() => {
              void ledgers.refetch();
              if (ledger) void rules.refetch();
            }}
          >
            Try again
          </button>
        </div>
      )}
      {!rules.data && !failed && (
        <p className="muted" role="status">
          Loading your recurring entries…
        </p>
      )}
      {ledger && !timeZone && (
        <section className="settings-card">
          <h2>Set your time zone first</h2>
          <p>
            Recurring entries need to know what today is for you.{" "}
            <Link to="/more">Set the time zone in More</Link>.
          </p>
        </section>
      )}
      {rules.data && (
        <>
          {writable && timeZone && (
            <div className="account-dialog-actions currency-actions">
              <Button
                type="button"
                id="add-rule"
                disabled={!ready}
                onClick={() => setEditing("new")}
              >
                Add a recurring entry
              </Button>
            </div>
          )}
          {rules.data.length === 0 ? (
            <p className="muted">
              Nothing recurring yet.{" "}
              {writable && timeZone
                ? "Add one and it will appear in your transactions on its dates."
                : ""}
            </p>
          ) : (
            <ul className="budget-list" aria-label="Recurring entries">
              {rules.data.map((rule) => (
                <li key={rule.id}>
                  {writable ? (
                    <button
                      type="button"
                      id={`rule-${rule.id}`}
                      className="budget-line"
                      disabled={!ready}
                      onClick={() => setEditing(rule.id)}
                    >
                      <RuleRow rule={rule} />
                    </button>
                  ) : (
                    <div className="budget-line">
                      <RuleRow rule={rule} />
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      {ready && editing === "new" && (
        <RuleEditor
          ledgerId={ledger.id}
          timeZone={timeZone}
          accounts={accounts.data}
          categories={categories.data}
          onDismiss={() => setEditing(null)}
          onChanged={refresh}
        />
      )}
      {ready && editingRule && (
        <RuleEditor
          key={`${editingRule.id}-${editingRule.version}`}
          ledgerId={ledger.id}
          timeZone={timeZone}
          accounts={accounts.data}
          categories={categories.data}
          rule={editingRule}
          onDismiss={() => setEditing(null)}
          onChanged={refresh}
        />
      )}
    </>
  );
}
