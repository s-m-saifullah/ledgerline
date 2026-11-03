import type { Account, Category, RecurringRule } from "@ledgerline/shared";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { DeleteTrigger } from "../../components/delete-trigger";
import { Overlay } from "../../components/overlay";
import { ApiError } from "../../lib/api";
import { useCategoryCreate } from "../categories/use-category-create";
import { defaultFeeText, parseFee } from "../transactions/fee";
import { amountMinor } from "../transactions/form";
import {
  getRuns,
  prepareRuleCreate,
  prepareRuleDelete,
  prepareRuleSave,
  prepareRunSkip,
} from "./api";
import type { RuleFormContext } from "./editor/form-context";
import { RunsSection } from "./editor/runs-section";
import {
  MainCard,
  MoreFold,
  ScheduleCard,
  SchedulePreview,
  TransferCard,
  TypeAndAmount,
} from "./editor/sections";
import {
  type RuleFormErrors,
  type RuleFormValues,
  ruleBody,
  ruleDefaults,
  valuesFromRule,
} from "./form";
import { dueNow, ledgerToday, upcomingDates } from "./schedule";
import "./recurring.css";

/**
 * The rule sheet (the prototype's `OV["rule-form"]`): the type and the big amount, one card for what the rule is,
 * one for when it runs (with the Active switch for a rule that exists), the transfer's fee and bonus, a More fold
 * and, for an existing rule, what it has done. Save is pinned, with the trash beside it, which asks first. The
 * save, retry, conflict and skip rules are the dialog's, kept.
 */
export function RuleSheet({
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
  const initial = useMemo(
    () => (rule ? valuesFromRule(rule) : ruleDefaults(accounts, today)),
    [rule, accounts, today],
  );
  const [values, setValues] = useState<RuleFormValues>(initial);
  const [active, setActive] = useState(rule ? !rule.paused : true);
  const [errors, setErrors] = useState<RuleFormErrors>({});
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  // A name nobody has yet can be made from a category field, as in the Add transaction sheet. A create whose answer
  // never came is repeated with the same key when it is chosen again, and holds Save until then.
  const expenseCreate = useCategoryCreate(ledgerId, "expense");
  const incomeCreate = useCategoryCreate(ledgerId, "income");
  const categoryUncertain = expenseCreate.uncertain || incomeCreate.uncertain;
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
  // The categories and the end date live under More; open it when one is needed and missing, or has an error.
  const needsMore =
    (transfer &&
      feeInput.kind !== "none" &&
      feeInput.kind !== "invalid" &&
      !values.feeCategoryId) ||
    (transfer && values.bonusOn && !values.bonusCategoryId) ||
    !!errors.feeCategoryId ||
    !!errors.bonusCategoryId ||
    !!errors.endDate;
  useEffect(() => {
    if (needsMore) setMoreOpen(true);
  }, [needsMore]);
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
    // Only the switch moved: pause or resume, with no update of fields that did not change.
    const toggle = rule && active !== !rule.paused;
    const changed = JSON.stringify(values) !== JSON.stringify(initial);
    const result =
      !rule || changed || !toggle ? ruleBody(values, accounts) : null;
    if (result && "errors" in result) {
      setErrors(result.errors);
      setError("Check the highlighted fields.");
      return;
    }
    const body = result?.body ?? null;
    const action = toggle ? (active ? "resume" : "pause") : null;
    const sig = JSON.stringify([body, action]);
    if (attempt.current?.sig !== sig)
      attempt.current = {
        sig,
        run: rule
          ? prepareRuleSave(ledgerId, rule, body, action)
          : prepareRuleCreate(ledgerId, body as NonNullable<typeof body>),
      };
    void run(attempt.current.run);
  };
  const remove = () => {
    if (!rule) return;
    attempt.current ??= {
      sig: "delete",
      run: prepareRuleDelete(ledgerId, rule),
    };
    // A failure is shown in the sheet, so the question steps aside.
    void run(attempt.current.run).then(() => setAsking(false));
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
      <p role="alert" className="field-error rc-err">
        {errors[key]}
      </p>
    );
  const currency = from?.currency ?? "USD";
  const form: RuleFormContext = {
    ledgerId,
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
    active,
    setActive,
    categoryCreate: (kind) =>
      kind === "expense" ? expenseCreate.create : incomeCreate.create,
    moreOpen,
    setMoreOpen,
    usable,
    prefillFee,
    preview,
    interval,
  };
  return (
    <>
      <Overlay
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
        fallbackFocusId="recurring-title"
        initialFocusId="rule-title"
        footer={
          conflict ? (
            <button
              type="button"
              className="ui-btn ui-btn-primary"
              onClick={() => {
                onChanged();
                onDismiss();
              }}
            >
              Reload recurring
            </button>
          ) : (
            <>
              {rule && (
                <DeleteTrigger
                  id="rule-delete"
                  label="Delete rule"
                  disabled={busy || categoryUncertain}
                  onClick={() => setAsking(true)}
                />
              )}
              <button
                type="submit"
                form="rule-form"
                className="ui-btn ui-btn-primary"
                disabled={busy || categoryUncertain}
              >
                {busy ? "Saving…" : "Save"}
              </button>
            </>
          )
        }
      >
        <form
          id="rule-form"
          className="rc-form"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            if (!conflict) save();
          }}
        >
          <fieldset disabled={busy || conflict} className="rc-fields">
            <TypeAndAmount form={form} />
            <MainCard form={form} />
            <ScheduleCard form={form} />
            <SchedulePreview form={form} />
            <TransferCard form={form} />
            <MoreFold form={form} />
            {rule && (
              <RunsSection
                runs={runs}
                busy={busy}
                onSkip={(index) => void skip(index)}
              />
            )}
          </fieldset>
          {error && (
            <p role="alert" className="field-error">
              {error}
            </p>
          )}
        </form>
      </Overlay>
      {rule && asking && (
        <Overlay
          open
          kind="question"
          title={`Delete ${rule.title}?`}
          busy={busy}
          onDismiss={() => setAsking(false)}
          returnFocusId="rule-delete"
          fallbackFocusId="recurring-title"
          footer={
            <button
              type="button"
              className="ui-btn ui-btn-danger-filled"
              disabled={busy}
              onClick={remove}
            >
              {busy ? "Deleting…" : "Delete"}
            </button>
          }
        >
          <p>Deleting the rule keeps the entries it already made.</p>
        </Overlay>
      )}
    </>
  );
}
