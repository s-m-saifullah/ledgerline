import type { RecurringFrequency } from "@ledgerline/shared";
import { AmountInput } from "../../../components/amount-input";
import { NativeSelect } from "../../../components/native-select";
import { CategoryPicker } from "../../categories/picker";
import { feeHint, feeMinor } from "../../transactions/fee";
import { FeePreview } from "../../transactions/fee-preview";
import { everySentence, formatDate } from "../schedule";
import type { RuleFormContext } from "./form-context";

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

/** The name and the expense, income or transfer choice. */
export function renderNameAndKind(form: RuleFormContext) {
  const { values, set, setValues, field, message, prefillFee } = form;
  return (
    <>
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
    </>
  );
}

/** The account (and for a transfer the receiving account). */
export function renderAccounts(form: RuleFormContext) {
  const {
    transfer,
    values,
    set,
    field,
    message,
    prefillFee,
    accounts,
    usable,
  } = form;
  return (
    <>
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
                (account) => usable(account) && account.id !== values.accountId,
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
    </>
  );
}

/** The category, the amount, and for two currencies the amount that arrives. */
export function renderCategoryAndAmounts(form: RuleFormContext) {
  const {
    transfer,
    categories,
    values,
    set,
    message,
    currency,
    field,
    cross,
    to,
  } = form;
  return (
    <>
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
    </>
  );
}

/** The optional fee on a transfer. */
export function renderFee(form: RuleFormContext) {
  const { transfer, from, values, set, field, feeInput, sentMinor, message } =
    form;
  return (
    <>
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
    </>
  );
}

/** The optional bonus on a transfer. */
export function renderBonus(form: RuleFormContext) {
  const { transfer, to, values, set, field, message } = form;
  return (
    <>
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
    </>
  );
}

/** The fee and bonus categories under More. */
export function renderMoreCategories(form: RuleFormContext) {
  const { transfer, moreOpen, setMoreOpen, categories, values, set, message } =
    form;
  return (
    <>
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
    </>
  );
}

/** Payee and note. */
export function renderPayeeAndNote(form: RuleFormContext) {
  const { transfer, values, set } = form;
  return (
    <>
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
    </>
  );
}

/** How often, from when, until when, and the preview of the next dates. */
export function renderSchedule(form: RuleFormContext) {
  const { values, set, field, message, preview, interval } = form;
  return (
    <>
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
    </>
  );
}
