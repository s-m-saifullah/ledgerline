import type { Transaction } from "@ledgerline/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useRef,
  useState,
} from "react";
import { EditorDialog } from "../../components/editor-dialog";
import { Toast } from "../../components/toast";
import { ApiError } from "../../lib/api";
import { getCategories } from "../categories/api";
import { CategoryMergeWorkspace } from "../categories/merge-workspace";
import { PeopleWorkspace } from "../people/workspace";
import {
  getAllAccounts,
  getTransaction,
  prepareTransactionRestore,
} from "./api";
import { TransactionEditor } from "./editor";
import { TransferForm } from "./transfer-form";
import { getTransfer } from "./transfers";

type Workspace = {
  blocked: boolean;
  editorLocked: boolean;
  setQuickAddLocked: (value: boolean) => void;
  openTransaction: (row: Transaction) => void;
};
const TransactionContext = createContext<Workspace | null>(null);
export const useTransactionWorkspace = () => useContext(TransactionContext);

export function TransactionWorkspace({
  ledgerId,
  actorId,
  writable,
  children,
}: {
  ledgerId: string | undefined;
  actorId?: string | undefined;
  writable: boolean;
  children: ReactNode;
}) {
  const client = useQueryClient();
  const [selectionSequence, setSelectionSequence] = useState(0);
  const [selected, setSelected] = useState<Transaction | null>(null);
  const [open, setOpen] = useState(false);
  const [peopleLocked, setPeopleLocked] = useState(false);
  const [mergeLocked, setMergeLocked] = useState(false);
  const [editorLocked, setEditorLocked] = useState(false);
  const [quickAddLocked, setQuickAddLocked] = useState(false);
  const [deleted, setDeleted] = useState<Transaction | null>(null);
  const [notice, setNotice] = useState("");
  // The toast closes itself; a deletion stays undoable from a small pill until used or replaced.
  const [dismissedId, setDismissedId] = useState<string | null>(null);
  const toastId = deleted?.id ?? notice;
  const [undoError, setUndoError] = useState("");
  const [undoBusy, setUndoBusy] = useState(false);
  const [undoUncertain, setUndoUncertain] = useState(false);
  const attempt = useRef<(() => Promise<Transaction>) | null>(null);
  const inFlight = useRef(false);
  const accounts = useQuery({
    queryKey: ["accounts", ledgerId, "history"],
    queryFn: ({ signal }) => getAllAccounts(ledgerId as string, signal),
    enabled: !!ledgerId && !!selected,
  });
  const categories = useQuery({
    queryKey: ["categories", ledgerId],
    queryFn: ({ signal }) => getCategories(ledgerId as string, signal),
    enabled: !!ledgerId && !!selected,
  });
  const detail = useQuery({
    queryKey: [
      "transactions",
      ledgerId,
      "detail",
      selected?.id,
      selectionSequence,
    ],
    queryFn: () => getTransaction(ledgerId as string, selected?.id as string),
    enabled: !!ledgerId && !!selected,
    staleTime: 0,
  });
  const transfer = useQuery({
    queryKey: [
      "transactions",
      ledgerId,
      "transfer",
      selected?.transferId,
      selectionSequence,
    ],
    queryFn: () =>
      getTransfer(ledgerId as string, selected?.transferId as string),
    enabled: !!ledgerId && !!selected?.transferId,
    staleTime: 0,
  });
  const invalidate = useCallback(() => {
    void client.invalidateQueries({ queryKey: ["accounts", ledgerId] });
    void client.invalidateQueries({ queryKey: ["transactions", ledgerId] });
    void client.invalidateQueries({ queryKey: ["home", ledgerId] });
  }, [client, ledgerId]);
  const undo = async () => {
    if (
      !deleted ||
      !ledgerId ||
      !writable ||
      inFlight.current ||
      quickAddLocked ||
      peopleLocked ||
      mergeLocked ||
      editorLocked
    )
      return;
    inFlight.current = true;
    setUndoBusy(true);
    setUndoError("");
    attempt.current ??= prepareTransactionRestore(ledgerId, deleted);
    try {
      await attempt.current();
      attempt.current = null;
      setDeleted(null);
      setDismissedId(null);
      setUndoUncertain(false);
      setNotice("Deletion undone.");
      invalidate();
    } catch (failure) {
      const unknown = !(failure instanceof ApiError) || failure.status >= 500;
      setUndoUncertain(unknown);
      if (!unknown) attempt.current = null;
      setUndoError(
        unknown
          ? "We couldn't confirm Undo. Retry to confirm the same action."
          : failure instanceof ApiError
            ? failure.message
            : "Couldn't undo deletion.",
      );
    } finally {
      inFlight.current = false;
      setUndoBusy(false);
    }
  };
  const transactionBlocked =
    editorLocked || quickAddLocked || undoBusy || undoUncertain;
  const otherBlocked = transactionBlocked || mergeLocked;
  const blocked = otherBlocked || peopleLocked;
  const dismiss = () => {
    setOpen(false);
    if (!editorLocked) setSelected(null);
  };
  const linkedOpened = useCallback(() => {
    setSelected(null);
    setOpen(false);
  }, []);
  return (
    <CategoryMergeWorkspace
      ledgerId={ledgerId}
      writable={writable}
      blocked={transactionBlocked || peopleLocked || open}
      onLock={setMergeLocked}
    >
      <PeopleWorkspace
        ledgerId={ledgerId}
        actorId={actorId}
        writable={writable}
        blocked={otherBlocked || (open && !selected?.receivableId)}
        onLock={setPeopleLocked}
        linkedTransaction={selected?.receivableId ? selected : null}
        onLinkedOpened={linkedOpened}
      >
        <TransactionContext
          value={{
            blocked,
            editorLocked:
              editorLocked ||
              undoBusy ||
              undoUncertain ||
              open ||
              peopleLocked ||
              mergeLocked,
            setQuickAddLocked,
            openTransaction: (row) => {
              if (blocked) return;
              setSelectionSequence((sequence) => sequence + 1);
              setSelected(row);
              setOpen(true);
              setNotice("");
            },
          }}
        >
          {children}
          {editorLocked && !open && (
            <div className="transaction-toast">
              <p role="status">A transaction action needs confirmation.</p>
              <button
                type="button"
                className="secondary-button"
                onClick={() => setOpen(true)}
              >
                Resume transaction
              </button>
            </div>
          )}
          {selected &&
            !selected.receivableId &&
            ledgerId &&
            (selected.transferId && transfer.data && accounts.data ? (
              <TransferForm
                key={selected.id}
                ledgerId={ledgerId}
                transfer={transfer.data}
                accounts={accounts.data}
                writable={writable}
                open={open}
                onDismiss={dismiss}
                onLock={setEditorLocked}
                returnFocusId={`transaction-${selected.id}`}
                onSaved={() => {
                  setOpen(false);
                  setSelected(null);
                  setEditorLocked(false);
                  setNotice("Transfer updated.");
                  invalidate();
                }}
                onDeleted={(row) => {
                  setOpen(false);
                  setSelected(null);
                  setEditorLocked(false);
                  setDeleted(row);
                  setDismissedId(null);
                  setNotice("");
                  setUndoError("");
                  attempt.current = null;
                  invalidate();
                }}
              />
            ) : !selected.transferId &&
              detail.data &&
              accounts.data &&
              categories.data ? (
              <TransactionEditor
                key={selected.id}
                ledgerId={ledgerId}
                transaction={detail.data}
                accounts={accounts.data}
                categories={categories.data}
                writable={writable}
                open={open}
                onDismiss={dismiss}
                onLock={setEditorLocked}
                onSaved={() => {
                  setOpen(false);
                  setSelected(null);
                  setEditorLocked(false);
                  setNotice("Transaction updated.");
                  invalidate();
                }}
                onDeleted={(row) => {
                  setOpen(false);
                  setSelected(null);
                  setEditorLocked(false);
                  setDeleted(row);
                  setDismissedId(null);
                  setNotice("");
                  setUndoError("");
                  attempt.current = null;
                  invalidate();
                }}
              />
            ) : (
              <EditorDialog
                open={open}
                title="Transaction details"
                description="Load the latest entry and its historical labels."
                busy={false}
                onDismiss={dismiss}
                returnFocusId={`transaction-${selected.id}`}
                fallbackFocusId="main-content"
                closeLabel="Close transaction editor"
              >
                <p
                  role={
                    detail.isError ||
                    transfer.isError ||
                    accounts.isError ||
                    categories.isError
                      ? "alert"
                      : "status"
                  }
                >
                  {detail.isError ||
                  transfer.isError ||
                  accounts.isError ||
                  categories.isError
                    ? "Couldn't load this entry. It may no longer be available."
                    : "Loading entry…"}
                </p>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => {
                    void detail.refetch();
                    if (selected.transferId) void transfer.refetch();
                    void accounts.refetch();
                    void categories.refetch();
                  }}
                >
                  Try again
                </button>
              </EditorDialog>
            ))}
          {deleted && dismissedId === toastId && (
            <button
              type="button"
              className="undo-pill"
              disabled={
                undoBusy ||
                quickAddLocked ||
                editorLocked ||
                peopleLocked ||
                mergeLocked ||
                !writable
              }
              onClick={() => void undo()}
            >
              Undo last deletion
            </button>
          )}
          {(deleted || notice) && dismissedId !== toastId && (
            <Toast
              label="Transaction history notification"
              durationMs={
                undoBusy || undoUncertain || undoError
                  ? null
                  : deleted
                    ? 5000
                    : 3000
              }
              onExpire={() => {
                if (deleted) setDismissedId(toastId);
                else setNotice("");
              }}
            >
              <p role="status">
                {deleted
                  ? deleted.transferId
                    ? "Transfer deleted."
                    : "Transaction deleted."
                  : notice}
              </p>
              {undoError && (
                <p role="alert" className="field-error">
                  {undoError}
                </p>
              )}
              {deleted && (
                <button
                  type="button"
                  className="secondary-button"
                  disabled={
                    undoBusy ||
                    quickAddLocked ||
                    editorLocked ||
                    peopleLocked ||
                    mergeLocked ||
                    !writable
                  }
                  onClick={() => void undo()}
                >
                  {undoBusy
                    ? "Undoing…"
                    : undoUncertain
                      ? "Retry deletion Undo"
                      : "Undo deletion"}
                </button>
              )}
              <button
                type="button"
                className="secondary-button"
                disabled={undoBusy || undoUncertain}
                onClick={() => {
                  setDeleted(null);
                  setNotice("");
                  setUndoError("");
                  attempt.current = null;
                }}
              >
                Dismiss
              </button>
            </Toast>
          )}
        </TransactionContext>
      </PeopleWorkspace>
    </CategoryMergeWorkspace>
  );
}
