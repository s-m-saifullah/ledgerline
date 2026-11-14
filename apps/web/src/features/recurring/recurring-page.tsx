import type { RecurringRule } from "@ledgerline/shared";
import { EmptyState, IconTile, ListCard, RowBody } from "@ledgerline/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Plus, Repeat } from "lucide-react";
import { useState } from "react";
import { Amount } from "../../components/amount-text";
import { LoadError } from "../../components/load-error";
import { Loading } from "../../components/loading";
import { getLedgers } from "../../lib/api";
import { getCategories } from "../categories/api";
import { usePageAdd } from "../shell/page-add";
import { getAllAccounts } from "../transactions/api";
import { getRules } from "./api";
import { ruleEndHint, ruleHint } from "./model";
import { RuleSheet } from "./rule-sheet";
import "./recurring.css";

/**
 * Recurring (ADR 0047, the prototype's `R.recurring`): one grouped card of rules, each a row with its name, one
 * hint and its amount; a row opens the rule's sheet.
 */
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
          message="Couldn't load your recurring entries."
          onRetry={() => {
            void ledgers.refetch();
            if (ledger) void rules.refetch();
          }}
        />
      )}
      {!rules.data && !failed && <Loading what="your recurring entries" />}
      {ledger && !timeZone && (
        <section className="ui-card rc-alert">
          <p>Set your time zone first.</p>
          <p className="rc-note">
            Recurring entries need to know what today is for you.{" "}
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
