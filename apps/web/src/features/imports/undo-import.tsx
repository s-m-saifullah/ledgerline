import type { ImportBatch } from "@ledgerline/shared";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Overlay } from "../../components/overlay";
import { prepareUndoImport } from "./api";

/**
 * Undoing an import asks first, in a centred question that says what will go; its red button does it. Whoever
 * opens it (a recent import's row, or the Done card's button) says when it is open and what to do afterwards.
 */
export function UndoQuestion({
  ledgerId,
  batch,
  open,
  returnFocusId,
  onClose,
  onUndone,
}: {
  ledgerId: string;
  batch: ImportBatch;
  open: boolean;
  returnFocusId: string;
  onClose: () => void;
  onUndone: (removed: number) => void;
}) {
  const client = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const run = async () => {
    setBusy(true);
    setError("");
    try {
      const done = await prepareUndoImport(ledgerId, batch)();
      for (const name of [
        "transactions",
        "accounts",
        "home",
        "reports",
        "budgets",
        "imports",
      ])
        void client.invalidateQueries({ queryKey: [name] });
      onUndone(done.removed);
      onClose();
    } catch (failure) {
      setError(
        failure instanceof Error && failure.message
          ? failure.message
          : "We couldn't undo the import. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <Overlay
      kind="question"
      open={open}
      title="Undo this import?"
      busy={busy}
      onDismiss={() => {
        setError("");
        onClose();
      }}
      cancelLabel="Keep them"
      returnFocusId={returnFocusId}
      fallbackFocusId="main-content"
      footer={
        <button
          type="button"
          className="ui-btn ui-btn-danger-filled"
          disabled={busy}
          onClick={run}
        >
          {busy ? "Removing…" : "Delete these entries"}
        </button>
      }
    >
      <p>
        This deletes the {batch.remaining}{" "}
        {batch.remaining === 1 ? "entry" : "entries"} from this import that{" "}
        {batch.remaining === 1 ? "is" : "are"} still in your ledger.
      </p>
      {error && (
        <p role="alert" className="field-error">
          {error}
        </p>
      )}
    </Overlay>
  );
}
