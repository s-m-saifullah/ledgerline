import { RowBody, SectionLabel } from "@ledgerline/ui";
import { ChevronRight } from "lucide-react";
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
  const shortDate = (date: string | undefined) =>
    date
      ? new Date(`${date}T00:00:00`).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
        })
      : "";
  const title = (line: number) => {
    const entry = byLine.get(line);
    return entry?.payee || `Line ${line}`;
  };
  const counts: [number, string][] = [
    [readyRows.length, "Ready"],
    [
      duplicates.length,
      duplicates.length === 1 ? "Possible duplicate" : "Possible duplicates",
    ],
    [problems.length, "Can't be imported"],
  ];
  return (
    <>
      {w.preview.failed ? (
        <div className="ui-card imp-body" aria-live="polite">
          <p role="alert" className="field-error">
            We couldn't check the rows. Nothing has been imported.
          </p>
          <div className="imp-wrap">
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
        <div className="imp-counts" aria-live="polite">
          {counts.map(([figure, text]) => (
            <div key={text} className="ui-card imp-count">
              <span className="imp-count-figure">{figure}</span>
              <span className="imp-count-label">{text}</span>
            </div>
          ))}
        </div>
      )}
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
              <div className="ui-card ui-list">
                <div className="ui-row ui-row-static">
                  <RowBody
                    title={w.preview.data.newTags.join(", ")}
                    hint="Created when you import"
                  />
                </div>
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
              <div className="ui-card ui-list">
                {duplicates.map((item) => (
                  <label key={item.line} className="ui-row imp-dup">
                    <input
                      type="checkbox"
                      checked={w.included.has(item.line)}
                      onChange={() => w.toggleDuplicate(item.line)}
                    />
                    <span className="ui-row-main">
                      <span className="ui-row-title">{title(item.line)}</span>
                      <span className="ui-row-hint" title={item.reason ?? ""}>
                        Line {item.line} ·{" "}
                        {shortDate(byLine.get(item.line)?.date)} · Looks like an
                        entry you already have
                      </span>
                    </span>
                    <span className="ui-row-end">
                      <Amount cents={signed(item.line)} currency={currency} />
                    </span>
                  </label>
                ))}
              </div>
              <div className="imp-wrap">
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
              <div className="ui-card ui-list">
                {[...problems, ...skipped].map((item, at) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: a line can appear as a problem and a skip
                  <div key={at} className="ui-row ui-row-static">
                    <RowBody title={`Line ${item.line}`} hint={item.reason} />
                  </div>
                ))}
              </div>
            </section>
          )}
          {readyRows.length > 0 && (
            <details className="ui-card ui-list imp-details">
              <summary className="ui-row">
                <span className="ui-row-main">
                  <span className="ui-row-title">
                    Show the {readyRows.length} ready{" "}
                    {readyRows.length === 1 ? "row" : "rows"}
                  </span>
                </span>
                <span className="ui-row-chevron" aria-hidden="true">
                  <ChevronRight size={18} />
                </span>
              </summary>
              {readyRows.slice(0, 100).map((item) => (
                <div key={item.line} className="ui-row ui-row-static">
                  <RowBody
                    title={title(item.line)}
                    hint={[
                      shortDate(byLine.get(item.line)?.date),
                      categoryName(byLine.get(item.line)?.categoryId ?? ""),
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                    value={
                      <Amount cents={signed(item.line)} currency={currency} />
                    }
                  />
                </div>
              ))}
              {readyRows.length > 100 && (
                <p className="ui-row ui-row-static imp-note">
                  Showing the first 100 of {readyRows.length}.
                </p>
              )}
            </details>
          )}
        </>
      )}
      {w.confirmError && (
        <p role="alert" className="field-error">
          {w.confirmError}
        </p>
      )}
      <div className="imp-next">
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
    </>
  );
}
