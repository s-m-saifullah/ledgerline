import { Link } from "@tanstack/react-router";
import { UndoImport } from "./undo-import";
import type { Wizard } from "./wizard";

export function DoneStep({ w }: { w: Wizard }) {
  const result = w.result;
  if (!result || !w.ledgerId) return null;
  const count = result.batch.rowCount;
  return (
    <section className="settings-card" aria-labelledby="import-done-title">
      <h2 id="import-done-title">
        Imported {count} {count === 1 ? "entry" : "entries"}
      </h2>
      <p className="muted" role="status">
        They are in {w.account?.name ?? "your account"}.
        {result.duplicatesIncluded > 0 &&
          ` ${result.duplicatesIncluded} of them looked like entries you already had, and you chose to include them.`}
        {result.tagsCreated > 0 &&
          ` ${result.tagsCreated} new ${result.tagsCreated === 1 ? "tag was" : "tags were"} created.`}
      </p>
      <div className="export-actions">
        <Link
          to="/transactions"
          search={{
            accountId: result.batch.accountId,
            from: result.from,
            to: result.to,
          }}
          className="button"
        >
          View in Transactions
        </Link>
        <button type="button" className="secondary-button" onClick={w.reset}>
          Import another file
        </button>
      </div>
      <UndoImport ledgerId={w.ledgerId} batch={result.batch} />
    </section>
  );
}
