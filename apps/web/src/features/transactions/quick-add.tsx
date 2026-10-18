import type { Category, Transaction } from "@ledgerline/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { EditorDialog } from "../../components/editor-dialog";
import { Toast } from "../../components/toast";
import { ApiError } from "../../lib/api";
import { getCategories } from "../categories/api";
import { getActiveAccounts, prepareTransactionUndo } from "./api";
import { TransferForm } from "./transfer-form";
import { useTransactionWorkspace } from "./workspace";

const uncertainFailure = (failure: unknown) =>
  !(failure instanceof ApiError) || failure.status >= 500;

import { QuickAddForm } from "./quick-add-form";
export function QuickAdd({
  actorId,
  ledgerId,
  writable,
  open,
  onDismiss,
  returnFocusId,
}: {
  actorId: string;
  ledgerId: string;
  writable: boolean;
  open: boolean;
  onDismiss: () => void;
  returnFocusId: string;
}) {
  const [mode, setMode] = useState<"entry" | "transfer">("entry");
  const workspace = useTransactionWorkspace();
  const externalBlocked = workspace?.editorLocked ?? false;
  const setQuickAddLocked = workspace?.setQuickAddLocked;
  const client = useQueryClient();
  const accounts = useQuery({
    queryKey: ["accounts", ledgerId, "quick-add"],
    queryFn: ({ signal }) => getActiveAccounts(ledgerId, signal),
    enabled: open,
    refetchOnMount: "always",
  });
  const categories = useQuery({
    queryKey: ["categories", ledgerId],
    queryFn: ({ signal }) => getCategories(ledgerId, signal),
    enabled: open,
    refetchOnMount: "always",
  });
  const [saved, setSaved] = useState<Transaction | null>(null);
  // A saved transfer that came with a bonus or fee entry: Undo removes them too.
  const [savedBonus, setSavedBonus] = useState(false);
  const [savedFee, setSavedFee] = useState(false);
  const [undoError, setUndoError] = useState("");
  const [undoBusy, setUndoBusy] = useState(false);
  const [formLocked, setFormLocked] = useState(false);
  const [undoUncertain, setUndoUncertain] = useState(false);
  useEffect(() => {
    setQuickAddLocked?.(formLocked || undoBusy || undoUncertain);
  }, [formLocked, undoBusy, undoUncertain, setQuickAddLocked]);
  const undoAttempt = useRef<(() => Promise<void>) | null>(null);
  const undoInFlight = useRef(false);
  const invalidate = () => {
    void client.invalidateQueries({ queryKey: ["accounts", ledgerId] });
    void client.invalidateQueries({ queryKey: ["transactions", ledgerId] });
    void client.invalidateQueries({ queryKey: ["home", ledgerId] });
  };
  const undo = async () => {
    if (
      !saved ||
      undoInFlight.current ||
      formLocked ||
      externalBlocked ||
      !writable
    )
      return;
    undoInFlight.current = true;
    setUndoBusy(true);
    setUndoError("");
    undoAttempt.current ??= prepareTransactionUndo(ledgerId, saved, {
      deleteBonus: savedBonus,
      deleteFee: savedFee,
    });
    try {
      await undoAttempt.current();
      setSaved(null);
      setUndoUncertain(false);
      undoAttempt.current = null;
      invalidate();
    } catch (failure) {
      if (uncertainFailure(failure)) {
        setUndoUncertain(true);
        setUndoError(
          "We couldn't confirm Undo. Retry to confirm the same action.",
        );
      } else {
        undoAttempt.current = null;
        setUndoUncertain(false);
        setUndoError(
          failure instanceof ApiError && failure.status === 409
            ? "This entry changed. Open its latest details before deleting it."
            : failure instanceof ApiError
              ? failure.message
              : "Couldn't undo this entry.",
        );
      }
    } finally {
      undoInFlight.current = false;
      setUndoBusy(false);
    }
  };
  const refreshed = async () => {
    await Promise.all([accounts.refetch(), categories.refetch()]);
  };
  const hasData = accounts.data && categories.data;
  const modeControl = (
    <fieldset
      className="balance-direction"
      disabled={formLocked || undoBusy || undoUncertain || externalBlocked}
    >
      <legend>Add mode</legend>
      <label>
        <input
          type="radio"
          name="add-mode"
          checked={mode === "entry"}
          onChange={() => setMode("entry")}
        />
        Income / expense
      </label>
      <label>
        <input
          type="radio"
          name="add-mode"
          checked={mode === "transfer"}
          onChange={() => setMode("transfer")}
        />
        Transfer
      </label>
    </fieldset>
  );
  return (
    <>
      {hasData && mode === "transfer" ? (
        <TransferForm
          actorId={actorId}
          ledgerId={ledgerId}
          accounts={accounts.data}
          categories={categories.data}
          open={open}
          writable={writable}
          blocked={undoBusy || undoUncertain || externalBlocked}
          onDismiss={onDismiss}
          onLock={setFormLocked}
          returnFocusId={returnFocusId}
          modeControl={modeControl}
          onSaved={(transaction, info) => {
            setSaved(transaction);
            setSavedBonus(!!info?.bonus);
            setSavedFee(!!info?.fee);
            setUndoError("");
            setUndoUncertain(false);
            undoAttempt.current = null;
            invalidate();
            onDismiss();
          }}
        />
      ) : hasData ? (
        <QuickAddForm
          modeControl={modeControl}
          returnFocusId={returnFocusId}
          actorId={actorId}
          ledgerId={ledgerId}
          accounts={accounts.data}
          categories={categories.data}
          open={open}
          writable={writable}
          blocked={undoBusy || undoUncertain || externalBlocked}
          onDismiss={onDismiss}
          onLock={setFormLocked}
          onRefresh={refreshed}
          onCategorySaved={(category) => {
            client.setQueryData<Category[]>(
              ["categories", ledgerId],
              (items) => [
                ...(items ?? []).filter((row) => row.id !== category.id),
                category,
              ],
            );
            void client.invalidateQueries({
              queryKey: ["categories", ledgerId],
            });
            void client.invalidateQueries({ queryKey: ["home", ledgerId] });
          }}
          onSaved={(transaction) => {
            setSaved(transaction);
            setSavedBonus(false);
            setSavedFee(false);
            setUndoError("");
            setUndoUncertain(false);
            undoAttempt.current = null;
            invalidate();
            onDismiss();
          }}
        />
      ) : (
        <EditorDialog
          open={open}
          title="Add transaction"
          description="Record money coming in or going out."
          busy={false}
          onDismiss={onDismiss}
          returnFocusId={returnFocusId}
          fallbackFocusId="main-content"
          closeLabel="Close transaction dialog"
        >
          {accounts.isError || categories.isError ? (
            <div className="account-error">
              <p role="alert">Couldn't load accounts and categories.</p>
              <button
                type="button"
                className="secondary-button"
                onClick={() => void refreshed()}
              >
                Try again
              </button>
            </div>
          ) : (
            <p role="status" className="account-error">
              Opening transaction entry…
            </p>
          )}
        </EditorDialog>
      )}
      {saved && (
        <Toast
          label="Transaction notification"
          durationMs={undoBusy || undoUncertain || undoError ? null : 5000}
          onExpire={() => {
            setSaved(null);
            undoAttempt.current = null;
          }}
        >
          <p role="status">
            {saved.transferId ? "Transfer" : "Transaction"} saved
            {saved.status === "pending" ? " as pending" : ""}.
          </p>
          {undoError && (
            <p role="alert" className="field-error">
              {undoError}
            </p>
          )}
          <button
            type="button"
            className="secondary-button"
            disabled={undoBusy || formLocked || externalBlocked || !writable}
            onClick={() => void undo()}
          >
            {undoBusy ? "Undoing…" : undoUncertain ? "Retry Undo" : "Undo"}
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label="Dismiss transaction notification"
            disabled={undoBusy || undoUncertain}
            onClick={() => {
              setSaved(null);
              setUndoError("");
              undoAttempt.current = null;
            }}
          >
            <X size={18} />
          </button>
        </Toast>
      )}
    </>
  );
}
