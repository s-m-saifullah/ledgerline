import { zodResolver } from "@hookform/resolvers/zod";
import type { Account, Category, Transaction } from "@ledgerline/shared";
import { Button } from "@ledgerline/ui";
import { useQueryClient } from "@tanstack/react-query";
import { useContext, useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { DateTimeInput } from "../../components/date-time-input";
import { EditorDialog } from "../../components/editor-dialog";
import { NativeSelect } from "../../components/native-select";
import { ApiError } from "../../lib/api";
import { CategoryPicker } from "../categories/picker";
import { PrivacyContext } from "../shell/preferences";
import {
  getTransaction,
  prepareTransactionEdit,
  prepareTransactionUndo,
} from "./api";
import {
  type TransactionFormValues,
  transactionBody,
  transactionEditDefaults,
  transactionFormSchema,
} from "./form";

import { SplitFields } from "./split-fields";

export function TransactionEditor({
  ledgerId,
  transaction,
  accounts,
  categories,
  writable,
  open,
  onDismiss,
  onSaved,
  onDeleted,
  onLock,
}: {
  ledgerId: string;
  transaction: Transaction;
  accounts: readonly Account[];
  categories: readonly Category[];
  writable: boolean;
  open: boolean;
  onDismiss: () => void;
  onSaved: (row: Transaction) => void;
  onDeleted: (row: Transaction) => void;
  onLock: (locked: boolean) => void;
}) {
  const client = useQueryClient();
  const privateMode = useContext(PrivacyContext);
  const [baseline, setBaseline] = useState(transaction);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [operation, setOperation] = useState<"edit" | "delete">("edit");
  const attempt = useRef<(() => Promise<Transaction | undefined>) | null>(null);
  const inFlight = useRef(false);
  const form = useForm<TransactionFormValues>({
    resolver: zodResolver(transactionFormSchema),
    defaultValues: transactionEditDefaults(transaction),
  });
  const {
    register,
    watch,
    setValue,
    handleSubmit,
    reset,
    formState: { errors },
  } = form;
  const kind = watch("kind");
  const canWrite = writable && !baseline.transferId;
  useEffect(() => {
    onLock(busy || uncertain);
  }, [busy, uncertain, onLock]);
  useEffect(() => {
    if (open && uncertain)
      document.getElementById("retry-transaction-editor")?.focus();
  }, [open, uncertain]);
  const execute = async (
    mode: "edit" | "delete",
    values?: TransactionFormValues,
  ) => {
    if (inFlight.current || conflict || !canWrite) return;
    if (!attempt.current) {
      if (mode === "edit" && !values) return;
      const deleteRequest =
        mode === "delete" ? prepareTransactionUndo(ledgerId, baseline) : null;
      attempt.current =
        mode === "delete"
          ? async () => {
              await deleteRequest?.();
              return undefined;
            }
          : prepareTransactionEdit(
              ledgerId,
              baseline,
              transactionBody(values as TransactionFormValues),
            );
    }
    setOperation(mode);
    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      const saved = await attempt.current();
      attempt.current = null;
      setUncertain(false);
      onLock(false);
      if (mode === "delete") onDeleted(baseline);
      else if (saved) onSaved(saved);
    } catch (failure) {
      if (!(failure instanceof ApiError) || failure.status >= 500) {
        setUncertain(true);
        setError(
          "We couldn't confirm this action. Retry to confirm the same request.",
        );
      } else {
        attempt.current = null;
        setUncertain(false);
        setConflict(failure.status === 409 || failure.status === 404);
        setError(
          failure.status === 409
            ? "This entry or its choices changed. Reload the latest details before trying again. Reloading replaces this form."
            : failure.message,
        );
      }
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };
  const reload = async () => {
    setBusy(true);
    try {
      const latest = await getTransaction(ledgerId, baseline.id);
      await Promise.all([
        client.invalidateQueries({ queryKey: ["accounts", ledgerId] }),
        client.invalidateQueries({ queryKey: ["categories", ledgerId] }),
        client.invalidateQueries({ queryKey: ["home", ledgerId] }),
      ]);
      setBaseline(latest);
      reset(transactionEditDefaults(latest));
      attempt.current = null;
      setConflict(false);
      setConfirmDelete(false);
      setError("");
    } catch (failure) {
      setError(
        failure instanceof ApiError && failure.status === 404
          ? "This entry is no longer available. Close this dialog and refresh the list."
          : "Couldn't reload this entry. Try again.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <EditorDialog
      open={open}
      title={canWrite ? "Edit transaction" : "Transaction details"}
      description="Correct the entry using its latest saved version."
      busy={busy}
      onDismiss={onDismiss}
      returnFocusId={`transaction-${baseline.id}`}
      fallbackFocusId="main-content"
      closeLabel="Close transaction editor"
      contentClassName="transaction-dialog"
      initialFocusId={
        uncertain ? "retry-transaction-editor" : "edit-transaction-amount"
      }
    >
      {baseline.transferId && (
        <p className="form-help">Transfer entries must be changed together.</p>
      )}
      <form
        noValidate
        onSubmit={handleSubmit((values) => execute("edit", values))}
      >
        <fieldset
          className="account-fields"
          disabled={!canWrite || busy || uncertain || conflict || confirmDelete}
        >
          <label htmlFor="edit-transaction-kind">Entry type</label>
          <NativeSelect
            id="edit-transaction-kind"
            value={kind}
            onChange={(event) => {
              setValue("kind", event.target.value as "expense" | "income");
              setValue("categoryId", "");
              setValue(
                "splits",
                watch("splits")?.map((line) => ({
                  ...line,
                  id: undefined,
                  categoryId: "",
                })),
              );
            }}
          >
            <option value="expense">Expense</option>
            <option value="income">Income</option>
          </NativeSelect>
          <label htmlFor="edit-transaction-amount">Amount (USD)</label>
          <input
            id="edit-transaction-amount"
            type={privateMode ? "password" : "text"}
            inputMode="decimal"
            autoComplete="off"
            aria-invalid={!!errors.amount}
            {...register("amount")}
          />
          {errors.amount && (
            <p className="field-error">{errors.amount.message}</p>
          )}
          <p className="form-help">
            Enter a positive amount; the entry type sets its direction.
          </p>
          <SplitFields form={form} categories={categories} kind={kind} />
          {!watch("splitEnabled") && (
            <CategoryPicker
              categories={categories}
              kind={kind}
              value={watch("categoryId")}
              onChange={(id) => setValue("categoryId", id ?? "")}
            />
          )}
          {errors.categoryId && (
            <p className="field-error">Choose a category.</p>
          )}
          <label htmlFor="edit-transaction-account">Account</label>
          <NativeSelect
            id="edit-transaction-account"
            {...register("accountId")}
          >
            <option value="" disabled>
              Choose an account
            </option>
            {accounts
              .filter((row) => !row.archivedAt || row.id === baseline.accountId)
              .map((row) => (
                <option key={row.id} value={row.id} disabled={!!row.archivedAt}>
                  {row.name}
                  {row.archivedAt ? " (archived)" : ""}
                </option>
              ))}
          </NativeSelect>
          {errors.accountId && (
            <p className="field-error">Choose an account.</p>
          )}
          <div className="transaction-context">
            <div>
              <label htmlFor="edit-transaction-date">Date</label>
              <DateTimeInput
                label="Date"
                required
                id="edit-transaction-date"
                type="date"
                min="0001-01-01"
                max="9999-12-31"
                {...register("date")}
              />
              {errors.date && (
                <p className="field-error">Choose a valid date.</p>
              )}
            </div>
            <div>
              <label htmlFor="edit-transaction-time">Time (optional)</label>
              <DateTimeInput
                label="Time (optional)"
                id="edit-transaction-time"
                type="time"
                step={60}
                {...register("time")}
              />
              {errors.time && (
                <p className="field-error">Choose a valid time.</p>
              )}
            </div>
          </div>
          <label htmlFor="edit-transaction-payee">
            {kind === "income" ? "Payer" : "Payee"}
          </label>
          <input
            id="edit-transaction-payee"
            maxLength={200}
            {...register("payee")}
          />
          <label htmlFor="edit-transaction-note">Note</label>
          <textarea
            id="edit-transaction-note"
            rows={2}
            maxLength={2000}
            {...register("note")}
          />
          <label htmlFor="edit-transaction-status">Status</label>
          <NativeSelect id="edit-transaction-status" {...register("status")}>
            <option value="cleared">Cleared</option>
            <option value="pending">Pending</option>
          </NativeSelect>
          <p className="form-help">
            Pending entries do not change your posted balance.
          </p>
        </fieldset>
        {error && (
          <p role="alert" className="field-error account-error">
            {error}
          </p>
        )}
        {confirmDelete && !uncertain && !conflict && (
          <p role="alert" className="account-error">
            Delete this entry? You can undo the deletion after it is confirmed.
          </p>
        )}
        <div className="account-dialog-actions transaction-editor-actions">
          <button
            type="button"
            className="secondary-button"
            disabled={busy}
            onClick={onDismiss}
          >
            {uncertain ? "Close for now" : "Close"}
          </button>
          {canWrite &&
            (uncertain ? (
              <Button
                id="retry-transaction-editor"
                type="button"
                disabled={busy}
                onClick={() => void execute(operation)}
              >
                Retry {operation === "delete" ? "delete" : "save"}
              </Button>
            ) : conflict ? (
              <Button
                type="button"
                disabled={busy}
                onClick={() => void reload()}
              >
                Reload latest details
              </Button>
            ) : confirmDelete ? (
              <>
                <button
                  type="button"
                  className="secondary-button"
                  disabled={busy}
                  onClick={() => setConfirmDelete(false)}
                >
                  Keep entry
                </button>
                <Button
                  type="button"
                  className="danger-action"
                  disabled={busy}
                  onClick={() => void execute("delete")}
                >
                  Confirm delete
                </Button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  className="secondary-button danger-action"
                  disabled={busy}
                  onClick={() => setConfirmDelete(true)}
                >
                  Delete transaction
                </button>
                <Button type="submit" disabled={busy}>
                  {busy ? "Saving…" : "Save changes"}
                </Button>
              </>
            ))}
        </div>
      </form>
    </EditorDialog>
  );
}
