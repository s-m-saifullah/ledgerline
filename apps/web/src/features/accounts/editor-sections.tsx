import { type Account, currencyDigits } from "@ledgerline/shared";
import { SegmentedControl } from "@ledgerline/ui";
import { ChevronDown } from "lucide-react";
import { AmountInput } from "../../components/amount-input";
import { CategoryPicker } from "../../components/category-picker";
import { PickRow } from "../../components/pick-row";
import { feeHint } from "../../lib/fee";
import { decimalFromCents } from "../../lib/money";
import type { AccountForm } from "./editor-context";
import { accountTypes, isLiability } from "./form";

export function NameField({ form }: { form: AccountForm }) {
  const { register, errors } = form;
  return (
    <div className="ac-field">
      <label htmlFor="account-name">Account name</label>
      <input
        id="account-name"
        autoComplete="off"
        maxLength={100}
        placeholder="Name"
        aria-invalid={!!errors.name}
        aria-describedby={errors.name ? "account-name-error" : undefined}
        {...register("name")}
      />
      {errors.name && (
        <p id="account-name-error" className="field-error">
          {errors.name.message}
        </p>
      )}
    </div>
  );
}

/** Type, Currency (only when the ledger has a second one) and the opening balance. */
export function BalanceCard({ form }: { form: AccountForm }) {
  const {
    register,
    setValue,
    getFieldState,
    errors,
    baseline,
    type,
    currency,
    currencies,
    privateMode,
  } = form;
  return (
    <div className="ac-card">
      <div className="ac-block">
        <PickRow
          id="account-type"
          label="Account type"
          value={type}
          options={Object.entries(accountTypes).map(([value, label]) => ({
            value,
            label,
          }))}
          onChange={(value) => {
            setValue("type", value as Account["type"], {
              shouldDirty: true,
            });
            if (!baseline && !getFieldState("direction").isDirty)
              setValue(
                "direction",
                isLiability(value as Account["type"]) ? "negative" : "positive",
              );
          }}
        />
        {errors.type && (
          <p className="field-error ac-err">{errors.type.message}</p>
        )}
      </div>
      {currencies.length > 1 &&
        (baseline ? (
          <div className="ui-row ui-row-static">
            <span className="ui-row-main">
              <span className="ui-row-title">Currency</span>
            </span>
            <span className="ui-row-end">{baseline.currency}</span>
          </div>
        ) : (
          <PickRow
            id="account-currency"
            label="Currency"
            value={currency}
            options={currencies.map((code) => ({
              value: code,
              label: code,
            }))}
            onChange={(code) => {
              setValue("currency", code);
              if (!getFieldState("amount").isDirty)
                setValue("amount", decimalFromCents(0, currencyDigits(code)));
            }}
          />
        ))}
      <div className="ac-block">
        <div className="ac-input-row">
          <label htmlFor="account-amount">Opening balance ({currency})</label>
          <AmountInput
            currency={currency}
            id="account-amount"
            type={privateMode ? "password" : "text"}
            inputMode="decimal"
            autoComplete="off"
            aria-invalid={!!errors.amount}
            aria-describedby={`opening-balance-help${errors.amount ? " account-amount-error" : ""}`}
            {...register("amount")}
          />
        </div>
        {errors.amount && (
          <p id="account-amount-error" className="field-error ac-err">
            {errors.amount.message}
          </p>
        )}
      </div>
    </div>
  );
}

/** Read aloud by a screen reader with the opening balance. */
export function OpeningHelp({ form }: { form: AccountForm }) {
  const { liability, baseline, currencies } = form;
  return (
    <span id="opening-balance-help" className="sr-only">
      Use the balance before the transactions you will record here. If you add
      older history later, start with the balance from before that history.
      {liability
        ? " Money owed records debt as a negative balance. Credit records a positive balance."
        : ""}
      {baseline && currencies.length <= 1
        ? ` The currency is ${baseline.currency}. It stays the same for the life of the account.`
        : ""}
    </span>
  );
}

export function DirectionControl({ form }: { form: AccountForm }) {
  const { liability, direction, setValue } = form;
  return (
    <SegmentedControl
      label="Balance direction"
      value={direction}
      onChange={(value) => setValue("direction", value, { shouldDirty: true })}
      options={[
        {
          value: "positive",
          label: liability ? "Credit" : "Money available",
        },
        {
          value: "negative",
          label: liability ? "Money owed" : "Overdrawn",
        },
      ]}
    />
  );
}

/** The transfer bonus and the usual fee. */
export function MoreFold({ form }: { form: AccountForm }) {
  const {
    register,
    setValue,
    watch,
    errors,
    bonusRate,
    categories,
    privateMode,
    moreOpen,
    setMoreOpen,
  } = form;
  return (
    <details
      className="ui-card ac-more-fold"
      open={moreOpen}
      onToggle={(event) => setMoreOpen(event.currentTarget.open)}
    >
      <summary>
        <span>More</span>
        <ChevronDown size={18} aria-hidden="true" />
      </summary>
      <div className="ac-more-body">
        <div className="ac-block">
          <div className="ac-input-row">
            <label htmlFor="account-bonus-rate">Bonus rate (%)</label>
            <input
              id="account-bonus-rate"
              inputMode="decimal"
              autoComplete="off"
              placeholder="None"
              aria-invalid={!!errors.bonusRate}
              aria-describedby={`bonus-rate-help${errors.bonusRate ? " bonus-rate-error" : ""}`}
              {...register("bonusRate")}
            />
          </div>
          {errors.bonusRate && (
            <p id="bonus-rate-error" className="field-error ac-err">
              {errors.bonusRate.message}
            </p>
          )}
          <span id="bonus-rate-help" className="sr-only">
            Some transfers arrive with a bonus added on top. If this account
            gets one, enter its percentage. Transfers into this account will
            then suggest the bonus for you to confirm each time. Leave it empty
            for none.
          </span>
        </div>
        <div className="ac-block">
          <div className="ac-input-row">
            <label htmlFor="account-default-fee">Usual fee</label>
            <input
              id="account-default-fee"
              type={privateMode ? "password" : "text"}
              inputMode="text"
              autoComplete="off"
              placeholder="2 or 2%"
              aria-invalid={!!errors.defaultFee}
              aria-describedby={`default-fee-help${errors.defaultFee ? " default-fee-error" : ""}`}
              {...register("defaultFee")}
            />
          </div>
          {errors.defaultFee && (
            <p id="default-fee-error" className="field-error ac-err">
              {errors.defaultFee.message}
            </p>
          )}
          <span id="default-fee-help" className="sr-only">
            If sending money from this account usually costs a fee, enter it
            here and new transfers will start with it filled in. {feeHint} Leave
            it empty for none.
          </span>
        </div>
        <div className="ac-field">
          <CategoryPicker
            categories={categories}
            kind="expense"
            label="Fee category"
            allowNone
            noneLabel="No default category"
            value={watch("feeCategoryId") || null}
            onChange={(id) => setValue("feeCategoryId", id ?? "")}
          />
          {errors.feeCategoryId && (
            <p className="field-error">{errors.feeCategoryId.message}</p>
          )}
        </div>
        {bonusRate.trim() !== "" && (
          <div className="ac-field">
            <CategoryPicker
              categories={categories}
              kind="income"
              label="Bonus category"
              value={watch("bonusCategoryId") || null}
              onChange={(id) => setValue("bonusCategoryId", id ?? "")}
            />
            {errors.bonusCategoryId && (
              <p className="field-error">{errors.bonusCategoryId.message}</p>
            )}
          </div>
        )}
      </div>
    </details>
  );
}

export function PrivacyNote({ form }: { form: AccountForm }) {
  if (!form.privateMode) return null;
  return (
    <p className="ac-note">
      Privacy mode hides this amount. Use the eye control in the header to show
      amounts.
    </p>
  );
}

function ActionRow({
  form,
  kind,
}: {
  form: AccountForm;
  kind: "archive" | "unarchive" | "delete";
}) {
  const { baseline, onAction } = form;
  if (!baseline) return null;
  return (
    <button
      type="button"
      className="ui-row ui-row-press ac-row"
      onClick={() => onAction(kind, baseline)}
    >
      <span className="ui-row-main">
        <span
          className={
            kind === "delete" ? "ui-row-title ac-danger" : "ui-row-title"
          }
        >
          {kind === "delete"
            ? "Delete"
            : kind === "archive"
              ? "Archive"
              : "Unarchive"}
        </span>
      </span>
    </button>
  );
}

/** Archive (or Unarchive) and Delete, for an account that exists. These sit inside the form's fieldset, which is disabled while a save is in flight or unconfirmed. */
export function ActionRows({ form }: { form: AccountForm }) {
  const { baseline } = form;
  if (!baseline) return null;
  return (
    <div className="ac-card">
      <ActionRow
        form={form}
        kind={baseline.archivedAt ? "unarchive" : "archive"}
      />
      <ActionRow form={form} kind="delete" />
    </div>
  );
}
