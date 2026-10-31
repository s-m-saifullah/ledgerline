import { ListCard, ListRow, RowBody, SectionLabel } from "@ledgerline/ui";
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
  const label = (line: number) => {
    const entry = byLine.get(line);
    return `Line ${line} · ${entry?.date}${entry?.payee ? ` · ${entry.payee}` : ""}`;
  };
  return (
    <>
      <section
        className="imp-section"
        aria-labelledby="import-review-title"
        aria-live="polite"
      >
        <SectionLabel as="h2" id="import-review-title">
          Review before importing
        </SectionLabel>
        {w.preview.failed ? (
          <div className="imp-card">
            <p role="alert" className="imp-field field-error">
              We couldn't check the rows. Nothing has been imported.
            </p>
            <div className="imp-field">
              <button
                type="button"
                className="ui-btn ui-btn-secondary"
                onClick={w.preview.retry}
              >
                Try again
              </button>
            </div>
          </div>
        ) : w.preview.loading || !w.preview.data ? (
          <p className="imp-note" role="status">
            Checking your rows…
          </p>
        ) : (
          <ListCard className="imp-counts">
            <ListRow title="Ready" value={readyRows.length} />
            <ListRow title="Duplicates" value={duplicates.length} />
            <ListRow title="Can't be imported" value={problems.length} />
          </ListCard>
        )}
      </section>
      {w.preview.data && (
        <>
          {w.preview.data.newTags.length > 0 && (
            <section
              className="imp-section"
              aria-labelledby="import-tags-title"
            >
              <SectionLabel as="h2" id="import-tags-title">
                New tags
              </SectionLabel>
              <div className="imp-card">
                <p className="imp-field">{w.preview.data.newTags.join(", ")}</p>
                <p className="imp-hint">Created when you import.</p>
              </div>
            </section>
          )}
          {duplicates.length > 0 && (
            <section
              className="imp-section"
              aria-labelledby="import-dupes-title"
            >
              <SectionLabel as="h2" id="import-dupes-title">
                Possible duplicates
              </SectionLabel>
              <p className="imp-note">Left out unless you tick them.</p>
              <div className="imp-actions">
                <button
                  type="button"
                  className="ui-btn ui-btn-text"
                  onClick={() => w.setAllDuplicates(true)}
                >
                  Include all
                </button>
                <button
                  type="button"
                  className="ui-btn ui-btn-text"
                  onClick={() => w.setAllDuplicates(false)}
                >
                  Include none
                </button>
              </div>
              <ul className="ui-card ui-list imp-list">
                {duplicates.map((item) => (
                  <li key={item.line}>
                    <label className="ui-row imp-dup">
                      <input
                        type="checkbox"
                        checked={w.included.has(item.line)}
                        onChange={() => w.toggleDuplicate(item.line)}
                      />
                      <span className="ui-row-main">
                        <span className="ui-row-title">{label(item.line)}</span>
                        {item.reason && (
                          <span className="ui-row-hint" title={item.reason}>
                            {item.reason}
                          </span>
                        )}
                      </span>
                      <span className="ui-row-end">
                        <Amount cents={signed(item.line)} currency={currency} />
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {(problems.length > 0 || skipped.length > 0) && (
            <section
              className="imp-section"
              aria-labelledby="import-left-title"
            >
              <SectionLabel as="h2" id="import-left-title">
                Left out
              </SectionLabel>
              <ul className="ui-card ui-list imp-list imp-lines">
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
            <details className="imp-ready">
              <summary>
                Show the {readyRows.length} ready{" "}
                {readyRows.length === 1 ? "row" : "rows"}
              </summary>
              <ul className="ui-card ui-list imp-list">
                {readyRows.slice(0, 100).map((item) => (
                  <li key={item.line} className="ui-row ui-row-static">
                    <RowBody
                      title={label(item.line)}
                      hint={categoryName(
                        byLine.get(item.line)?.categoryId ?? "",
                      )}
                      value={
                        <Amount cents={signed(item.line)} currency={currency} />
                      }
                    />
                  </li>
                ))}
              </ul>
              {readyRows.length > 100 && (
                <p className="imp-note">
                  Showing the first 100 of {readyRows.length}.
                </p>
              )}
            </details>
          )}
        </>
      )}
      <section className="imp-section">
        {w.confirmError && (
          <p role="alert" className="field-error">
            {w.confirmError}
          </p>
        )}
        <div className="imp-actions">
          <button
            type="button"
            className="ui-btn ui-btn-secondary"
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
            className="ui-btn ui-btn-primary"
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
