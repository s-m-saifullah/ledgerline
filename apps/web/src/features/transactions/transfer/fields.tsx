import { SwitchRow } from "@ledgerline/ui";
import { ArrowUpDown } from "lucide-react";
import { AmountInput } from "../../../components/amount-input";
import { DateTimeInput } from "../../../components/date-time-input";
import { NativeSelect } from "../../../components/native-select";
import { CategoryPicker } from "../../categories/picker";
import { EntryRate } from "../../currencies/entry-rate";
import { TagPicker } from "../../tags/tag-picker";
import { EntryAmount, EntryCard } from "../entry-sheet";
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
    ledgerId,
    fromCurrency,
    toCurrency,
    crossCurrency,
  } = form;
  return (
    <div className="entry-amount-block">
      <EntryAmount
        id="transfer-amount"
        label={
          crossCurrency
            ? `Amount sent (${fromCurrency})`
            : `Amount (${fromCurrency})`
        }
        currency={fromCurrency}
        invalid={!!errors.amount}
        describedBy={errors.amount ? "transfer-amount-error" : undefined}
        inputProps={register("amount")}
      />
      {errors.amount && (
        <p id="transfer-amount-error" className="field-error">
          {errors.amount.message}
        </p>
      )}
      {crossCurrency && (
        <>
          <EntryAmount
            id="transfer-received"
            label={`Amount received (${toCurrency})`}
            currency={toCurrency}
            invalid={!!errors.receivedAmount}
            describedBy={
              errors.receivedAmount ? "transfer-received-error" : undefined
            }
            inputProps={register("receivedAmount")}
          />
          {errors.receivedAmount && (
            <p id="transfer-received-error" className="field-error">
              {errors.receivedAmount.message}
            </p>
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
    </div>
  );
}

/** From and To with the swap between them, then the date and time. */
export function renderAccountsAndWhen(form: TransferFormContext) {
  const { register, setValue, errors, accounts, baseline, swap, canSwap } =
    form;
  const field = (name: "fromAccountId" | "toAccountId") => (
    <div className="entry-field">
      <label htmlFor={`transfer-${name}`}>
        {name === "fromAccountId" ? "From account" : "To account"}
      </label>
      <NativeSelect
        id={`transfer-${name}`}
        {...register(name, {
          // A rate set by hand belonged to the old accounts.
          onChange: () => setValue("fxRate", ""),
        })}
      >
        <option value="" disabled>
          Choose an account
        </option>
        {accounts
          .filter((row) => !row.archivedAt || row.id === baseline?.[name])
          .map((row) => (
            <option key={row.id} value={row.id} disabled={!!row.archivedAt}>
              {row.name}
              {row.archivedAt ? " (archived)" : ""}
            </option>
          ))}
      </NativeSelect>
      {errors[name] && <p className="field-error">{errors[name]?.message}</p>}
    </div>
  );
  return (
    <EntryCard>
      {field("fromAccountId")}
      <div className="entry-swap">
        <button
          type="button"
          className="ui-btn ui-btn-secondary"
          aria-label="Swap accounts"
          disabled={!canSwap}
          onClick={swap}
        >
          <ArrowUpDown size={16} aria-hidden="true" />
          Swap
        </button>
      </div>
      {field("toAccountId")}
      <div className="entry-when">
        <div className="entry-field">
          <label htmlFor="transfer-date">Date</label>
          <DateTimeInput
            label="Date"
            required
            id="transfer-date"
            type="date"
            min="0001-01-01"
            max="9999-12-31"
            aria-invalid={!!errors.date}
            {...register("date")}
          />
          {errors.date && <p className="field-error">Choose a valid date.</p>}
        </div>
        <div className="entry-field">
          <label htmlFor="transfer-time">Time (optional)</label>
          <DateTimeInput
            label="Time (optional)"
            id="transfer-time"
            type="time"
            step={60}
            aria-invalid={!!errors.time}
            {...register("time")}
          />
          {errors.time && <p className="field-error">Choose a valid time.</p>}
        </div>
      </div>
    </EntryCard>
  );
}

/** The fee, the bonus and their categories: only on a new transfer. */
export function renderFeeAndBonus(form: TransferFormContext) {
  const {
    register,
    setValue,
    errors,
    baseline,
    categories,
    privateMode,
    toCurrency,
    fromCurrency,
    fromAccount,
    toAccount,
    bps,
    bonusOn,
    bonusEdited,
    feeInput,
    feeCost,
    sentMinor,
    feeEdited,
    feeCategoryId,
    bonusCategoryId,
    moreOpen,
    setMoreOpen,
  } = form;
  if (baseline) return null;
  return (
    <EntryCard>
      {fromAccount && (
        <div className="entry-field">
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
            A fixed amount, or a % of what you send.
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
      {toAccount && (
        <SwitchRow
          title="Add a bonus"
          {...(bps ? { hint: `${bps / 100}% of what arrives` } : {})}
          checked={bonusOn}
          onChange={(on) => setValue("bonusOn", on)}
        />
      )}
      {toAccount && bonusOn && (
        <div className="entry-field">
          <label htmlFor="transfer-bonus-amount">Bonus ({toCurrency})</label>
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
        </div>
      )}
      <div className="entry-field">
        <details
          className="entry-more"
          open={moreOpen}
          onToggle={(event) => setMoreOpen(event.currentTarget.open)}
        >
          <summary>
            <span>
              More{" "}
              <span className="muted">
                fee {bonusOn || bps ? "and bonus " : ""}categories
              </span>
            </span>
          </summary>
          <div className="entry-more-body">
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
          </div>
        </details>
      </div>
    </EntryCard>
  );
}

/** Tags and note, and on a saved transfer one line for a fee or bonus entry that is edited elsewhere. */
export function renderTagsAndNote(form: TransferFormContext) {
  const { register, watch, setValue, ledgerId, hasFee, hasBonus } = form;
  return (
    <EntryCard>
      <div className="entry-field">
        <TagPicker
          id="transfer-tags"
          ledgerId={ledgerId}
          value={watch("tagIds")}
          onChange={(ids) => setValue("tagIds", ids)}
        />
      </div>
      <div className="entry-field">
        <label htmlFor="transfer-note">Note</label>
        <textarea
          id="transfer-note"
          rows={2}
          maxLength={2000}
          {...register("note")}
        />
      </div>
      {hasFee && (
        <p className="entry-field form-help">
          Its fee is a separate expense: edit it from the list.
        </p>
      )}
      {hasBonus && (
        <p className="entry-field form-help">
          Its bonus is separate income: edit it from the list.
        </p>
      )}
    </EntryCard>
  );
}
