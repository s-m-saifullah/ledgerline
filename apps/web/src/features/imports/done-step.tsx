import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { UndoQuestion } from "./undo-import";
import type { Wizard } from "./wizard";

export function DoneStep({ w }: { w: Wizard }) {
  const [asking, setAsking] = useState(false);
  const [removed, setRemoved] = useState<number | null>(null);
  const result = w.result;
  if (!result || !w.ledgerId) return null;
  const count = result.batch.rowCount;
  return (
    <section className="ui-card ui-list" aria-labelledby="import-done-title">
      <div className="ui-row ui-row-static">
        <h2 id="import-done-title" className="ui-row-main imp-card-title">
          Imported {count} {count === 1 ? "entry" : "entries"}
        </h2>
      </div>
      <div className="imp-body imp-top">
        <p className="imp-note" role="status">
          They are in {w.account?.name ?? "your account"}.
          {result.duplicatesIncluded > 0 &&
            ` ${result.duplicatesIncluded} of them looked like entries you already had, and you chose to include them.`}
          {result.tagsCreated > 0 &&
            ` ${result.tagsCreated} new ${result.tagsCreated === 1 ? "tag was" : "tags were"} created.`}
        </p>
        {removed !== null && (
          <p className="imp-note" role="status">
            Removed {removed} {removed === 1 ? "entry" : "entries"}.
          </p>
        )}
        <div className="imp-wrap">
          <Link
            to="/transactions"
            search={{
              accountId: result.batch.accountId,
              from: result.from,
              to: result.to,
            }}
            className="ui-btn ui-btn-primary"
          >
            View in Transactions
          </Link>
          <button
            type="button"
            className="ui-btn ui-btn-secondary"
            onClick={w.reset}
          >
            Import another file
          </button>
          {removed === null && (
            <button
              id="undo-import-done"
              type="button"
              className="ui-btn ui-btn-secondary ui-btn-danger"
              disabled={result.batch.remaining === 0}
              onClick={() => setAsking(true)}
            >
              Undo this import
            </button>
          )}
        </div>
      </div>
      <UndoQuestion
        ledgerId={w.ledgerId}
        batch={result.batch}
        open={asking}
        returnFocusId="undo-import-done"
        onClose={() => setAsking(false)}
        onUndone={setRemoved}
      />
    </section>
  );
}
