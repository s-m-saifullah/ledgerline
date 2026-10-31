import { zodResolver } from "@hookform/resolvers/zod";
import type { Account, Category, Transaction } from "@ledgerline/shared";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { Overlay } from "../../components/overlay";
import { ApiError } from "../../lib/api";
import { useCategoryCreate } from "../categories/use-category-create";
import {
  getTransaction,
  prepareTransactionEdit,
  prepareTransactionUndo,
} from "./api";
import { changeKind, EntryFields } from "./entry-fields";
import { DeleteTrigger, TypePill } from "./entry-sheet";
import {
  type TransactionFormValues,
  transactionBody,
  transactionEditDefaults,
  transactionFormSchema,
} from "./form";

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
  const { watch, handleSubmit, reset } = form;
  const kind = watch("kind");
  const { create: categoryCreate, uncertain: categoryUncertain } =
    useCategoryCreate(ledgerId, kind);
  const canWrite = writable && !baseline.transferId;
  // A transfer's fee or bonus, or a payment's tip, keeps its kind and is never split (ADRs 0023, 0025, 0027).
  const linkedToTransfer =
    !!baseline.feeTransferId ||
    !!baseline.relatedTransferId ||
    !!baseline.tipPaymentId;
  useEffect(() => {
    onLock(busy || uncertain || categoryUncertain);
  }, [busy, uncertain, categoryUncertain, onLock]);
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
  const frozen = !canWrite || busy || uncertain || conflict;
  return (
    <>
      <Overlay
        open={open}
        title={canWrite ? "Edit transaction" : "Transaction details"}
        description="Correct the entry using its latest saved version."
        busy={busy}
        onDismiss={onDismiss}
        cancelLabel={uncertain ? "Close for now" : "Close"}
        returnFocusId={`transaction-${baseline.id}`}
        fallbackFocusId="main-content"
        initialFocusId={
          uncertain ? "retry-transaction-editor" : "edit-transaction-amount"
        }
        footer={
          canWrite ? (
            uncertain ? (
              <button
                id="retry-transaction-editor"
                type="button"
                className="ui-btn ui-btn-primary"
                disabled={busy}
                onClick={() => void execute(operation)}
              >
                Retry {operation === "delete" ? "delete" : "save"}
              </button>
            ) : conflict ? (
              <button
                type="button"
                className="ui-btn ui-btn-primary"
                disabled={busy}
                onClick={() => void reload()}
              >
                Reload latest details
              </button>
            ) : (
              <>
                <DeleteTrigger
                  id="delete-transaction"
                  label="Delete transaction"
                  disabled={busy}
                  onClick={() => setConfirmDelete(true)}
                />
                <button
                  type="submit"
                  form="edit-entry-form"
                  className="ui-btn ui-btn-primary"
                  disabled={busy || categoryUncertain}
                >
                  {busy ? "Saving…" : "Save changes"}
                </button>
              </>
            )
          ) : undefined
        }
      >
        <TypePill
          value={kind}
          withTransfer={false}
          disabled={linkedToTransfer || frozen || categoryUncertain}
          onChange={(type) => {
            if (type !== "transfer") changeKind(form, type);
          }}
        />
        {baseline.transferId && (
          <p className="form-help">
            Transfer entries must be changed together.
          </p>
        )}
        {baseline.tipPaymentId && (
          <p className="form-help">
            This is the tip that came with a payment. You can change its amount,
            category and date, but it stays one income entry. Deleting the
            payment deletes it too.
          </p>
        )}
        {baseline.feeTransferId && (
          <p className="form-help">
            This is a transfer's fee. You can change its amount, category and
            date, but it stays one expense.
          </p>
        )}
        <form
          id="edit-entry-form"
          noValidate
          className="entry-form"
          onSubmit={handleSubmit((values) => execute("edit", values))}
        >
          <fieldset className="entry-fields" disabled={frozen}>
            <EntryFields
              form={form}
              ledgerId={ledgerId}
              categories={categories}
              accounts={accounts}
              idPrefix="edit-transaction"
              frozen={frozen}
              ownAccountId={baseline.accountId}
              fallbackCurrency={baseline.amount.currency}
              accountError="Choose an account."
              savedRate={(currency) =>
                currency === baseline.amount.currency
                  ? baseline.fxRate
                  : undefined
              }
              linked={linkedToTransfer}
              categoryCreate={categoryCreate}
            />
          </fieldset>
          {error && (
            <p role="alert" className="field-error">
              {error}
            </p>
          )}
        </form>
      </Overlay>
      <Overlay
        kind="question"
        open={confirmDelete}
        title="Delete this entry?"
        busy={busy}
        onDismiss={() => setConfirmDelete(false)}
        cancelLabel="Keep entry"
        returnFocusId="delete-transaction"
        fallbackFocusId="main-content"
        footer={
          <button
            type="button"
            className="ui-btn ui-btn-danger-filled"
            disabled={busy}
            onClick={() => {
              setConfirmDelete(false);
              void execute("delete");
            }}
          >
            Confirm delete
          </button>
        }
      >
        <p>You can undo the deletion after it is confirmed.</p>
      </Overlay>
    </>
  );
}
