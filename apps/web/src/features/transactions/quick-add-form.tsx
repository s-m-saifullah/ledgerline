import { zodResolver } from "@hookform/resolvers/zod";
import type { Account, Category, Transaction } from "@ledgerline/shared";
import { Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { Overlay } from "../../components/overlay";
import { ApiError } from "../../lib/api";
import { categoryOptions } from "../categories/tree";
import { useCategoryCreate } from "../categories/use-category-create";
import { prepareTransactionCreate } from "./api";
import { changeKind, EntryFields } from "./entry-fields";
import { type EntryType, TypePill } from "./entry-sheet";
import {
  rememberAccount,
  type TransactionFormValues,
  transactionBody,
  transactionDefaults,
  transactionFormSchema,
} from "./form";
import { SaveErrors } from "./quick-add/fields";

const uncertainFailure = (failure: unknown) =>
  !(failure instanceof ApiError) || failure.status >= 500;
export function QuickAddForm({
  actorId,
  ledgerId,
  accounts,
  categories,
  open,
  writable,
  blocked,
  onDismiss,
  onSaved,
  onCategorySaved,
  onRefresh,
  onLock,
  returnFocusId = "add-transaction",
  startKind = "expense",
  onTypeChange,
}: {
  /** The kind the form opens on: Add remembers it when the pill moves to Transfer and back. */
  startKind?: "expense" | "income";
  onTypeChange?: ((type: EntryType) => void) | undefined;
  returnFocusId?: string | undefined;
  actorId: string;
  ledgerId: string;
  accounts: readonly Account[];
  categories: readonly Category[];
  open: boolean;
  writable: boolean;
  blocked: boolean;
  onDismiss: () => void;
  onSaved: (transaction: Transaction) => void;
  onCategorySaved: (category: Category) => void;
  onRefresh: () => Promise<void>;
  onLock?: ((locked: boolean) => void) | undefined;
}) {
  const [error, setError] = useState("");
  const [uncertain, setUncertain] = useState(false);
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const attempt = useRef<(() => Promise<Transaction>) | null>(null);
  const inFlight = useRef(false);
  const defaults = () => ({
    ...transactionDefaults(actorId, ledgerId, accounts),
    kind: startKind,
  });
  const form = useForm<TransactionFormValues>({
    resolver: zodResolver(transactionFormSchema),
    defaultValues: defaults(),
  });
  const { watch, reset, setError: fieldError, handleSubmit } = form;
  const kind = watch("kind");
  const { create: categoryCreate, uncertain: categoryUncertain } =
    useCategoryCreate(ledgerId, kind, onCategorySaved);
  const busy = saving || refreshing;
  useEffect(() => {
    onLock?.(busy || uncertain || categoryUncertain);
  }, [busy, uncertain, categoryUncertain, onLock]);
  useEffect(() => {
    if (open && uncertain)
      document.getElementById("retry-transaction-save")?.focus();
  }, [open, uncertain]);
  // The fields stay open while a category is unconfirmed: choosing its suggestion again is the retry.
  const fieldsFrozen = busy || uncertain || blocked || !writable;
  const frozen = fieldsFrozen || categoryUncertain;
  const activeAccounts = accounts.filter((row) => !row.archivedAt);
  const choices = categoryOptions(categories, kind, "");
  useEffect(() => {
    // Keep every original payload intact across close/resume while its outcome is unknown.
    if (!open && !attempt.current && !inFlight.current && !categoryUncertain) {
      reset({
        ...transactionDefaults(actorId, ledgerId, accounts),
        kind: startKind,
      });
      setError("");
    }
  }, [open, reset, actorId, ledgerId, accounts, startKind, categoryUncertain]);
  const executeSave = async (values?: TransactionFormValues) => {
    if (inFlight.current || categoryUncertain || blocked || !writable) return;
    if (!attempt.current) {
      if (!values) return;
      if (!activeAccounts.some((row) => row.id === values.accountId)) {
        fieldError("accountId", { message: "Choose an active account." });
        return;
      }
      if (
        !values.splitEnabled &&
        !choices.some((option) => option.category.id === values.categoryId)
      ) {
        fieldError("categoryId", {
          message: "Choose an active category for this entry.",
        });
        return;
      }
      attempt.current = prepareTransactionCreate(
        ledgerId,
        transactionBody(values),
      );
    }
    inFlight.current = true;
    setSaving(true);
    setError("");
    try {
      const transaction = await attempt.current();
      attempt.current = null;
      setUncertain(false);
      rememberAccount(actorId, ledgerId, transaction.accountId);
      reset({
        ...transactionDefaults(actorId, ledgerId, accounts),
        kind: startKind,
      });
      onSaved(transaction);
    } catch (failure) {
      if (uncertainFailure(failure)) {
        setUncertain(true);
        setError(
          "We couldn't confirm the save. Retry to confirm the same action.",
        );
      } else {
        attempt.current = null;
        setUncertain(false);
        setError(
          failure instanceof ApiError
            ? failure.message
            : "Couldn't save this entry.",
        );
      }
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  };
  const setup = activeAccounts.length === 0 && !attempt.current;
  return (
    <Overlay
      open={open}
      title="Add transaction"
      description="Amount, category, save."
      busy={busy}
      onDismiss={onDismiss}
      cancelLabel={uncertain || categoryUncertain ? "Close for now" : "Cancel"}
      initialFocusId={
        uncertain
          ? "retry-transaction-save"
          : blocked
            ? undefined
            : "transaction-amount"
      }
      returnFocusId={returnFocusId}
      fallbackFocusId="main-content"
      footer={
        setup ? undefined : (
          <button
            id="retry-transaction-save"
            type="submit"
            form="entry-form"
            className="ui-btn ui-btn-primary"
            disabled={busy || blocked || categoryUncertain || !writable}
          >
            {saving ? "Saving…" : uncertain ? "Retry save" : "Save transaction"}
          </button>
        )
      }
    >
      <TypePill
        value={kind}
        withTransfer
        disabled={frozen}
        onChange={(type) => {
          onTypeChange?.(type);
          if (type !== "transfer") changeKind(form, type);
        }}
      />
      {!writable && (
        <p role="status">You have read-only access to this ledger.</p>
      )}
      {blocked && (
        <p role="alert">
          Confirm the earlier transaction action before adding another entry.
        </p>
      )}
      {setup ? (
        <div className="entry-setup">
          <p>Create an active account before recording entries.</p>
          <Link
            to="/accounts"
            className="ui-btn ui-btn-secondary"
            onClick={onDismiss}
          >
            Set up accounts
          </Link>
        </div>
      ) : (
        <form
          id="entry-form"
          noValidate
          className="entry-form"
          onSubmit={(event) => {
            if (attempt.current) {
              event.preventDefault();
              void executeSave();
            } else void handleSubmit((values) => executeSave(values))(event);
          }}
        >
          <fieldset disabled={fieldsFrozen} className="entry-fields">
            <EntryFields
              form={form}
              ledgerId={ledgerId}
              categories={categories}
              accounts={activeAccounts}
              idPrefix="transaction"
              frozen={fieldsFrozen}
              accountError="Choose an active account."
              categoryCreate={categoryCreate}
            />
          </fieldset>
          <SaveErrors
            busy={busy}
            error={error}
            uncertain={uncertain}
            onRefresh={async () => {
              setRefreshing(true);
              try {
                await onRefresh();
              } finally {
                setRefreshing(false);
              }
            }}
          />
        </form>
      )}
    </Overlay>
  );
}
