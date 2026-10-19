import { Plus } from "lucide-react";
import { AmountInput } from "../../../components/amount-input";
import { DateTimeInput } from "../../../components/date-time-input";
import { NativeSelect } from "../../../components/native-select";
import { CategoryPicker } from "../../categories/picker";
import { EntryRate } from "../../currencies/entry-rate";
import { TagPicker } from "../../tags/tag-picker";
import { feeHint } from "../fee";
import { FeePreview } from "../fee-preview";
import { amountMinor } from "../form";
import type { TransferFormContext } from "./form-context";
import { TransferRate } from "./transfer-rate";

/** The amount sent, and for two currencies the amount received, the rate hint and the manual rate. */
export function renderAmountFields(form: TransferFormContext) {
  const {
    register,
    watch,
    setValue,
    errors,
    privateMode,
    ledgerId,
    fromCurrency,
    toCurrency,
    crossCurrency,
  } = form;
  return (
    <>
      <label htmlFor="transfer-amount">
        {crossCurrency
          ? `Amount sent (${fromCurrency})`
          : `Amount (${fromCurrency})`}
      </label>
      <AmountInput
        currency={fromCurrency}
        id="transfer-amount"
        className="transaction-amount"
        type={privateMode ? "password" : "text"}
        inputMode="decimal"
        autoComplete="off"
        {...register("amount")}
      />
      {errors.amount && <p className="field-error">{errors.amount.message}</p>}
      {crossCurrency && (
        <>
          <label htmlFor="transfer-received">
            Amount received ({toCurrency})
          </label>
          <AmountInput
            currency={toCurrency}
            id="transfer-received"
            type={privateMode ? "password" : "text"}
            inputMode="decimal"
            autoComplete="off"
            {...register("receivedAmount")}
          />
          {errors.receivedAmount && (
            <p className="field-error">{errors.receivedAmount.message}</p>
          )}
          <TransferRate
            sent={amountMinor(watch("amount"), fromCurrency)}
            received={amountMinor(watch("receivedAmount"), toCurrency)}
            fromCurrency={fromCurrency}
            toCurrency={toCurrency}
          />
          {fromCurrency !== "USD" && toCurrency !== "USD" && (
            <EntryRate
              ledgerId={ledgerId}
              currency={fromCurrency}
              date={watch("date")}
              amountMinor={amountMinor(watch("amount"), fromCurrency)}
              manualRate={watch("fxRate")}
              onManualRate={(rate) => setValue("fxRate", rate)}
            />
          )}
        </>
      )}
    </>
  );
}

/** The from and to account pickers. */
export function renderAccountPickers(form: TransferFormContext) {
  const { register, setValue, errors, accounts, baseline } = form;
  return (
    <div className="transaction-context">
      {(["fromAccountId", "toAccountId"] as const).map((field) => (
        <div key={field}>
          <label htmlFor={`transfer-${field}`}>
            {field === "fromAccountId" ? "From account" : "To account"}
          </label>
          <NativeSelect
            id={`transfer-${field}`}
            {...register(field, {
              // A rate set by hand belonged to the old accounts.
              onChange: () => setValue("fxRate", ""),
            })}
          >
            <option value="" disabled>
              Choose an account
            </option>
            {accounts
              .filter((row) => !row.archivedAt || row.id === baseline?.[field])
              .map((row) => (
                <option key={row.id} value={row.id} disabled={!!row.archivedAt}>
                  {row.name}
                  {row.archivedAt ? " (archived)" : ""}
                </option>
              ))}
          </NativeSelect>
          {errors[field] && (
            <p className="field-error">{errors[field]?.message}</p>
          )}
        </div>
      ))}
    </div>
  );
}

/** The optional fee box on a new transfer. */
export function renderFeeField(form: TransferFormContext) {
  const {
    register,
    errors,
    baseline,
    privateMode,
    fromCurrency,
    fromAccount,
    feeInput,
    feeCost,
    sentMinor,
    feeEdited,
  } = form;
  return (
    <>
      {!baseline && fromAccount && (
        <div className="transfer-fee">
          <label htmlFor="transfer-fee">Fee (optional)</label>
          <input
            id="transfer-fee"
            type={privateMode ? "password" : "text"}
            inputMode="text"
            autoComplete="off"
            placeholder="2 or 2%"
            aria-invalid={!!errors.feeText}
            aria-describedby="transfer-fee-help transfer-fee-preview"
            {...register("feeText", {
              onChange: () => {
                feeEdited.current = true;
              },
            })}
          />
          <p id="transfer-fee-help" className="form-help">
            {feeHint} Charged to {fromAccount.name} in {fromCurrency}; the
            amount received stays the same.
          </p>
          {errors.feeText && (
            <p className="field-error">{errors.feeText.message}</p>
          )}
          <p id="transfer-fee-preview" className="form-help" aria-live="polite">
            <FeePreview
              fee={feeInput.kind}
              cost={feeCost}
              sent={sentMinor}
              currency={fromCurrency}
              accountName={fromAccount.name}
            />
          </p>
        </div>
      )}
    </>
  );
}

/** The optional bonus on a new transfer. */
export function renderBonusFields(form: TransferFormContext) {
  const {
    register,
    setValue,
    errors,
    baseline,
    privateMode,
    toCurrency,
    toAccount,
    bps,
    bonusOn,
    bonusEdited,
  } = form;
  return (
    <>
      {!baseline && toAccount && (bps || bonusOn) && (
        <div className="transfer-bonus">
          <label className="split-toggle">
            <input
              type="checkbox"
              checked={bonusOn}
              onChange={(event) => setValue("bonusOn", event.target.checked)}
            />{" "}
            Add a bonus{bps ? ` (${bps / 100}% of what arrives)` : ""}
          </label>
          {bonusOn && (
            <>
              <label htmlFor="transfer-bonus-amount">
                Bonus ({toCurrency})
              </label>
              <AmountInput
                currency={toCurrency}
                id="transfer-bonus-amount"
                type={privateMode ? "password" : "text"}
                inputMode="decimal"
                autoComplete="off"
                {...register("bonusAmount", {
                  onChange: () => {
                    bonusEdited.current = true;
                  },
                })}
              />
              {errors.bonusAmount && (
                <p className="field-error">{errors.bonusAmount.message}</p>
              )}
              <p className="form-help">
                Saved as income in {toAccount.name} together with the transfer.
                Switch it off to save the transfer alone.
              </p>
            </>
          )}
        </div>
      )}
      {!baseline && toAccount && !bps && !bonusOn && (
        <button
          type="button"
          className="quiet-button inline-category-toggle"
          onClick={() => setValue("bonusOn", true)}
        >
          <Plus size={16} />
          Add a bonus
        </button>
      )}
    </>
  );
}

/** The fee and bonus categories under More. */
export function renderMoreCategories(form: TransferFormContext) {
  const {
    setValue,
    errors,
    baseline,
    categories,
    bps,
    bonusOn,
    feeCategoryId,
    bonusCategoryId,
    moreOpen,
    setMoreOpen,
  } = form;
  return (
    <>
      {!baseline && (
        <details
          className="transaction-details transfer-more"
          open={moreOpen}
          onToggle={(event) => setMoreOpen(event.currentTarget.open)}
        >
          <summary>
            More
            <span className="muted transfer-more-hint">
              {" "}
              fee {bonusOn || bps ? "and bonus " : ""}categories
            </span>
          </summary>
          <div className="account-fields">
            <CategoryPicker
              categories={categories}
              kind="expense"
              label="Fee category"
              value={feeCategoryId || null}
              onChange={(id) => setValue("feeCategoryId", id ?? "")}
            />
            {errors.feeCategoryId && (
              <p className="field-error">{errors.feeCategoryId.message}</p>
            )}
            {bonusOn && (
              <>
                <CategoryPicker
                  categories={categories}
                  kind="income"
                  label="Bonus category"
                  value={bonusCategoryId || null}
                  onChange={(id) => setValue("bonusCategoryId", id ?? "")}
                />
                {errors.bonusCategoryId && (
                  <p className="field-error">
                    {errors.bonusCategoryId.message}
                  </p>
                )}
              </>
            )}
            <p className="form-help">
              Used only when the transfer has a fee
              {bonusOn ? " or a bonus" : ""}. An account can remember its
              default categories when you edit it.
            </p>
          </div>
        </details>
      )}
    </>
  );
}

/** Notes about an existing fee or bonus entry. */
export function renderLinkedNotes(form: TransferFormContext) {
  const { hasFee, hasBonus } = form;
  return (
    <>
      {hasFee && (
        <p className="form-help">
          This transfer has a fee entry. It is a separate expense, so edit it
          from the transaction list.
        </p>
      )}
      {hasBonus && (
        <p className="form-help">
          This transfer has a bonus entry. It is separate income, so edit it
          from the transaction list.
        </p>
      )}
    </>
  );
}

/** Date, time and note. */
export function renderWhenAndNote(form: TransferFormContext) {
  const { register, errors, watch, setValue, ledgerId } = form;
  return (
    <>
      <div className="transaction-context">
        <div>
          <label htmlFor="transfer-date">Date</label>
          <DateTimeInput
            label="Date"
            required
            id="transfer-date"
            type="date"
            min="0001-01-01"
            max="9999-12-31"
            {...register("date")}
          />
          {errors.date && <p className="field-error">Choose a valid date.</p>}
        </div>
        <div>
          <label htmlFor="transfer-time">Time (optional)</label>
          <DateTimeInput
            label="Time (optional)"
            id="transfer-time"
            type="time"
            step={60}
            {...register("time")}
          />
          {errors.time && <p className="field-error">Choose a valid time.</p>}
        </div>
      </div>
      <label htmlFor="transfer-note">Note</label>
      <textarea
        id="transfer-note"
        rows={2}
        maxLength={2000}
        {...register("note")}
      />
      <TagPicker
        id="transfer-tags"
        ledgerId={ledgerId}
        value={watch("tagIds")}
        onChange={(ids) => setValue("tagIds", ids)}
      />
    </>
  );
}
