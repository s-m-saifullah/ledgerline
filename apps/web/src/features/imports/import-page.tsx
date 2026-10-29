import { useEffect, useRef } from "react";
import { CategoriesStep } from "./categories-step";
import { ColumnsStep } from "./columns-step";
import { DoneStep } from "./done-step";
import { FileStep } from "./file-step";
import { ReviewStep } from "./review-step";
import { useImportWizard } from "./use-wizard";
import type { Step } from "./wizard";

const LABELS: [Step, string][] = [
  ["file", "File"],
  ["columns", "Columns"],
  ["categories", "Categories"],
  ["review", "Review"],
];

export function ImportPage() {
  const w = useImportWizard();
  const heading = useRef<HTMLHeadingElement>(null);
  const first = useRef(true);
  // Move focus to the page heading when the step changes, not when the page opens.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when the step changes
  useEffect(() => {
    if (first.current) first.current = false;
    else heading.current?.focus();
  }, [w.step]);
  const position = LABELS.findIndex(([step]) => step === w.step);
  return (
    <>
      <div className="page-heading">
        <p className="eyebrow">BRING IN YOUR HISTORY</p>
        <h1 id="import-title" ref={heading} tabIndex={-1}>
          Import
        </h1>
        <p className="muted">
          Add entries from a bank statement or spreadsheet saved as CSV.
        </p>
      </div>
      {w.step !== "done" && (
        <ol className="import-steps" aria-label="Progress">
          {LABELS.map(([step, label], i) => (
            <li
              key={step}
              aria-current={step === w.step ? "step" : undefined}
              className={`import-step${step === w.step ? " current" : i < position ? " done" : ""}`}
            >
              {i + 1}. {label}
            </li>
          ))}
        </ol>
      )}
      {w.loadError ? (
        <p role="alert" className="account-error">
          Couldn't load your accounts and categories. Please try again.
        </p>
      ) : w.loading ? (
        <p className="muted" role="status">
          Loading…
        </p>
      ) : w.accounts.length === 0 ? (
        <p className="muted">Add an account first, then import into it.</p>
      ) : (
        <>
          {w.step === "file" && <FileStep w={w} />}
          {w.step === "columns" && <ColumnsStep w={w} />}
          {w.step === "categories" && <CategoriesStep w={w} />}
          {w.step === "review" && <ReviewStep w={w} />}
          {w.step === "done" && <DoneStep w={w} />}
        </>
      )}
    </>
  );
}
