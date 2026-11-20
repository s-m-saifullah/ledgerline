import type { RecurringRule } from "@ledgerline/shared";
import { EmptyState, IconTile, ListCard, RowBody } from "@ledgerline/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Plus, Repeat } from "lucide-react";
import { useState } from "react";
import { Amount } from "../../components/amount-text";
import { LoadError } from "../../components/load-error";
import { Loading } from "../../components/loading";
import { usePageAdd } from "../../components/page-add";
import { getRules } from "./api";
import { ruleEndHint, ruleHint } from "./model";
import { RuleSheet } from "./rule-sheet";
import "./recurring.css";
import { invalidateLedger } from "../../lib/ledger-cache";
import { queryKeys } from "../../lib/query-keys";
import { useAllAccounts } from "../../lib/use-accounts";
import { useCategories } from "../../lib/use-categories";
import { useLedger } from "../../lib/use-ledger";

/**
 * Recurring (ADR 0047, the prototype's `R.recurring`): one grouped card of rules, each a row with its name, one
 * hint and its amount; a row opens the rule's sheet.
 */
export function RecurringPage() {
  const client = useQueryClient();
  const { ledger, ledgers } = useLedger();
  const writable = !!ledger && ledger.role !== "viewer";
  const rules = useQuery({
    queryKey: queryKeys.recurring(ledger?.id),
    queryFn: ({ signal }) => getRules(ledger?.id as string, signal),
    enabled: !!ledger,
    staleTime: 0,
  });
  const accounts = useAllAccounts(ledger?.id);
  const categories = useCategories(ledger?.id);
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const refresh = () => {
    // Entries made by a rule change balances, lists and totals.
    if (ledger) void invalidateLedger(client, ledger.id);
  };
  const failed = ledgers.isError || rules.isError;
  const timeZone = ledger?.timeZone ?? null;
  const editingRule = rules.data?.find((rule) => rule.id === editing);
  const ready = !!ledger && !!timeZone && !!accounts.data && !!categories.data;
  const canAdd = writable && !!timeZone;
  usePageAdd(
    canAdd && (rules.data?.length ?? 0) > 0
      ? {
          label: "Add rule",
          disabled: !ready,
          onClick: () => setEditing("new"),
        }
      : null,
  );
  const row = (rule: RecurringRule) => {
    const body = (
      <RowBody
        lead={
          <IconTile>
            <Repeat size={20} aria-hidden="true" />
          </IconTile>
        }
        title={rule.title}
        hint={ruleHint(rule)}
        value={
          <Amount
            cents={Math.abs(rule.amount.amount)}
            currency={rule.amount.currency}
          />
        }
        valueHint={ruleEndHint(rule, accounts.data)}
        chevron={writable}
      />
    );
    return writable ? (
      <button
        key={rule.id}
        type="button"
        id={`rule-${rule.id}`}
        className="ui-row ui-row-press rc-row"
        disabled={!ready}
        onClick={() => setEditing(rule.id)}
      >
        {body}
      </button>
    ) : (
      <div key={rule.id} className="ui-row ui-row-static rc-row">
        {body}
      </div>
    );
  };
  return (
    <div className="rc-page">
      <div className="page-heading rc-head">
        <h1 id="recurring-title" tabIndex={-1}>
          Recurring
        </h1>
        {canAdd && (rules.data?.length ?? 0) > 0 && (
          <button
            type="button"
            id="add-rule"
            className="ui-btn ui-btn-primary rc-add"
            disabled={!ready}
            onClick={() => setEditing("new")}
          >
            <Plus size={18} aria-hidden="true" />
            Add rule
          </button>
        )}
      </div>
      {failed && (
        <LoadError
          message="Couldn't load your recurring transactions."
          onRetry={() => {
            void ledgers.refetch();
            if (ledger) void rules.refetch();
          }}
        />
      )}
      {!rules.data && !failed && <Loading what="your recurring transactions" />}
      {ledger && !timeZone && (
        <section className="ui-card rc-alert">
          <p>Set your time zone first.</p>
          <p className="rc-note">
            Recurring transactions need to know what today is for you.{" "}
            <Link to="/more">Set the time zone in More</Link>.
          </p>
        </section>
      )}
      {rules.data &&
        (rules.data.length === 0 ? (
          <div className="ui-card rc-empty">
            <EmptyState text="Nothing recurring yet." />
            {canAdd && (
              <button
                type="button"
                id="add-rule"
                className="ui-btn ui-btn-secondary"
                disabled={!ready}
                onClick={() => setEditing("new")}
              >
                <Plus size={18} aria-hidden="true" />
                Add your first rule
              </button>
            )}
          </div>
        ) : (
          <ListCard>{rules.data.map(row)}</ListCard>
        ))}
      {ready && editing === "new" && (
        <RuleSheet
          ledgerId={ledger.id}
          timeZone={timeZone}
          accounts={accounts.data}
          categories={categories.data}
          onDismiss={() => setEditing(null)}
          onChanged={refresh}
        />
      )}
      {ready && editingRule && (
        <RuleSheet
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
    </div>
  );
}
