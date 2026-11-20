import { zodResolver } from "@hookform/resolvers/zod";
import type { Account, Category } from "@ledgerline/shared";
import { useContext, useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { Overlay } from "../../components/overlay";
import { ApiError } from "../../lib/api";
import { PrivacyContext } from "../../lib/preferences";
import { getAccount, prepareAccountSave } from "./api";
import type { AccountForm } from "./editor-context";
import {
  ActionRows,
  BalanceCard,
  DirectionControl,
  MoreFold,
  NameField,
  OpeningHelp,
  PrivacyNote,
} from "./editor-sections";
import {
  type AccountFormValues,
  accountBody,
  accountFormSchema,
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
  const form: AccountForm = {
    register,
    setValue,
    getFieldState,
    watch,
    errors,
    baseline,
    type,
    liability,
    currency,
    direction,
    bonusRate,
    currencies,
    categories,
    privateMode,
    moreOpen,
    setMoreOpen,
    onAction,
  };
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
      cancelLabel={uncertain ? "Close" : "Cancel"}
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
          <NameField form={form} />
          <BalanceCard form={form} />
          <OpeningHelp form={form} />
          <DirectionControl form={form} />
          <MoreFold form={form} />
          <PrivacyNote form={form} />
          <ActionRows form={form} />
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
