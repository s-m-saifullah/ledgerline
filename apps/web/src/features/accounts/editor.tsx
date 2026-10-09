import { zodResolver } from "@hookform/resolvers/zod";
import type { Account } from "@ledgerline/shared";
import { Button } from "@ledgerline/ui";
import { ChevronDown } from "lucide-react";
import { useContext, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { ApiError } from "../../lib/api";
import { PrivacyContext } from "../shell/preferences";
import { getAccount, prepareAccountSave } from "./api";
import { AccountDialog } from "./dialog";
import {
  type AccountFormValues,
  accountBody,
  accountFormSchema,
  accountTypes,
  formDefaults,
  isLiability,
} from "./form";

export function AccountEditor({
  ledgerId,
  account,
  open,
  onDismiss,
  onUnconfirmed,
  onSaved,
}: {
  ledgerId: string;
  account?: Account | undefined;
  open: boolean;
  onDismiss: () => void;
  onUnconfirmed: (value: boolean) => void;
  onSaved: (account: Account) => void;
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
  const liability = isLiability(watch("type"));
  const busy = isSubmitting || reloading;
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
  return (
    <AccountDialog
      open={open}
      title={baseline ? "Edit account" : "Add account"}
      description={
        baseline
          ? "Keep the details of this account up to date."
          : "Start with an account you use every day."
      }
      busy={busy}
      onDismiss={onDismiss}
      returnFocusId={
        baseline ? `edit-account-${baseline.id}` : "accounts-title"
      }
    >
      <form onSubmit={submit} noValidate>
        <fieldset
          disabled={busy || uncertain || conflict}
          className="account-fields"
        >
          <label htmlFor="account-name">Account name</label>
          <input
            id="account-name"
            autoComplete="off"
            maxLength={100}
            aria-invalid={!!errors.name}
            aria-describedby={errors.name ? "account-name-error" : undefined}
            {...register("name")}
          />
          {errors.name && (
            <p id="account-name-error" className="field-error">
              {errors.name.message}
            </p>
          )}
          <label htmlFor="account-type">Account type</label>
          <div className="theme-picker account-select">
            <select
              id="account-type"
              {...register("type", {
                onChange: (event) => {
                  if (!baseline && !getFieldState("direction").isDirty)
                    setValue(
                      "direction",
                      isLiability(event.target.value) ? "negative" : "positive",
                    );
                },
              })}
            >
              {Object.entries(accountTypes).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <ChevronDown size={16} aria-hidden="true" />
          </div>
          {errors.type && <p className="field-error">{errors.type.message}</p>}
          <fieldset className="balance-direction">
            <legend>Balance direction</legend>
            <label>
              <input type="radio" value="positive" {...register("direction")} />
              <span>{liability ? "Credit" : "Money available"}</span>
            </label>
            <label>
              <input type="radio" value="negative" {...register("direction")} />
              <span>{liability ? "Money owed" : "Overdrawn"}</span>
            </label>
          </fieldset>
          <label htmlFor="account-amount">Opening balance (USD)</label>
          <input
            id="account-amount"
            type={privateMode ? "password" : "text"}
            inputMode="decimal"
            autoComplete="off"
            aria-invalid={!!errors.amount}
            aria-describedby={`opening-balance-help${errors.amount ? " account-amount-error" : ""}`}
            {...register("amount")}
          />
          {errors.amount && (
            <p id="account-amount-error" className="field-error">
              {errors.amount.message}
            </p>
          )}
          <p id="opening-balance-help" className="form-help">
            Use the balance before the entries you will record here. If you add
            older history later, start with the balance from before that
            history.
          </p>
          {liability && (
            <p className="form-help">
              Money owed records debt as a negative balance. Credit records a
              positive balance.
            </p>
          )}
          {privateMode && (
            <p className="form-help">
              Privacy mode hides this amount. Use the eye control in the header
              to show amounts.
            </p>
          )}
        </fieldset>
        {error && (
          <p role="alert" className="field-error account-error">
            {error}
          </p>
        )}
        <div className="account-dialog-actions">
          <button
            type="button"
            className="secondary-button"
            disabled={busy}
            onClick={onDismiss}
          >
            {uncertain ? "Close for now" : "Cancel"}
          </button>
          {conflict ? (
            <Button type="button" disabled={busy} onClick={() => void reload()}>
              {reloading ? "Reloading…" : "Reload latest details"}
            </Button>
          ) : (
            <Button type="submit" disabled={busy}>
              {isSubmitting
                ? "Saving…"
                : uncertain
                  ? "Retry save"
                  : baseline
                    ? "Save changes"
                    : "Add account"}
            </Button>
          )}
        </div>
      </form>
    </AccountDialog>
  );
}
