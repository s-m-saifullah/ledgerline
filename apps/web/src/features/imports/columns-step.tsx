import { SegmentedControl, SwitchRow } from "@ledgerline/ui";
import { ChevronRight } from "lucide-react";
import { PickRow } from "../../components/pick-row";
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

function ColumnRow({
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
    <PickRow
      id={`map-${name}`}
      label={label}
      value={value === null ? NONE : String(value)}
      options={[
        {
          value: NONE,
          label: required ? "Choose a column" : "Not in the file",
        },
        ...Array.from({ length: width }, (_, at) => ({
          value: String(at),
          label: title(at),
        })),
      ]}
      onChange={(next) =>
        w.setMapping(
          withColumn(
            table,
            w.mapping,
            name,
            next === NONE ? null : Number(next),
          ),
        )
      }
    />
  );
}

export function ColumnsStep({ w }: { w: Wizard }) {
  const { mapping } = w;
  const set = (change: Partial<ImportMapping>) =>
    w.setMapping({ ...mapping, ...change });
  const problems = w.parsed?.problems ?? [];
  const count = w.parsed?.rows.length ?? 0;
  const skipped = w.parsed?.skipped.length ?? 0;
  const first = (w.file?.table ?? []).slice(0, 4);
  const header = mapping.hasHeader ? first[0] : undefined;
  const body = mapping.hasHeader ? first.slice(1) : first;
  return (
    <>
      <div className="ui-card imp-sample-card">
        <table className="imp-sample" aria-label="First rows of the file">
          {header && (
            <thead>
              <tr>
                {header.map((cell, column) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: cells are positional
                  <th key={column} title={cell} scope="col">
                    {cell}
                  </th>
                ))}
              </tr>
            </thead>
          )}
          <tbody>
            {body.map((row, at) => (
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
      <div className="ui-card ui-list">
        <SwitchRow
          title="The first row holds column names"
          checked={mapping.hasHeader}
          onChange={(on) => set({ hasHeader: on })}
        />
        <ColumnRow w={w} name="date" label="Date" required />
        <PickRow
          id="map-date-format"
          label="Date format"
          value={mapping.dateFormat}
          options={[
            {
              value: "iso",
              label: "2026-10-31 (year first)",
              short: "Year first",
            },
            {
              value: "mdy",
              label: "10/31/2026 (month first)",
              short: "Month first",
            },
            {
              value: "dmy",
              label: "31/10/2026 (day first)",
              short: "Day first",
            },
          ]}
          onChange={(next) => set({ dateFormat: next as DateFormat })}
        />
        {mapping.amountStyle !== "split" && (
          <ColumnRow w={w} name="amount" label="Amount" required />
        )}
        {mapping.amountStyle === "typed" && (
          <ColumnRow w={w} name="type" label="Income or expense" required />
        )}
        {mapping.amountStyle === "split" && (
          <>
            <ColumnRow
              w={w}
              name="moneyOut"
              label="Money out (spending)"
              required
            />
            <ColumnRow
              w={w}
              name="moneyIn"
              label="Money in (income)"
              required
            />
          </>
        )}
        <PickRow
          id="map-decimal"
          label="Numbers look like"
          value={mapping.decimal}
          options={[
            { value: "dot", label: "1,234.56" },
            { value: "comma", label: "1.234,56" },
          ]}
          onChange={(next) => set({ decimal: next as DecimalStyle })}
        />
        {mapping.amountStyle === "signed" && (
          <SwitchRow
            title="Positive is spending"
            hint="Some card statements"
            checked={mapping.positiveIsSpending}
            onChange={(on) => set({ positiveIsSpending: on })}
          />
        )}
      </div>
      <SegmentedControl<AmountStyle>
        label="How are amounts written?"
        options={[
          { value: "signed", label: "One amount column" },
          { value: "typed", label: "Amount and type" },
          { value: "split", label: "Money in and out" },
        ]}
        value={mapping.amountStyle}
        onChange={(next) => set({ amountStyle: next })}
      />
      <details className="ui-card ui-list imp-details">
        <summary className="ui-row">
          <span className="ui-row-main">
            <span className="ui-row-title">Also in the file</span>
          </span>
          <span className="ui-row-chevron" aria-hidden="true">
            <ChevronRight size={18} />
          </span>
        </summary>
        <ColumnRow w={w} name="payee" label="Payee" />
        <ColumnRow w={w} name="note" label="Note" />
        <ColumnRow w={w} name="category" label="Category" />
        <ColumnRow w={w} name="subcategory" label="Subcategory" />
        <ColumnRow w={w} name="tags" label="Tags" />
        <ColumnRow w={w} name="time" label="Time" />
        <ColumnRow w={w} name="status" label="Status" />
      </details>
      <div className="imp-banner" aria-live="polite">
        {w.columnsProblem ? (
          <p>{w.columnsProblem}</p>
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
              <ul className="imp-lines">
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
      </div>
      <div className="imp-next">
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
    </>
  );
}
