import type { NetWorthReport } from "@ledgerline/shared";
import { Amount } from "../../components/amount-text";
import { monthLabel } from "../../lib/month";
import { shortMonth } from "./cash-flow-chart";

const label = (month: string) => `${shortMonth(month)} ${month.slice(0, 4)}`;
const names = (codes: string[]) => codes.join(", ");

/** One bar per month end, drawn with plain markup; a month missing a rate is hatched and listed. */
export function NetWorthChart({
  report,
  selected,
}: {
  report: NetWorthReport;
  selected: string;
}) {
  const count = report.months.length;
  // Months before the ledger's first data are left out (ADR 0036); say where history starts.
  const starts =
    report.historyStart && count < 12 ? (
      <p className="nw-note muted">
        History starts in {monthLabel(report.historyStart)}; earlier months are
        not shown.
      </p>
    ) : null;
  if (count === 0) return starts;
  const values = report.months.map((row) => row.netWorth.amount);
  const high = Math.max(0, ...values);
  const low = Math.min(0, ...values);
  const range = high - low;
  const place = (cents: number) => {
    if (range === 0) return { bottom: "0%", height: "0%" };
    const edge = cents >= 0 ? 0 : cents;
    return {
      bottom: `${((edge - low) * 100) / range}%`,
      height: `${cents === 0 ? 0 : Math.max(1, (Math.abs(cents) * 100) / range)}%`,
    };
  };
  const incomplete = report.months.filter(
    (row) => row.unconvertedCurrencies.length > 0,
  );
  const missing = new Map<string, number>();
  for (const row of incomplete)
    for (const code of row.unconvertedCurrencies)
      missing.set(code, (missing.get(code) ?? 0) + 1);
  return (
    <>
      <div
        className="flow-chart"
        role="img"
        aria-label={`Net worth at the end of each of the last ${count} ${count === 1 ? "month" : "months"}`}
      >
        <ol className="flow-months">
          {report.months.map((row, index) => (
            <li
              key={row.month}
              className={`flow-month${row.month === selected ? " selected" : ""}`}
              // Fewer than 12 months sit at the right, lined up with the chart above.
              style={index === 0 ? { gridColumnStart: 13 - count } : undefined}
            >
              <span className="nw-bars">
                {low < 0 && (
                  <span
                    className="nw-zero"
                    style={{ bottom: `${((0 - low) * 100) / range}%` }}
                  />
                )}
                <span
                  className={`nw-bar${row.unconvertedCurrencies.length ? " nw-partial" : ""}`}
                  style={place(row.netWorth.amount)}
                />
              </span>
              <span className="flow-label">{shortMonth(row.month)}</span>
            </li>
          ))}
        </ol>
      </div>
      {starts}
      {incomplete.length > 0 && (
        <p className="nw-note muted">
          <span className="flow-key nw-partial" aria-hidden="true" /> Hatched
          months are incomplete: a currency had no stored rate yet, so its
          accounts are left out. Missing a rate:{" "}
          {[...missing]
            .map(([code, n]) => `${code} (${n} of ${count} months)`)
            .join(", ")}
          .
        </p>
      )}
      <details className="flow-details">
        <summary>Show the figures</summary>
        <table className="flow-table">
          <caption className="sr-only">Net worth at each month end</caption>
          <thead>
            <tr>
              <th scope="col">Month</th>
              <th scope="col">Net worth</th>
            </tr>
          </thead>
          <tbody>
            {[...report.months].reverse().map((row) => (
              <tr key={row.month}>
                <th scope="row">{label(row.month)}</th>
                <td>
                  <Amount cents={row.netWorth.amount} />
                  {row.unconvertedCurrencies.length > 0 && (
                    <span className="muted">
                      {" "}
                      without {names(row.unconvertedCurrencies)}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </>
  );
}
