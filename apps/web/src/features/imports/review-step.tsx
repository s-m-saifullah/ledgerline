import { Amount } from "../../components/amount-text";
import type { Wizard } from "./wizard";

export function ReviewStep({ w }: { w: Wizard }) {
  const currency = w.account?.currency ?? "USD";
  const byLine = new Map(w.ready.map((row) => [row.line, row]));
  const names = new Map(w.categories.map((c) => [c.id, c]));
  const categoryName = (id: string) => {
    const category = names.get(id);
    const parent = category?.parentId
      ? names.get(category.parentId)
      : undefined;
    return category
      ? `${parent ? `${parent.name} / ` : ""}${category.name}`
      : "";
  };
  const signed = (line: number) => {
    const row = byLine.get(line);
    return row ? (row.kind === "expense" ? -row.amount : row.amount) : 0;
  };
  const rows = w.preview.data?.rows ?? [];
  const duplicates = rows.filter((row) => row.state === "duplicate");
  const serverProblems = rows.filter((row) => row.state === "problem");
  const problems = [
    ...(w.parsed?.problems ?? []),
    ...serverProblems.map((p) => ({ line: p.line, reason: p.reason ?? "" })),
  ];
  const readyRows = w.ready.filter(
    (row) =>
      w.preview.data?.rows.find((r) => r.line === row.line)?.state === "ready",
  );
  const skipped = w.parsed?.skipped ?? [];
  const count = w.toImport.length;
  const row = (line: number) => {
    const entry = byLine.get(line);
    return (
      <>
        <span>
          Line {line} · {entry?.date}
          {entry?.payee ? ` · ${entry.payee}` : ""}
        </span>
        <Amount cents={signed(line)} currency={currency} />
        <span className="muted import-row-wide">
          {entry ? categoryName(entry.categoryId) : ""}
        </span>
      </>
    );
  };
  return (
    <>
      <section
        className="settings-card"
        aria-labelledby="import-review-title"
        aria-live="polite"
      >
        <h2 id="import-review-title">Review before importing</h2>
        {w.preview.failed ? (
          <>
            <p role="alert" className="field-error">
              We couldn't check the rows. Nothing has been imported.
            </p>
            <button
              type="button"
              className="secondary-button"
              onClick={w.preview.retry}
            >
              Try again
            </button>
          </>
        ) : w.preview.loading || !w.preview.data ? (
          <p className="muted" role="status">
            Checking your rows…
          </p>
        ) : (
          <div className="import-counts">
            <p className="import-counts-item">
              <strong>{readyRows.length}</strong> ready
            </p>
            <p className="import-counts-item">
              <strong>{duplicates.length}</strong> possible{" "}
              {duplicates.length === 1 ? "duplicate" : "duplicates"}
            </p>
            <p className="import-counts-item">
              <strong>{problems.length}</strong> can't be imported
            </p>
          </div>
        )}
      </section>
      {w.preview.data && (
        <>
          {w.preview.data.newTags.length > 0 && (
            <section
              className="settings-card"
              aria-labelledby="import-tags-title"
            >
              <h2 id="import-tags-title">New tags</h2>
              <p className="muted">
                These tags in the file don't exist yet. Importing creates them
                (you can delete unused ones later under More, Tags):{" "}
                {w.preview.data.newTags.join(", ")}.
              </p>
            </section>
          )}
          {duplicates.length > 0 && (
            <section
              className="settings-card"
              aria-labelledby="import-dupes-title"
            >
              <h2 id="import-dupes-title">Possible duplicates</h2>
              <p className="muted">
                These look like entries already in this account. They are left
                out unless you tick them.
              </p>
              <div className="export-actions">
                <button
                  type="button"
                  className="quiet-button"
                  onClick={() => w.setAllDuplicates(true)}
                >
                  Include all
                </button>
                <button
                  type="button"
                  className="quiet-button"
                  onClick={() => w.setAllDuplicates(false)}
                >
                  Include none
                </button>
              </div>
              <ul className="import-rows">
                {duplicates.map((item) => (
                  <li key={item.line}>
                    <label className="budget-rollover amount-entry-toggle">
                      <input
                        type="checkbox"
                        checked={w.included.has(item.line)}
                        onChange={() => w.toggleDuplicate(item.line)}
                      />
                      <span className="check-text import-row import-row-field">
                        {row(item.line)}
                        <span className="muted import-hint import-row-wide">
                          {item.reason}
                        </span>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {(problems.length > 0 || skipped.length > 0) && (
            <section
              className="settings-card"
              aria-labelledby="import-left-title"
            >
              <h2 id="import-left-title">Left out</h2>
              <ul className="import-problems">
                {problems.map((item) => (
                  <li key={`p${item.line}`}>
                    Line {item.line}: {item.reason}
                  </li>
                ))}
                {skipped.map((item) => (
                  <li key={`s${item.line}`}>
                    Line {item.line}: {item.reason}
                  </li>
                ))}
              </ul>
            </section>
          )}
          {readyRows.length > 0 && (
            <details className="settings-card import-ready">
              <summary>
                Show the {readyRows.length} ready{" "}
                {readyRows.length === 1 ? "row" : "rows"}
              </summary>
              <ul className="import-rows">
                {readyRows.slice(0, 100).map((item) => (
                  <li key={item.line} className="import-row">
                    {row(item.line)}
                  </li>
                ))}
              </ul>
              {readyRows.length > 100 && (
                <p className="muted">
                  Showing the first 100 of {readyRows.length}.
                </p>
              )}
            </details>
          )}
        </>
      )}
      <section className="settings-card">
        {w.confirmError && (
          <p role="alert" className="field-error">
            {w.confirmError}
          </p>
        )}
        <div className="export-actions">
          <button
            type="button"
            className="secondary-button"
            disabled={w.confirming}
            onClick={() =>
              w.go(
                w.unresolved.length ||
                  w.needs.wordings.some((x) => !x.match) ||
                  w.needs.blank.expense + w.needs.blank.income > 0
                  ? "categories"
                  : "columns",
              )
            }
          >
            Back
          </button>
          <button
            type="button"
            className="button"
            disabled={w.confirming || count === 0 || !w.preview.data}
            onClick={() => void w.confirm()}
          >
            {w.confirming
              ? "Importing…"
              : `Import ${count} ${count === 1 ? "entry" : "entries"}`}
          </button>
        </div>
      </section>
    </>
  );
}
