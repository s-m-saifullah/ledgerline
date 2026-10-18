import type { ImportBatch } from "@ledgerline/shared";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { prepareUndoImport } from "./api";

/** Undo an import in two taps: the first says what will go, the second (red, a delete) does it. */
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
      <p role="status" className="muted">
        Removed {removed} {removed === 1 ? "entry" : "entries"}.
      </p>
    );
  if (!asking)
    return (
      <button
        type="button"
        className="secondary-button"
        disabled={batch.remaining === 0}
        onClick={() => setAsking(true)}
      >
        Undo this import
      </button>
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
  return (
    <fieldset className="import-undo">
      <legend className="sr-only">Confirm undo</legend>
      <p className="import-undo-text">
        This deletes the {batch.remaining}{" "}
        {batch.remaining === 1 ? "entry" : "entries"} from this import that{" "}
        {batch.remaining === 1 ? "is" : "are"} still in your ledger.
      </p>
      <div className="export-actions">
        <button
          type="button"
          className="button danger-action"
          disabled={busy}
          onClick={run}
        >
          {busy ? "Removing…" : "Delete these entries"}
        </button>
        <button
          type="button"
          className="secondary-button"
          disabled={busy}
          onClick={() => setAsking(false)}
        >
          Keep them
        </button>
      </div>
      {error && (
        <p role="alert" className="field-error">
          {error}
        </p>
      )}
    </fieldset>
  );
}
