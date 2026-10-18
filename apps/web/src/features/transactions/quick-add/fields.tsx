import { Plus } from "lucide-react";
import { Controller } from "react-hook-form";
import { AmountInput } from "../../../components/amount-input";
import { DateTimeInput } from "../../../components/date-time-input";
import { NativeSelect } from "../../../components/native-select";
import { CategoryPicker } from "../../categories/picker";
import { EntryRate } from "../../currencies/entry-rate";
import { amountMinor } from "../form";
import { SplitFields } from "../split-fields";
import type { QuickAddContext } from "./context";

/** The entry type, the amount and the rate for a foreign account. */
export function renderKindAndAmount(ctx: QuickAddContext) {
  const { register, setValue, watch, privateMode, errors, ledgerId, frozen } =
    ctx;
  return (
    <>
      <fieldset className="balance-direction">
        <legend>Entry type</legend>
        <label>
          <input
            type="radio"
            value="expense"
            {...register("kind", {
              onChange: () => {
                setValue("categoryId", "");
                setValue(
                  "splits",
                  watch("splits")?.map((line) => ({
                    ...line,
                    id: undefined,
                    categoryId: "",
                  })),
                );
              },
            })}
          />
          Expense
        </label>
        <label>
          <input
            type="radio"
            value="income"
            {...register("kind", {
              onChange: () => {
                setValue("categoryId", "");
                setValue(
                  "splits",
                  watch("splits")?.map((line) => ({
                    ...line,
                    id: undefined,
                    categoryId: "",
                  })),
                );
              },
            })}
          />
          Income
        </label>
      </fieldset>
      <label htmlFor="transaction-amount">Amount ({watch("currency")})</label>
      <AmountInput
        currency={watch("currency")}
        id="transaction-amount"
        className="transaction-amount"
        type={privateMode ? "password" : "text"}
        inputMode="decimal"
        autoComplete="off"
        aria-invalid={!!errors.amount}
        aria-describedby="transaction-amount-help"
        {...register("amount")}
      />
      <p
        id="transaction-amount-help"
        className={errors.amount ? "field-error" : "form-help"}
      >
        {errors.amount?.message ??
          (privateMode
            ? "Privacy mode hides the amount."
            : "Enter a positive amount; the entry type sets its direction.")}
      </p>
      <EntryRate
        ledgerId={ledgerId}
        currency={watch("currency")}
        date={watch("date")}
        amountMinor={amountMinor(watch("amount"), watch("currency"))}
        manualRate={watch("fxRate")}
        onManualRate={(rate) => setValue("fxRate", rate)}
        disabled={frozen}
      />
    </>
  );
}
/** Split lines or the category picker, and the inline new category. */
export function renderCategoryFields(ctx: QuickAddContext) {
  const {
    form,
    categories,
    kind,
    watch,
    control,
    frozen,
    errors,
    setNewCategory,
    newCategory,
    categoryName,
    setCategoryName,
    createCategory,
  } = ctx;
  return (
    <>
      <SplitFields form={form} categories={categories} kind={kind} />
      {!watch("splitEnabled") && (
        <Controller
          name="categoryId"
          control={control}
          render={({ field }) => (
            <CategoryPicker
              categories={categories}
              kind={kind}
              value={field.value || null}
              onChange={(id) => field.onChange(id ?? "")}
              disabled={frozen}
            />
          )}
        />
      )}
      {errors.categoryId && <p className="field-error">Choose a category.</p>}
      <button
        type="button"
        className="quiet-button inline-category-toggle"
        onClick={() => setNewCategory((value) => !value)}
      >
        <Plus size={16} />
        New category
      </button>
      {newCategory && (
        <div className="inline-category">
          <label htmlFor="quick-category-name">New category name</label>
          <input
            id="quick-category-name"
            value={categoryName}
            onChange={(event) => setCategoryName(event.target.value)}
            maxLength={100}
            autoComplete="off"
          />
          <button
            type="button"
            className="secondary-button"
            onClick={() => void createCategory()}
          >
            Add category
          </button>
        </div>
      )}
    </>
  );
}
/** The account and the date. */
export function renderAccountAndDate(ctx: QuickAddContext) {
  const { watch, setValue, accounts, activeAccounts, errors, register } = ctx;
  return (
    <div className="transaction-context">
      <div>
        <label htmlFor="transaction-account">Account</label>
        <NativeSelect
          id="transaction-account"
          value={watch("accountId")}
          onChange={(event) => {
            setValue("accountId", event.target.value);
            // The entry is in the account's currency; a hand-set rate was for the old one.
            setValue(
              "currency",
              accounts.find((row) => row.id === event.target.value)?.currency ??
                "USD",
            );
            setValue("fxRate", "");
          }}
        >
          <option value="" disabled>
            Choose an account
          </option>
          {activeAccounts.map((row) => (
            <option key={row.id} value={row.id}>
              {row.name}
            </option>
          ))}
        </NativeSelect>
        {errors.accountId && (
          <p className="field-error">Choose an active account.</p>
        )}
      </div>
      <div>
        <label htmlFor="transaction-date">Date</label>
        <DateTimeInput
          label="Date"
          required
          id="transaction-date"
          type="date"
          min="0001-01-01"
          max="9999-12-31"
          aria-invalid={!!errors.date}
          {...register("date")}
        />
        {errors.date && <p className="field-error">Choose a valid date.</p>}
      </div>
    </div>
  );
}
/** Time, payee, note and status under More details. */
export function renderMoreDetails(ctx: QuickAddContext) {
  const { errors, register, kind } = ctx;
  return (
    <details className="transaction-details">
      <summary>More details</summary>
      <div className="account-fields">
        <label htmlFor="transaction-time">Time (optional)</label>
        <DateTimeInput
          label="Time (optional)"
          id="transaction-time"
          type="time"
          step={60}
          aria-invalid={!!errors.time}
          aria-describedby="transaction-time-help"
          {...register("time")}
        />
        <p id="transaction-time-help" className="form-help">
          Local time on the selected date. Leave blank if unknown.
        </p>
        {errors.time && <p className="field-error">Choose a valid time.</p>}
        <label htmlFor="transaction-payee">
          {kind === "income" ? "Payer" : "Payee"}
        </label>
        <input
          id="transaction-payee"
          maxLength={200}
          autoComplete="off"
          {...register("payee")}
        />
        <label htmlFor="transaction-note">Note</label>
        <textarea
          id="transaction-note"
          maxLength={2000}
          rows={2}
          {...register("note")}
        />
        <label htmlFor="transaction-status">Status</label>
        <NativeSelect id="transaction-status" {...register("status")}>
          <option value="cleared">Cleared</option>
          <option value="pending">Pending</option>
        </NativeSelect>
        <p className="form-help">
          Pending entries do not change your posted balance.
        </p>
      </div>
    </details>
  );
}
/** Category and save errors, the category retry and the refresh button. */
export function renderRetryAndErrors(ctx: QuickAddContext) {
  const {
    categoryError,
    categoryUncertain,
    busy,
    blocked,
    writable,
    createCategory,
    error,
    uncertain,
    setRefreshing,
    onRefresh,
  } = ctx;
  return (
    <>
      {categoryError && (
        <p role="alert" className="field-error account-error">
          {categoryError}
        </p>
      )}
      {categoryUncertain && (
        <button
          id="retry-transaction-category"
          type="button"
          className="secondary-button"
          disabled={busy || blocked || !writable}
          onClick={() => void createCategory()}
        >
          Retry category
        </button>
      )}
      {error && (
        <p role="alert" className="field-error account-error">
          {error}
        </p>
      )}
      {error && !uncertain && (
        <button
          type="button"
          className="quiet-button"
          disabled={busy}
          onClick={async () => {
            setRefreshing(true);
            try {
              await onRefresh();
            } finally {
              setRefreshing(false);
            }
          }}
        >
          Refresh choices
        </button>
      )}
    </>
  );
}
