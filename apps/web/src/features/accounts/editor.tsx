import { zodResolver } from "@hookform/resolvers/zod";
import {
  type Account,
  type Category,
  currencyDigits,
} from "@ledgerline/shared";
import { SegmentedControl } from "@ledgerline/ui";
import { ChevronDown } from "lucide-react";
import { useContext, useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { AmountInput } from "../../components/amount-input";
import { Overlay } from "../../components/overlay";
import { PickRow } from "../../components/pick-row";
import { ApiError } from "../../lib/api";
import { decimalFromCents } from "../../lib/money";
import { PrivacyContext } from "../../lib/preferences";
import { CategoryPicker } from "../categories/picker";
import { feeHint } from "../transactions/fee";
import { getAccount, prepareAccountSave } from "./api";
import {
  type AccountFormValues,
  accountBody,
  accountFormSchema,
  accountTypes,
  formDefaults,
  isLiability,
} from "./form";
import "./accounts.css";

/**
 * The account sheet (the prototype's `OV["account-form"]`): Name, then one card with Type, Currency (only when the
 * ledger has a second one) and the opening balance, a "More" fold for the transfer bonus and fee, and, for an
 * account that exists, Archive and Delete as rows. The save, retry, reload and conflict rules are the dialog's, kept.
 */
export function AccountEditor({
  ledgerId,
  account,
  open,
  onDismiss,
  onUnconfirmed,
  onSaved,
  onAction,
  currencies = ["USD"],
  categories = [],
}: {
  ledgerId: string;
  account?: Account | undefined;
  /** Currencies a new account can use: the base currency, then the ones added. */
  currencies?: string[];
  /** Used to pick the category a transfer bonus is recorded in. */
  categories?: readonly Category[];
  open: boolean;
  onDismiss: () => void;
  onUnconfirmed: (value: boolean) => void;
  onSaved: (account: Account) => void;
  /** Archive, Unarchive and Delete are questions of their own; the page opens them. */
  onAction: (
    kind: "archive" | "unarchive" | "delete",
    account: Account,
  ) => void;
}) {
  const privateMode = useContext(PrivacyContext);
  const [baseline, setBaseline] = useState(account);
  const [error, setError] = useState("");
  const [uncertain, setUncertain] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [reloading, setReloading] = useState(false);
  const attempt = useRef<(() => Promise<Account>) | null>(null);
  const inFlight = useRef(false);
  const {
    register,
    handleSubmit,
    watch,
    getFieldState,
    setValue,
    setError: setFieldError,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<AccountFormValues>({
    resolver: zodResolver(accountFormSchema),
    defaultValues: formDefaults(account),
  });
  const type = watch("type");
  const liability = isLiability(type);
  const currency = watch("currency");
  const direction = watch("direction");
  const bonusRate = watch("bonusRate");
  const [moreOpen, setMoreOpen] = useState(false);
  // The transfer bonus and fee live under More; open it when one of them has a problem to show.
  const moreProblem =
    !!errors.bonusCategoryId ||
    !!errors.feeCategoryId ||
    !!errors.bonusRate ||
    !!errors.defaultFee;
  useEffect(() => {
    if (moreProblem) setMoreOpen(true);
  }, [moreProblem]);
  const busy = isSubmitting || reloading;
  const frozen = busy || uncertain || conflict;
  const submit = handleSubmit(async (values) => {
    if (inFlight.current || conflict) return;
    inFlight.current = true;
    setError("");
    attempt.current ??= prepareAccountSave(
      ledgerId,
      baseline,
      accountBody(values),
    );
    let saved: Account;
    try {
      saved = await attempt.current();
    } catch (failure) {
      if (!(failure instanceof ApiError) || failure.status >= 500) {
        setUncertain(true);
        onUnconfirmed(true);
        setError(
          "We couldn't confirm the save. Retry to confirm the same action.",
        );
      } else {
        attempt.current = null;
        setUncertain(false);
        onUnconfirmed(false);
        if (failure.status === 409) {
          setConflict(true);
          setError(
            "This account changed. Reload its latest details before saving again. Reloading replaces this form.",
          );
        } else {
          setError(failure.message);
          for (const issue of failure.fields) {
            const field = issue.field.replace(/^body\./, "");
            if (field === "name" || field === "type")
              setFieldError(field, { message: issue.message });
            if (field === "inboundBonusBps")
              setFieldError("bonusRate", { message: issue.message });
            if (field === "bonusCategoryId")
              setFieldError("bonusCategoryId", { message: issue.message });
            if (field.startsWith("defaultFee"))
              setFieldError("defaultFee", { message: issue.message });
            if (field === "feeCategoryId")
              setFieldError("feeCategoryId", { message: issue.message });
            if (field === "openingBalance.amount")
              setFieldError("amount", { message: issue.message });
          }
        }
      }
      return;
    } finally {
      inFlight.current = false;
    }
    onUnconfirmed(false);
    onSaved(saved);
  });
  const reload = async () => {
    if (!baseline) return;
    setReloading(true);
    try {
      const latest = await getAccount(ledgerId, baseline.id);
      setBaseline(latest);
      reset(formDefaults(latest));
      attempt.current = null;
      setConflict(false);
      setError("");
    } catch {
      setError("Couldn't reload this account. Please try again.");
    } finally {
      setReloading(false);
    }
  };
  // These sit inside the form's fieldset, which is disabled while a save is in flight or unconfirmed.
  const action = (kind: "archive" | "unarchive" | "delete") =>
    baseline && (
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
  return (
    <Overlay
      open={open}
      title={baseline ? "Edit account" : "Add account"}
      description={
        baseline
          ? "Keep the details of this account up to date."
          : "Start with an account you use every day."
      }
      busy={busy}
      onDismiss={onDismiss}
      cancelLabel={uncertain ? "Close for now" : "Cancel"}
      returnFocusId={
        baseline ? `edit-account-${baseline.id}` : "accounts-title"
      }
      fallbackFocusId="accounts-title"
      initialFocusId="account-name"
      footer={
        conflict ? (
          <button
            type="button"
            className="ui-btn ui-btn-primary"
            disabled={busy}
            onClick={() => void reload()}
          >
            {reloading ? "Reloading…" : "Reload latest details"}
          </button>
        ) : (
          <button
            type="submit"
            form="account-form"
            className="ui-btn ui-btn-primary"
            disabled={busy}
          >
            {isSubmitting ? "Saving…" : uncertain ? "Retry save" : "Save"}
          </button>
        )
      }
    >
      <form id="account-form" className="ac-form" onSubmit={submit} noValidate>
        <fieldset disabled={frozen} className="ac-fields">
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
                      isLiability(value as Account["type"])
                        ? "negative"
                        : "positive",
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
                      setValue(
                        "amount",
                        decimalFromCents(0, currencyDigits(code)),
                      );
                  }}
                />
              ))}
            <div className="ac-block">
              <div className="ac-input-row">
                <label htmlFor="account-amount">
                  Opening balance ({currency})
                </label>
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
          <span id="opening-balance-help" className="sr-only">
            Use the balance before the entries you will record here. If you add
            older history later, start with the balance from before that
            history.
            {liability
              ? " Money owed records debt as a negative balance. Credit records a positive balance."
              : ""}
            {baseline && currencies.length <= 1
              ? ` The currency is ${baseline.currency}. It stays the same for the life of the account.`
              : ""}
          </span>
          <SegmentedControl
            label="Balance direction"
            value={direction}
            onChange={(value) =>
              setValue("direction", value, { shouldDirty: true })
            }
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
                  Some transfers arrive with a bonus added on top. If this
                  account gets one, enter its percentage. Transfers into this
                  account will then suggest the bonus for you to confirm each
                  time. Leave it empty for none.
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
                  If sending money from this account usually costs a fee, enter
                  it here and new transfers will start with it filled in.{" "}
                  {feeHint} Leave it empty for none.
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
                    <p className="field-error">
                      {errors.bonusCategoryId.message}
                    </p>
                  )}
                </div>
              )}
            </div>
          </details>
          {privateMode && (
            <p className="ac-note">
              Privacy mode hides this amount. Use the eye control in the header
              to show amounts.
            </p>
          )}
          {baseline && (
            <div className="ac-card">
              {action(baseline.archivedAt ? "unarchive" : "archive")}
              {action("delete")}
            </div>
          )}
        </fieldset>
        {error && (
          <p role="alert" className="field-error">
            {error}
          </p>
        )}
      </form>
    </Overlay>
  );
}
