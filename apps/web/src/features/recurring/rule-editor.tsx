import type { Account, Category, RecurringRule } from "@ledgerline/shared";
import { Button } from "@ledgerline/ui";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { EditorDialog } from "../../components/editor-dialog";
import { ApiError } from "../../lib/api";
import { defaultFeeText, parseFee } from "../transactions/fee";
import { amountMinor } from "../transactions/form";
import {
  getRuns,
  prepareRuleCreate,
  prepareRuleDelete,
  prepareRuleToggle,
  prepareRuleUpdate,
  prepareRunSkip,
} from "./api";
import {
  renderAccounts,
  renderBonus,
  renderCategoryAndAmounts,
  renderFee,
  renderMoreCategories,
  renderNameAndKind,
  renderPayeeAndNote,
  renderSchedule,
} from "./editor/fields";
import type { RuleFormContext } from "./editor/form-context";
import { RunsSection } from "./editor/runs-section";
import {
  type RuleFormErrors,
  type RuleFormValues,
  ruleBody,
  ruleDefaults,
  valuesFromRule,
} from "./form";
import { dueNow, ledgerToday, upcomingDates } from "./schedule";

export function RuleEditor({
  ledgerId,
  timeZone,
  accounts,
  categories,
  rule,
  onDismiss,
  onChanged,
}: {
  ledgerId: string;
  timeZone: string;
  accounts: readonly Account[];
  categories: readonly Category[];
  /** Absent when adding a new rule. */
  rule?: RecurringRule | undefined;
  onDismiss: () => void;
  /** Called after any saved change, or after a conflict so the page can reload. */
  onChanged: () => void;
}) {
  const today = ledgerToday(timeZone);
  const [values, setValues] = useState<RuleFormValues>(() =>
    rule ? valuesFromRule(rule) : ruleDefaults(accounts, today),
  );
  const [errors, setErrors] = useState<RuleFormErrors>({});
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const attempt = useRef<{ sig: string; run: () => Promise<unknown> } | null>(
    null,
  );
  const set = <K extends keyof RuleFormValues>(
    key: K,
    value: RuleFormValues[K],
  ) => {
    setValues((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: undefined }));
    setError("");
  };
  const usable = (account: Account) =>
    !account.archivedAt ||
    account.id === rule?.accountId ||
    account.id === rule?.toAccountId;
  const from = accounts.find((row) => row.id === values.accountId);
  const to = accounts.find((row) => row.id === values.toAccountId);
  const transfer = values.kind === "transfer";
  const cross = transfer && !!from && !!to && from.currency !== to.currency;
  const interval = Number(values.interval);
  // A new transfer rule starts from the sending account's usual fee, which the person then confirms.
  const prefillFee = (accountId: string) => {
    if (rule) return;
    const account = accounts.find((row) => row.id === accountId);
    setValues((current) => ({
      ...current,
      feeText: defaultFeeText(account),
      feeCategoryId: account?.feeCategoryId ?? "",
    }));
  };
  const feeInput = parseFee(values.feeText, from?.currency ?? "USD");
  const sentMinor = amountMinor(values.amount, from?.currency ?? "USD");
  // The categories live under More; open it when one is needed and missing, or has an error.
  const needsCategory =
    (transfer &&
      feeInput.kind !== "none" &&
      feeInput.kind !== "invalid" &&
      !values.feeCategoryId) ||
    (transfer && values.bonusOn && !values.bonusCategoryId) ||
    !!errors.feeCategoryId ||
    !!errors.bonusCategoryId;
  useEffect(() => {
    if (needsCategory) setMoreOpen(true);
  }, [needsCategory]);
  const preview = useMemo(() => {
    if (
      !values.startDate ||
      !Number.isInteger(interval) ||
      interval < 1 ||
      interval > 365
    )
      return null;
    const schedule = {
      frequency: values.frequency,
      interval,
      startDate: values.startDate,
      endDate: values.endDate || null,
    };
    return {
      next: upcomingDates(schedule, today),
      due: rule ? 0 : dueNow(schedule, today),
    };
  }, [values, interval, today, rule]);
  const runs = useQuery({
    queryKey: ["recurring-runs", ledgerId, rule?.id],
    queryFn: ({ signal }) => getRuns(ledgerId, rule?.id as string, signal),
    enabled: !!rule,
    staleTime: 0,
  });
  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await action();
      onChanged();
      onDismiss();
    } catch (failure) {
      attempt.current = null;
      if (
        failure instanceof ApiError &&
        failure.status === 409 &&
        failure.fields.some((item) => item.field === "expectedVersion")
      ) {
        setConflict(true);
        setError("This rule changed somewhere else. Reload to see the latest.");
      } else if (failure instanceof ApiError && failure.status < 500) {
        setError(failure.message);
      } else {
        setError("We couldn't confirm that. Try again to retry safely.");
      }
    } finally {
      setBusy(false);
    }
  };
  const save = () => {
    const result = ruleBody(values, accounts);
    if ("errors" in result) {
      setErrors(result.errors);
      setError("Check the highlighted fields.");
      return;
    }
    const sig = JSON.stringify(result.body);
    if (attempt.current?.sig !== sig)
      attempt.current = {
        sig,
        run: rule
          ? prepareRuleUpdate(ledgerId, rule, result.body)
          : prepareRuleCreate(ledgerId, result.body),
      };
    void run(attempt.current.run);
  };
  const once = (sig: string, make: () => () => Promise<unknown>) => {
    attempt.current ??= { sig, run: make() };
    void run(attempt.current.run);
  };
  const skip = async (index: number) => {
    const target = runs.data?.[index];
    if (!target) return;
    setBusy(true);
    setError("");
    try {
      await prepareRunSkip(ledgerId, target)();
      await runs.refetch();
      onChanged();
    } catch {
      setError("We couldn't skip that. Please try again.");
    } finally {
      setBusy(false);
    }
  };
  const field = (key: keyof RuleFormValues) =>
    errors[key] ? { "aria-invalid": "true" as const } : {};
  const message = (key: keyof RuleFormValues) =>
    errors[key] && (
      <p role="alert" className="field-error">
        {errors[key]}
      </p>
    );
  const currency = from?.currency ?? "USD";
  const form: RuleFormContext = {
    values,
    set,
    setValues,
    field,
    message,
    rule,
    accounts,
    categories,
    from,
    to,
    transfer,
    cross,
    feeInput,
    sentMinor,
    currency,
    moreOpen,
    setMoreOpen,
    usable,
    prefillFee,
    preview,
    interval,
  };
  return (
    <EditorDialog
      open
      title={rule ? rule.title : "New recurring entry"}
      description={
        rule
          ? "Changes apply to entries not created yet. Entries already made stay as they are."
          : "Creates an entry or a transfer on a schedule, so you do not have to."
      }
      busy={busy}
      onDismiss={onDismiss}
      returnFocusId={rule ? `rule-${rule.id}` : "add-rule"}
      closeLabel="Close recurring dialog"
      fallbackFocusId="recurring-title"
      initialFocusId="rule-title"
      contentClassName="recurring-dialog"
    >
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (!conflict) save();
        }}
      >
        <fieldset disabled={busy || conflict} className="account-fields">
          {renderNameAndKind(form)}
          {renderAccounts(form)}
          {renderCategoryAndAmounts(form)}
          {renderFee(form)}
          {renderBonus(form)}
          {renderMoreCategories(form)}
          {renderPayeeAndNote(form)}
          {renderSchedule(form)}
        </fieldset>
        {error && (
          <p role="alert" className="field-error">
            {error}
          </p>
        )}
        {rule && (
          <RunsSection
            runs={runs}
            busy={busy}
            onSkip={(index) => void skip(index)}
          />
        )}
        <div className="account-dialog-actions">
          {conflict ? (
            <Button
              type="button"
              onClick={() => {
                onChanged();
                onDismiss();
              }}
            >
              Reload recurring
            </Button>
          ) : (
            <>
              {rule &&
                (confirmDelete ? (
                  <button
                    type="button"
                    className="secondary-button danger-action"
                    disabled={busy}
                    onClick={() =>
                      once("delete", () => prepareRuleDelete(ledgerId, rule))
                    }
                  >
                    Yes, delete it
                  </button>
                ) : (
                  <button
                    type="button"
                    className="quiet-button danger-action"
                    disabled={busy}
                    onClick={() => setConfirmDelete(true)}
                  >
                    Delete rule
                  </button>
                ))}
              {rule && (
                <button
                  type="button"
                  className="secondary-button"
                  disabled={busy}
                  onClick={() => {
                    const action = rule.paused ? "resume" : "pause";
                    once(action, () =>
                      prepareRuleToggle(ledgerId, rule, action),
                    );
                  }}
                >
                  {rule.paused ? "Resume" : "Pause"}
                </button>
              )}
              <Button type="submit" disabled={busy}>
                {busy ? "Saving…" : rule ? "Save changes" : "Save rule"}
              </Button>
            </>
          )}
        </div>
        {rule && confirmDelete && (
          <p className="form-help">
            Deleting the rule keeps the entries it already made.
          </p>
        )}
      </form>
    </EditorDialog>
  );
}
