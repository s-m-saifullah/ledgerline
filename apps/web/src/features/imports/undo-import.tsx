import type { ImportBatch } from "@ledgerline/shared";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Overlay } from "../../components/overlay";
import { prepareUndoImport } from "./api";

/** Undo an import in two steps: the button asks in a centred question that says what will go; its red button does it. */
export function UndoImport({
  ledgerId,
  batch,
  onUndone,
}: {
  ledgerId: string;
  batch: ImportBatch;
  onUndone?: (removed: number) => void;
}) {
  const client = useQueryClient();
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [removed, setRemoved] = useState<number | null>(null);
  if (removed !== null)
    return (
      <p role="status" className="imp-note">
        Removed {removed} {removed === 1 ? "entry" : "entries"}.
      </p>
    );
  const run = async () => {
    setBusy(true);
    setError("");
    try {
      const done = await prepareUndoImport(ledgerId, batch)();
      setRemoved(done.removed);
      for (const name of [
        "transactions",
        "accounts",
        "home",
        "reports",
        "budgets",
        "imports",
      ])
        void client.invalidateQueries({ queryKey: [name] });
      onUndone?.(done.removed);
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
  const opener = `undo-import-${batch.id}`;
  return (
    <>
      <button
        id={opener}
        type="button"
        className="ui-btn ui-btn-secondary"
        disabled={batch.remaining === 0}
        onClick={() => setAsking(true)}
      >
        Undo this import
      </button>
      <Overlay
        kind="question"
        open={asking}
        title="Undo this import?"
        busy={busy}
        onDismiss={() => {
          setAsking(false);
          setError("");
        }}
        cancelLabel="Keep them"
        returnFocusId={opener}
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
    </>
  );
}
