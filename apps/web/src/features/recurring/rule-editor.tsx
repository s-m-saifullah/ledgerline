import type {
  Account,
  Category,
  RecurringFrequency,
  RecurringRule,
} from "@ledgerline/shared";
import { Button } from "@ledgerline/ui";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { AmountInput } from "../../components/amount-input";
import { EditorDialog } from "../../components/editor-dialog";
import { NativeSelect } from "../../components/native-select";
import { ApiError } from "../../lib/api";
import { CategoryPicker } from "../categories/picker";
import {
  defaultFeeText,
  feeHint,
  feeMinor,
  parseFee,
} from "../transactions/fee";
import { FeePreview } from "../transactions/fee-preview";
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
  type RuleFormErrors,
  type RuleFormValues,
  ruleBody,
  ruleDefaults,
  valuesFromRule,
} from "./form";
import {
  dueNow,
  everySentence,
  formatDate,
  ledgerToday,
  upcomingDates,
} from "./schedule";

const kinds = [
  ["expense", "Expense"],
  ["income", "Income"],
  ["transfer", "Transfer"],
] as const;
const frequencies: [RecurringFrequency, string][] = [
  ["day", "Days"],
  ["week", "Weeks"],
  ["month", "Months"],
  ["year", "Years"],
];

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
          <label htmlFor="rule-title">Name</label>
          <input
            id="rule-title"
            autoComplete="off"
            maxLength={80}
            value={values.title}
            onChange={(event) => set("title", event.target.value)}
            {...field("title")}
          />
          {message("title")}
          <fieldset className="balance-direction recurring-kinds">
            <legend>Type</legend>
            {kinds.map(([value, label]) => (
              <label key={value}>
                <input
                  type="radio"
                  name="rule-kind"
                  value={value}
                  checked={values.kind === value}
                  onChange={() => {
                    set("kind", value);
                    setValues((current) => ({ ...current, categoryId: "" }));
                    if (value === "transfer" && !values.feeText)
                      prefillFee(values.accountId);
                  }}
                />
                <span>{label}</span>
              </label>
            ))}
          </fieldset>
          <label htmlFor="rule-account">
            {transfer ? "From account" : "Account"}
          </label>
          <NativeSelect
            id="rule-account"
            value={values.accountId}
            onChange={(event) => {
              set("accountId", event.target.value);
              prefillFee(event.target.value);
            }}
            {...field("accountId")}
          >
            {accounts.filter(usable).map((account) => (
              <option key={account.id} value={account.id}>
                {account.name} ({account.currency})
              </option>
            ))}
          </NativeSelect>
          {message("accountId")}
          {transfer && (
            <>
              <label htmlFor="rule-to-account">To account</label>
              <NativeSelect
                id="rule-to-account"
                value={values.toAccountId}
                onChange={(event) => set("toAccountId", event.target.value)}
                {...field("toAccountId")}
              >
                <option value="">Choose an account</option>
                {accounts
                  .filter(
                    (account) =>
                      usable(account) && account.id !== values.accountId,
                  )
                  .map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.name} ({account.currency})
                    </option>
                  ))}
              </NativeSelect>
              {message("toAccountId")}
            </>
          )}
          {!transfer && (
            <>
              <CategoryPicker
                categories={categories}
                kind={values.kind as "expense" | "income"}
                value={values.categoryId || null}
                onChange={(id) => set("categoryId", id ?? "")}
              />
              {message("categoryId")}
            </>
          )}
          <label htmlFor="rule-amount">{`Amount (${currency})`}</label>
          <AmountInput
            currency={currency}
            id="rule-amount"
            inputMode="decimal"
            autoComplete="off"
            value={values.amount}
            onChange={(event) => set("amount", event.target.value)}
            {...field("amount")}
          />
          {message("amount")}
          {cross && to && (
            <>
              <label htmlFor="rule-received">{`Amount that arrives (${to.currency})`}</label>
              <AmountInput
                currency={to.currency}
                id="rule-received"
                inputMode="decimal"
                autoComplete="off"
                value={values.receivedAmount}
                onChange={(event) => set("receivedAmount", event.target.value)}
                {...field("receivedAmount")}
              />
              {message("receivedAmount")}
              <p className="form-help">
                The same amount arrives every time. Edit the rule if it changes.
              </p>
            </>
          )}
          {transfer && from && (
            <div className="transfer-fee">
              <label htmlFor="rule-fee">Fee (optional)</label>
              <input
                id="rule-fee"
                autoComplete="off"
                placeholder="2 or 2%"
                aria-describedby="rule-fee-help rule-fee-preview"
                value={values.feeText}
                onChange={(event) => set("feeText", event.target.value)}
                {...field("feeText")}
              />
              <p id="rule-fee-help" className="form-help">
                {feeHint} Charged to {from.name} in {from.currency} with every
                transfer; a percentage is worked out again each time.
              </p>
              {message("feeText")}
              <p id="rule-fee-preview" className="form-help" aria-live="polite">
                <FeePreview
                  fee={feeInput.kind}
                  cost={feeMinor(feeInput, sentMinor)}
                  sent={sentMinor}
                  currency={from.currency}
                  accountName={from.name}
                />
              </p>
            </div>
          )}
          {transfer && to && (
            <>
              <label className="budget-rollover">
                <input
                  type="checkbox"
                  checked={values.bonusOn}
                  onChange={(event) => set("bonusOn", event.target.checked)}
                />
                <span className="check-text">Add a bonus to each transfer</span>
              </label>
              {values.bonusOn && (
                <>
                  <label htmlFor="rule-bonus">{`Bonus amount (${to.currency})`}</label>
                  <AmountInput
                    currency={to.currency}
                    id="rule-bonus"
                    inputMode="decimal"
                    autoComplete="off"
                    value={values.bonusAmount}
                    onChange={(event) => set("bonusAmount", event.target.value)}
                    {...field("bonusAmount")}
                  />
                  {message("bonusAmount")}
                  <p className="form-help">
                    Saved income in the receiving account each time. Nothing is
                    added unless you switch this on.
                  </p>
                </>
              )}
            </>
          )}
          {transfer && (
            <details
              className="transaction-details"
              open={moreOpen}
              onToggle={(event) => setMoreOpen(event.currentTarget.open)}
            >
              <summary>
                More <span className="muted">fee and bonus categories</span>
              </summary>
              <div className="account-fields">
                <CategoryPicker
                  categories={categories}
                  kind="expense"
                  label="Fee category"
                  value={values.feeCategoryId || null}
                  onChange={(id) => set("feeCategoryId", id ?? "")}
                />
                {message("feeCategoryId")}
                {values.bonusOn && (
                  <>
                    <CategoryPicker
                      categories={categories}
                      kind="income"
                      label="Bonus category"
                      value={values.bonusCategoryId || null}
                      onChange={(id) => set("bonusCategoryId", id ?? "")}
                    />
                    {message("bonusCategoryId")}
                  </>
                )}
              </div>
            </details>
          )}
          {!transfer && (
            <>
              <label htmlFor="rule-payee">Payee (optional)</label>
              <input
                id="rule-payee"
                autoComplete="off"
                maxLength={200}
                value={values.payee}
                onChange={(event) => set("payee", event.target.value)}
              />
            </>
          )}
          <label htmlFor="rule-note">Note (optional)</label>
          <input
            id="rule-note"
            autoComplete="off"
            maxLength={2000}
            value={values.note}
            onChange={(event) => set("note", event.target.value)}
          />
          <fieldset className="recurring-repeat">
            <legend>Repeats</legend>
            <div>
              <label htmlFor="rule-interval">Every</label>
              <input
                id="rule-interval"
                inputMode="numeric"
                autoComplete="off"
                value={values.interval}
                onChange={(event) => set("interval", event.target.value)}
                {...field("interval")}
              />
            </div>
            <div>
              <label htmlFor="rule-frequency">Unit</label>
              <NativeSelect
                id="rule-frequency"
                value={values.frequency}
                onChange={(event) =>
                  set("frequency", event.target.value as RecurringFrequency)
                }
              >
                {frequencies.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </NativeSelect>
            </div>
          </fieldset>
          {message("interval")}
          <label htmlFor="rule-start">Starts</label>
          <input
            id="rule-start"
            type="date"
            value={values.startDate}
            onChange={(event) => set("startDate", event.target.value)}
            {...field("startDate")}
          />
          {message("startDate")}
          <label htmlFor="rule-end">Ends (optional)</label>
          <input
            id="rule-end"
            type="date"
            value={values.endDate}
            onChange={(event) => set("endDate", event.target.value)}
            {...field("endDate")}
          />
          {message("endDate")}
          {preview && (
            <p className="form-help" aria-live="polite">
              {everySentence(values.frequency, interval)}.{" "}
              {preview.next.length > 0
                ? `Next: ${preview.next.map(formatDate).join(", ")}.`
                : "Nothing is left to create."}
              {preview.due > 0 &&
                ` ${preview.due} ${preview.due === 1 ? "entry is" : "entries are"} already due and will be created as soon as you save.`}
            </p>
          )}
        </fieldset>
        {error && (
          <p role="alert" className="field-error">
            {error}
          </p>
        )}
        {rule && (
          <section className="recurring-runs" aria-label="What it has done">
            <h3>What it has done</h3>
            {runs.isError ? (
              <p className="muted">Couldn't load the history.</p>
            ) : !runs.data ? (
              <p className="muted">Loading…</p>
            ) : runs.data.length === 0 ? (
              <p className="muted">Nothing yet.</p>
            ) : (
              <ul>
                {runs.data.map((item, index) => (
                  <li key={item.id}>
                    <span>
                      <strong>{formatDate(item.date)}</strong>{" "}
                      {item.status === "created"
                        ? "Created"
                        : item.status === "skipped"
                          ? "Skipped"
                          : "Needs attention"}
                      {item.reason && (
                        <span className="muted"> · {item.reason}</span>
                      )}
                    </span>
                    {item.status === "attention" && (
                      <button
                        type="button"
                        className="secondary-button"
                        disabled={busy}
                        onClick={() => void skip(index)}
                      >
                        Skip this one
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
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
