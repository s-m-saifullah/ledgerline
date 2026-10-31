import { SectionLabel, SwitchRow } from "@ledgerline/ui";
import { NativeSelect } from "../../components/native-select";
import {
  type AmountStyle,
  type DateFormat,
  type DecimalStyle,
  type ImportMapping,
  withColumn,
} from "./mapping";
import type { Wizard } from "./wizard";

const NONE = "";
type ColumnKey =
  | "date"
  | "time"
  | "amount"
  | "type"
  | "moneyIn"
  | "moneyOut"
  | "category"
  | "subcategory"
  | "payee"
  | "note"
  | "status"
  | "tags";

function ColumnSelect({
  w,
  name,
  label,
  required = false,
}: {
  w: Wizard;
  name: ColumnKey;
  label: string;
  required?: boolean;
}) {
  const table = w.file?.table ?? [];
  const width = Math.max(0, ...table.map((row) => row.length));
  const sample = table[w.mapping.hasHeader ? 1 : 0] ?? [];
  const title = (at: number) => {
    const header = w.mapping.hasHeader ? (table[0]?.[at] ?? "").trim() : "";
    const example = (sample[at] ?? "").trim().slice(0, 24);
    return `${header || `Column ${at + 1}`}${example ? ` (${example})` : ""}`;
  };
  const value = w.mapping[name];
  return (
    <div className="imp-field">
      <label className="imp-label" htmlFor={`map-${name}`}>
        {label}
      </label>
      <NativeSelect
        id={`map-${name}`}
        value={value === null ? NONE : String(value)}
        onChange={(event) =>
          w.setMapping(
            withColumn(
              table,
              w.mapping,
              name,
              event.target.value === NONE ? null : Number(event.target.value),
            ),
          )
        }
      >
        <option value={NONE}>
          {required ? "Choose a column" : "Not in the file"}
        </option>
        {Array.from({ length: width }, (_, at) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: columns are positional
          <option key={at} value={at}>
            {title(at)}
          </option>
        ))}
      </NativeSelect>
    </div>
  );
}

export function ColumnsStep({ w }: { w: Wizard }) {
  const { mapping } = w;
  const set = (change: Partial<ImportMapping>) =>
    w.setMapping({ ...mapping, ...change });
  const styles: [AmountStyle, string, string][] = [
    ["signed", "One amount column", "Spending is negative, income positive."],
    [
      "typed",
      "An amount and a type column",
      "The type says income or expense.",
    ],
    [
      "split",
      "Separate money in and money out columns",
      "Debit and credit columns.",
    ],
  ];
  const problems = w.parsed?.problems ?? [];
  const count = w.parsed?.rows.length ?? 0;
  const skipped = w.parsed?.skipped.length ?? 0;
  const first = (w.file?.table ?? []).slice(0, 4);
  return (
    <>
      <section className="imp-section" aria-labelledby="import-columns-title">
        <SectionLabel as="h2" id="import-columns-title">
          Match your columns
        </SectionLabel>
        <div className="imp-card imp-sample-wrap">
          <table className="imp-sample" aria-label="First rows of the file">
            <tbody>
              {first.map((row, at) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: rows and cells are positional
                <tr key={at}>
                  {row.map((cell, column) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: rows and cells are positional
                    <td key={column} title={cell}>
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="imp-card">
          <SwitchRow
            title="First row is a header"
            hint="Column names"
            checked={mapping.hasHeader}
            onChange={(on) => set({ hasHeader: on })}
          />
          <ColumnSelect w={w} name="date" label="Date" required />
          <div className="imp-field">
            <label className="imp-label" htmlFor="map-date-format">
              Date format
            </label>
            <NativeSelect
              id="map-date-format"
              value={mapping.dateFormat}
              onChange={(event) =>
                set({ dateFormat: event.target.value as DateFormat })
              }
            >
              <option value="iso">2026-10-31 (year first)</option>
              <option value="mdy">10/31/2026 (month first)</option>
              <option value="dmy">31/10/2026 (day first)</option>
            </NativeSelect>
          </div>
        </div>
        <fieldset className="imp-group">
          <legend className="ui-section-label">How are amounts written?</legend>
          <div className="imp-card">
            {styles.map(([value, label, hint]) => (
              <label key={value} className="imp-choice">
                <input
                  type="radio"
                  name="amount-style"
                  checked={mapping.amountStyle === value}
                  onChange={() => set({ amountStyle: value })}
                />
                <span className="imp-choice-text">
                  <span>{label}</span>
                  <span className="imp-note">{hint}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        <div className="imp-card">
          {mapping.amountStyle !== "split" && (
            <ColumnSelect w={w} name="amount" label="Amount" required />
          )}
          {mapping.amountStyle === "typed" && (
            <ColumnSelect
              w={w}
              name="type"
              label="Income or expense"
              required
            />
          )}
          {mapping.amountStyle === "split" && (
            <>
              <ColumnSelect
                w={w}
                name="moneyOut"
                label="Money out (spending)"
                required
              />
              <ColumnSelect
                w={w}
                name="moneyIn"
                label="Money in (income)"
                required
              />
            </>
          )}
          <div className="imp-field">
            <label className="imp-label" htmlFor="map-decimal">
              Numbers look like
            </label>
            <NativeSelect
              id="map-decimal"
              value={mapping.decimal}
              onChange={(event) =>
                set({ decimal: event.target.value as DecimalStyle })
              }
            >
              <option value="dot">1,234.56</option>
              <option value="comma">1.234,56</option>
            </NativeSelect>
          </div>
          {mapping.amountStyle === "signed" && (
            <SwitchRow
              title="Positive is spending"
              hint="Some card statements"
              checked={mapping.positiveIsSpending}
              onChange={(on) => set({ positiveIsSpending: on })}
            />
          )}
        </div>
        <SectionLabel>Also in the file (optional)</SectionLabel>
        <div className="imp-card">
          <ColumnSelect w={w} name="payee" label="Payee or description" />
          <ColumnSelect w={w} name="note" label="Note" />
          <ColumnSelect w={w} name="category" label="Category" />
          <ColumnSelect w={w} name="subcategory" label="Subcategory" />
          <ColumnSelect
            w={w}
            name="tags"
            label="Tags (names separated by ; or ,)"
          />
          <ColumnSelect w={w} name="time" label="Time" />
          <ColumnSelect
            w={w}
            name="status"
            label="Status (cleared or pending)"
          />
        </div>
      </section>
      <section className="imp-section" aria-live="polite">
        {w.columnsProblem ? (
          <p className="imp-note">{w.columnsProblem}</p>
        ) : (
          <div className="imp-card">
            <p className="imp-field">
              <span>
                We can read <strong>{count}</strong>{" "}
                {count === 1 ? "row" : "rows"}
                {skipped
                  ? `, and leave out ${skipped} (transfers and split entries can't be imported yet)`
                  : ""}
                {problems.length ? `. ${problems.length} can't be read:` : "."}
              </span>
            </p>
            {problems.length > 0 && (
              <ul className="imp-list imp-lines">
                {problems.slice(0, 5).map((row) => (
                  <li key={row.line}>
                    Line {row.line}: {row.reason}
                  </li>
                ))}
                {problems.length > 5 && (
                  <li>…and {problems.length - 5} more.</li>
                )}
              </ul>
            )}
          </div>
        )}
        <div className="imp-actions">
          <button
            type="button"
            className="ui-btn ui-btn-secondary"
            onClick={() => w.go("file")}
          >
            Back
          </button>
          <button
            type="button"
            className="ui-btn ui-btn-primary"
            disabled={!!w.columnsProblem || count === 0}
            onClick={w.continueFromColumns}
          >
            Continue
          </button>
        </div>
      </section>
    </>
  );
}
