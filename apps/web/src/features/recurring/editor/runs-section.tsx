import type { RecurringRun } from "@ledgerline/shared";
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
    <section className="recurring-runs" aria-label="What it has done">
      <h3>What it has done</h3>
      {runs.isError ? (
        <p className="muted">Couldn't load the history.</p>
      ) : !runs.data ? (
        <p className="muted">Loading…</p>
      ) : runs.data.length === 0 ? (
        <p className="muted">Nothing yet.</p>
      ) : (
        <ul>
          {runs.data.map((item, index) => (
            <li key={item.id}>
              <span>
                <strong>{formatDate(item.date)}</strong>{" "}
                {item.status === "created"
                  ? "Created"
                  : item.status === "skipped"
                    ? "Skipped"
                    : "Needs attention"}
                {item.reason && <span className="muted"> · {item.reason}</span>}
              </span>
              {item.status === "attention" && (
                <button
                  type="button"
                  className="secondary-button"
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
    </section>
  );
}
