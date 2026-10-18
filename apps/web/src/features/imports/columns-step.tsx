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
  | "status";

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
    <div>
      <label htmlFor={`map-${name}`}>{label}</label>
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
      <section className="settings-card" aria-labelledby="import-columns-title">
        <h2 id="import-columns-title">Match your columns</h2>
        <p className="muted">
          We guessed from the column names. Check each one against the first
          rows below.
        </p>
        <table className="import-sample" aria-label="First rows of the file">
          <tbody>
            {first.map((row, at) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: rows and cells are positional
              <tr key={at}>
                {row.map((cell, column) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: rows and cells are positional
                  <td key={column} className="import-cell" title={cell}>
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <label className="budget-rollover amount-entry-toggle">
          <input
            type="checkbox"
            checked={mapping.hasHeader}
            onChange={(event) => set({ hasHeader: event.target.checked })}
          />
          <span className="check-text">The first row holds column names</span>
        </label>
        <div className="import-fields">
          <ColumnSelect w={w} name="date" label="Date" required />
          <div>
            <label htmlFor="map-date-format">Date format</label>
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
        <fieldset className="import-styles">
          <legend className="import-legend">How are amounts written?</legend>
          {styles.map(([value, label, hint]) => (
            <label key={value} className="budget-rollover amount-entry-toggle">
              <input
                type="radio"
                name="amount-style"
                checked={mapping.amountStyle === value}
                onChange={() => set({ amountStyle: value })}
              />
              <span className="check-text">
                {label}
                <span className="muted import-hint">{hint}</span>
              </span>
            </label>
          ))}
        </fieldset>
        <div className="import-fields">
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
          <div>
            <label htmlFor="map-decimal">Numbers look like</label>
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
        </div>
        {mapping.amountStyle === "signed" && (
          <label className="budget-rollover amount-entry-toggle">
            <input
              type="checkbox"
              checked={mapping.positiveIsSpending}
              onChange={(event) =>
                set({ positiveIsSpending: event.target.checked })
              }
            />
            <span className="check-text">
              Positive amounts are spending (some card statements)
            </span>
          </label>
        )}
        <h3 className="import-subheading">Also in the file (optional)</h3>
        <div className="import-fields">
          <ColumnSelect w={w} name="payee" label="Payee or description" />
          <ColumnSelect w={w} name="note" label="Note" />
          <ColumnSelect w={w} name="category" label="Category" />
          <ColumnSelect w={w} name="subcategory" label="Subcategory" />
          <ColumnSelect w={w} name="time" label="Time" />
          <ColumnSelect
            w={w}
            name="status"
            label="Status (cleared or pending)"
          />
        </div>
      </section>
      <section className="settings-card" aria-live="polite">
        {w.columnsProblem ? (
          <p className="muted">{w.columnsProblem}</p>
        ) : (
          <>
            <p>
              We can read <strong>{count}</strong>{" "}
              {count === 1 ? "row" : "rows"}
              {skipped
                ? `, and leave out ${skipped} (transfers and split entries can't be imported yet)`
                : ""}
              {problems.length ? `. ${problems.length} can't be read:` : "."}
            </p>
            {problems.length > 0 && (
              <ul className="import-problems">
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
          </>
        )}
        <div className="export-actions">
          <button
            type="button"
            className="secondary-button"
            onClick={() => w.go("file")}
          >
            Back
          </button>
          <button
            type="button"
            className="button"
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
