import type { RecurringFrequency } from "@ledgerline/shared";
import { SegmentedControl, SwitchRow } from "@ledgerline/ui";
import { ChevronDown } from "lucide-react";
import { AmountInput } from "../../../components/amount-input";
import { DateTimeInput } from "../../../components/date-time-input";
import { EntryAmount } from "../../../components/entry-amount";
import { PickRow } from "../../../components/pick-row";
import { TagPicker } from "../../tags/tag-picker";
import { CategoryCombo } from "../../transactions/category-combo";
import { feeHint, feeMinor } from "../../transactions/fee";
import { FeePreview } from "../../transactions/fee-preview";
import { everySentence, formatDate } from "../schedule";
import type { RuleFormContext } from "./form-context";

const frequencies: { value: RecurringFrequency; label: string }[] = [
  { value: "day", label: "Days" },
  { value: "week", label: "Weeks" },
  { value: "month", label: "Months" },
  { value: "year", label: "Years" },
];

/** The expense, income or transfer choice and the big amount (the entry sheet's, with the currency code beside it). */
export function TypeAndAmount({ form }: { form: RuleFormContext }) {
  const { values, set, setValues, prefillFee, field, message, currency } = form;
  return (
    <>
      <SegmentedControl
        label="Type"
        value={values.kind}
        onChange={(value) => {
          set("kind", value);
          setValues((current) => ({ ...current, categoryId: "" }));
          if (value === "transfer" && !values.feeText)
            prefillFee(values.accountId);
        }}
        options={[
          { value: "expense", label: "Expense" },
          { value: "income", label: "Income" },
          { value: "transfer", label: "Transfer" },
        ]}
      />
      <div className="rc-block">
        <EntryAmount
          id="rule-amount"
          label={`Amount (${currency})`}
          currency={currency}
          invalid={!!field("amount")["aria-invalid"]}
          describedBy={undefined}
          inputProps={{
            value: values.amount,
            onChange: (event) => set("amount", event.target.value),
          }}
        />
        {message("amount")}
      </div>
    </>
  );
}

/** Name, the account (and for a transfer the receiving one), the category, and for two currencies what arrives. */
export function MainCard({ form }: { form: RuleFormContext }) {
  const {
    values,
    set,
    field,
    message,
    accounts,
    usable,
    prefillFee,
    transfer,
    cross,
    to,
    categories,
    categoryCreate,
  } = form;
  const options = (exclude?: string) =>
    accounts
      .filter((account) => usable(account) && account.id !== exclude)
      .map((account) => ({
        value: account.id,
        label: `${account.name} (${account.currency})`,
        short: account.name,
      }));
  return (
    <div className="rc-card">
      <div className="rc-block">
        <div className="rc-input-row">
          <label htmlFor="rule-title">Name</label>
          <input
            id="rule-title"
            autoComplete="off"
            maxLength={80}
            placeholder="Rent"
            value={values.title}
            onChange={(event) => set("title", event.target.value)}
            {...field("title")}
          />
        </div>
        {message("title")}
      </div>
      <div className="rc-block">
        <PickRow
          id="rule-account"
          label={transfer ? "From account" : "Account"}
          value={values.accountId}
          options={options()}
          onChange={(id) => {
            set("accountId", id);
            prefillFee(id);
          }}
        />
        {message("accountId")}
      </div>
      {transfer && (
        <div className="rc-block">
          <PickRow
            id="rule-to-account"
            label="To account"
            value={values.toAccountId}
            options={[
              { value: "", label: "Choose an account", short: "" },
              ...options(values.accountId),
            ]}
            onChange={(id) => set("toAccountId", id)}
          />
          {message("toAccountId")}
        </div>
      )}
      {!transfer && (
        <div className="rc-field">
          <CategoryCombo
            categories={categories}
            kind={values.kind as "expense" | "income"}
            value={values.categoryId || null}
            onChange={(id) => set("categoryId", id)}
            create={categoryCreate(values.kind as "expense" | "income")}
          />
          {message("categoryId")}
        </div>
      )}
      {cross && to && (
        <div className="rc-block">
          <div className="rc-input-row">
            <label htmlFor="rule-received">{`Amount that arrives (${to.currency})`}</label>
            <AmountInput
              currency={to.currency}
              id="rule-received"
              inputMode="decimal"
              autoComplete="off"
              aria-describedby="rule-received-help"
              value={values.receivedAmount}
              onChange={(event) => set("receivedAmount", event.target.value)}
              {...field("receivedAmount")}
            />
          </div>
          {message("receivedAmount")}
          <span id="rule-received-help" className="sr-only">
            The same amount arrives every time. Edit the rule if it changes.
          </span>
        </div>
      )}
    </div>
  );
}

/** How often, from when, and for an existing rule whether it runs: Every, Unit, Starts and Active. */
export function ScheduleCard({ form }: { form: RuleFormContext }) {
  const { values, set, field, message, rule, active, setActive } = form;
  return (
    <div className="rc-card">
      <div className="rc-block">
        <div className="rc-input-row">
          <label htmlFor="rule-interval">Every</label>
          <input
            id="rule-interval"
            inputMode="numeric"
            pattern="[0-9]*"
            autoComplete="off"
            value={values.interval}
            // A count of days, weeks, months or years: digits only, however it is typed or pasted.
            onChange={(event) =>
              set("interval", event.target.value.replace(/\D/g, "").slice(0, 3))
            }
            {...field("interval")}
          />
        </div>
        {message("interval")}
      </div>
      <PickRow
        id="rule-frequency"
        label="Unit"
        value={values.frequency}
        options={frequencies}
        onChange={(value) => set("frequency", value as RecurringFrequency)}
      />
      <div className="rc-block">
        <div className="rc-input-row">
          <label htmlFor="rule-start">Starts</label>
          <DateTimeInput
            label="Starts"
            id="rule-start"
            type="date"
            min="0001-01-01"
            max="9999-12-31"
            value={values.startDate}
            onChange={(event) => set("startDate", event.target.value)}
            {...field("startDate")}
          />
        </div>
        {message("startDate")}
      </div>
      {rule && (
        <SwitchRow title="Active" checked={active} onChange={setActive} />
      )}
    </div>
  );
}

/** The next dates, and how many entries a new rule creates at once. */
export function SchedulePreview({ form }: { form: RuleFormContext }) {
  const { values, preview, interval } = form;
  if (!preview) return null;
  return (
    <p className="rc-note" aria-live="polite">
      {everySentence(values.frequency, interval)}.{" "}
      {preview.next.length > 0
        ? `Next: ${preview.next.map(formatDate).join(", ")}.`
        : "Nothing is left to create."}
      {preview.due > 0 &&
        ` ${preview.due} ${preview.due === 1 ? "entry is" : "entries are"} already due and will be created as soon as you save.`}
    </p>
  );
}

/** A transfer's optional fee, worked out again for each occurrence, and its optional bonus. */
export function TransferCard({ form }: { form: RuleFormContext }) {
  const {
    transfer,
    from,
    to,
    values,
    set,
    field,
    message,
    feeInput,
    sentMinor,
  } = form;
  if (!transfer || (!from && !to)) return null;
  return (
    <div className="rc-card">
      {from && (
        <div className="rc-block">
          <div className="rc-input-row">
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
          </div>
          <span id="rule-fee-help" className="sr-only">
            {feeHint} Charged to {from.name} in {from.currency} with every
            transfer; a percentage is worked out again each time.
          </span>
          {message("feeText")}
          <p
            id="rule-fee-preview"
            className="rc-note rc-err rc-fee-preview"
            aria-live="polite"
          >
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
      {to && (
        <SwitchRow
          title="Add a bonus to each transfer"
          checked={values.bonusOn}
          onChange={(on) => set("bonusOn", on)}
        />
      )}
      {to && values.bonusOn && (
        <div className="rc-block">
          <div className="rc-input-row">
            <label htmlFor="rule-bonus">{`Bonus amount (${to.currency})`}</label>
            <AmountInput
              currency={to.currency}
              id="rule-bonus"
              inputMode="decimal"
              autoComplete="off"
              aria-describedby="rule-bonus-help"
              value={values.bonusAmount}
              onChange={(event) => set("bonusAmount", event.target.value)}
              {...field("bonusAmount")}
            />
          </div>
          {message("bonusAmount")}
          <span id="rule-bonus-help" className="sr-only">
            Saved income in the receiving account each time. Nothing is added
            unless you switch this on.
          </span>
        </div>
      )}
    </div>
  );
}

/** The fold for what a rule rarely needs: the end date, payee, note, tags, and a transfer's fee and bonus categories. */
export function MoreFold({ form }: { form: RuleFormContext }) {
  const {
    transfer,
    moreOpen,
    setMoreOpen,
    categories,
    values,
    set,
    field,
    message,
    ledgerId,
    categoryCreate,
  } = form;
  return (
    <details
      className="ui-card rc-fold"
      open={moreOpen}
      onToggle={(event) => setMoreOpen(event.currentTarget.open)}
    >
      <summary>
        <span>More</span>
        <ChevronDown size={18} aria-hidden="true" />
      </summary>
      <div className="rc-fold-body">
        <div className="rc-block">
          <div className="rc-input-row">
            <label htmlFor="rule-end">Ends (optional)</label>
            <DateTimeInput
              label="Ends"
              id="rule-end"
              type="date"
              min="0001-01-01"
              max="9999-12-31"
              value={values.endDate}
              onChange={(event) => set("endDate", event.target.value)}
              {...field("endDate")}
            />
          </div>
          {message("endDate")}
        </div>
        {!transfer && (
          <div className="rc-input-row">
            <label htmlFor="rule-payee">Payee (optional)</label>
            <input
              id="rule-payee"
              autoComplete="off"
              maxLength={200}
              value={values.payee}
              onChange={(event) => set("payee", event.target.value)}
            />
          </div>
        )}
        <div className="rc-input-row">
          <label htmlFor="rule-note">Note (optional)</label>
          <input
            id="rule-note"
            autoComplete="off"
            maxLength={2000}
            value={values.note}
            onChange={(event) => set("note", event.target.value)}
          />
        </div>
        <div className="rc-field">
          <TagPicker
            id="rule-tags"
            ledgerId={ledgerId}
            value={values.tagIds}
            onChange={(ids) => set("tagIds", ids)}
          />
          {transfer && (
            <p className="rc-quiet">
              Both sides get these tags; a fee or bonus does not.
            </p>
          )}
        </div>
        {transfer && (
          <div className="rc-field">
            <CategoryCombo
              categories={categories}
              kind="expense"
              label="Fee category"
              value={values.feeCategoryId || null}
              onChange={(id) => set("feeCategoryId", id)}
              create={categoryCreate("expense")}
            />
            {message("feeCategoryId")}
          </div>
        )}
        {transfer && values.bonusOn && (
          <div className="rc-field">
            <CategoryCombo
              categories={categories}
              kind="income"
              label="Bonus category"
              value={values.bonusCategoryId || null}
              onChange={(id) => set("bonusCategoryId", id)}
              create={categoryCreate("income")}
            />
            {message("bonusCategoryId")}
          </div>
        )}
      </div>
    </details>
  );
}
