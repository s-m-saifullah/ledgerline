import type { RecurringRun } from "@ledgerline/shared";
import { ChevronDown } from "lucide-react";
import { formatDate } from "../schedule";

/** What a rule has done so far, with a way to skip an occurrence that needs attention. */
export function RunsSection({
  runs,
  busy,
  onSkip,
}: {
  runs: { data: RecurringRun[] | undefined; isError: boolean };
  busy: boolean;
  onSkip: (index: number) => void;
}) {
  return (
    <details className="ui-card rc-fold">
      <summary>
        <span>What it has done</span>
        <ChevronDown size={18} aria-hidden="true" />
      </summary>
      <div className="rc-fold-body">
        {runs.isError ? (
          <p className="rc-quiet">Couldn't load the history.</p>
        ) : !runs.data ? (
          <p className="rc-quiet">Loading…</p>
        ) : runs.data.length === 0 ? (
          <p className="rc-quiet">Nothing yet.</p>
        ) : (
          <ul className="rc-runs">
            {runs.data.map((item, index) => (
              <li key={item.id}>
                <span className="rc-run-text">
                  <strong>{formatDate(item.date)}</strong>{" "}
                  {item.status === "created"
                    ? "Created"
                    : item.status === "skipped"
                      ? "Skipped"
                      : "Needs attention"}
                  {item.reason && (
                    <span className="muted"> · {item.reason}</span>
                  )}
                </span>
                {item.status === "attention" && (
                  <button
                    type="button"
                    className="ui-btn ui-btn-secondary"
                    disabled={busy}
                    onClick={() => onSkip(index)}
                  >
                    Skip this one
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </details>
  );
}
