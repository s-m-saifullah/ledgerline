import type { Account, Category } from "@ledgerline/shared";
import { SwitchRow } from "@ledgerline/ui";
import type { UseFormReturn } from "react-hook-form";
import type { ComboCreate } from "../../components/combo-field";
import { DateTimeInput } from "../../components/date-time-input";
import { EntryAmount } from "../../components/entry-amount";
import { NativeSelect } from "../../components/native-select";
import { EntryRate } from "../currencies/entry-rate";
import { TagPicker } from "../tags/tag-picker";
import { CategoryCombo } from "./category-combo";
import { EntryCard } from "./entry-sheet";
import { amountMinor, type TransactionFormValues } from "./form";
import { SplitFields } from "./split-fields";

type Kind = "expense" | "income";

/** Changing the kind clears the category and every split line's category: they belong to the old kind. */
export function changeKind(
  form: UseFormReturn<TransactionFormValues>,
  kind: Kind,
) {
  form.setValue("kind", kind);
  form.setValue("categoryId", "");
  form.setValue(
    "splits",
    form.watch("splits")?.map((line) => ({
      ...line,
      id: undefined,
      categoryId: "",
    })),
  );
}

/**
 * The fields of an expense or income, shared by Add and Edit (ADR 0047): the big amount, a card with payee,
 * account, category and when, and a card with tags, note and Pending. `idPrefix` keeps the field ids each
 * form has always had; the rest says what differs between a new entry and a saved one.
 */
export function EntryFields({
  form,
  ledgerId,
  categories,
  accounts,
  idPrefix,
  frozen,
  ownAccountId,
  fallbackCurrency = "USD",
  accountError,
  savedRate,
  linked = false,
  categoryCreate,
}: {
  form: UseFormReturn<TransactionFormValues>;
  ledgerId: string;
  categories: readonly Category[];
  accounts: readonly Account[];
  idPrefix: "transaction" | "edit-transaction";
  frozen: boolean;
  /** An edit keeps the entry's own account in the list even when it is archived. */
  ownAccountId?: string | undefined;
  fallbackCurrency?: string;
  accountError: string;
  /** An edit keeps the entry's saved rate until one is set by hand or the currency changes. */
  savedRate?: ((currency: string) => string | undefined) | undefined;
  /** A transfer's fee or bonus and a payment's tip keep their kind and are never split. */
  linked?: boolean;
  /** Offered in the category fields (and the split lines) for a name nobody has yet; none for a viewer. */
  categoryCreate?: ComboCreate | undefined;
}) {
  const {
    register,
    watch,
    setValue,
    formState: { errors },
  } = form;
  const kind = watch("kind");
  const currency = watch("currency");
  const choices = accounts.filter(
    (row) => !row.archivedAt || row.id === ownAccountId,
  );
  const amountId = `${idPrefix}-amount`;
  return (
    <>
      <div className="entry-amount-block">
        <EntryAmount
          id={amountId}
          label={`Amount (${currency})`}
          currency={currency}
          invalid={!!errors.amount}
          describedBy={errors.amount ? `${amountId}-error` : undefined}
          inputProps={register("amount")}
        />
        {errors.amount && (
          <p id={`${amountId}-error`} className="field-error">
            {errors.amount.message}
          </p>
        )}
        <EntryRate
          ledgerId={ledgerId}
          currency={currency}
          date={watch("date")}
          amountMinor={amountMinor(watch("amount"), currency)}
          manualRate={watch("fxRate")}
          savedRate={savedRate?.(currency)}
          onManualRate={(rate) => setValue("fxRate", rate)}
          disabled={frozen}
        />
      </div>
      <EntryCard>
        <div className="entry-field">
          <label htmlFor={`${idPrefix}-payee`}>
            {kind === "income" ? "Payer" : "Payee"}
          </label>
          <input
            id={`${idPrefix}-payee`}
            maxLength={200}
            autoComplete="off"
            {...register("payee")}
          />
        </div>
        <div className="entry-field">
          <label htmlFor={`${idPrefix}-account`}>Account</label>
          <NativeSelect
            id={`${idPrefix}-account`}
            value={watch("accountId")}
            onChange={(event) => {
              setValue("accountId", event.target.value);
              // The entry follows its account's currency; a rate set by hand was for the old one.
              setValue(
                "currency",
                accounts.find((row) => row.id === event.target.value)
                  ?.currency ?? fallbackCurrency,
              );
              setValue("fxRate", "");
            }}
          >
            <option value="" disabled>
              Choose an account
            </option>
            {choices.map((row) => (
              <option key={row.id} value={row.id} disabled={!!row.archivedAt}>
                {row.name}
                {row.archivedAt ? " (archived)" : ""}
              </option>
            ))}
          </NativeSelect>
          {errors.accountId && <p className="field-error">{accountError}</p>}
        </div>
        <div className="entry-field">
          {!watch("splitEnabled") && (
            <CategoryCombo
              categories={categories}
              kind={kind}
              value={watch("categoryId") || null}
              onChange={(id) =>
                setValue("categoryId", id, { shouldValidate: true })
              }
              create={categoryCreate}
            />
          )}
          {errors.categoryId && (
            <p className="field-error">Choose a category.</p>
          )}
          {!linked && (
            <SplitFields
              form={form}
              categories={categories}
              kind={kind}
              categoryCreate={categoryCreate}
            />
          )}
        </div>
        <div className="entry-when">
          <div className="entry-field">
            <label htmlFor={`${idPrefix}-date`}>Date</label>
            <DateTimeInput
              label="Date"
              required
              id={`${idPrefix}-date`}
              type="date"
              min="0001-01-01"
              max="9999-12-31"
              aria-invalid={!!errors.date}
              {...register("date")}
            />
            {errors.date && <p className="field-error">Choose a valid date.</p>}
          </div>
          <div className="entry-field">
            <label htmlFor={`${idPrefix}-time`}>Time (optional)</label>
            <DateTimeInput
              label="Time (optional)"
              id={`${idPrefix}-time`}
              type="time"
              step={60}
              aria-invalid={!!errors.time}
              {...register("time")}
            />
            {errors.time && <p className="field-error">Choose a valid time.</p>}
          </div>
        </div>
      </EntryCard>
      <EntryCard>
        <div className="entry-field">
          <TagPicker
            id={`${idPrefix}-tags`}
            ledgerId={ledgerId}
            value={watch("tagIds")}
            onChange={(ids) => setValue("tagIds", ids)}
          />
        </div>
        <div className="entry-field">
          <label htmlFor={`${idPrefix}-note`}>Note</label>
          <textarea
            id={`${idPrefix}-note`}
            maxLength={2000}
            rows={2}
            {...register("note")}
          />
        </div>
        <SwitchRow
          title="Pending"
          hint="Does not change your balance yet."
          checked={watch("status") === "pending"}
          onChange={(on) => setValue("status", on ? "pending" : "cleared")}
          disabled={frozen}
        />
      </EntryCard>
    </>
  );
}
