import type { NetWorthReport } from "@ledgerline/shared";
import { monthLabel } from "../../lib/month";
import { shortMonth } from "./cash-flow-card";
import { worthBar, zeroAt } from "./model";

/** Net worth at each month end, one bar a month, drawn with plain markup; a month missing a rate is hatched and listed. */
export function NetWorthCard({
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
      <p className="ins-note">
        History starts in {monthLabel(report.historyStart)}; earlier months are
        not shown.
      </p>
    ) : null;
  const values = report.months.map((row) => row.netWorth.amount);
  const high = Math.max(0, ...values);
  const low = Math.min(0, ...values);
  const incomplete = report.months.filter(
    (row) => row.unconvertedCurrencies.length > 0,
  );
  const missing = new Map<string, number>();
  for (const row of incomplete)
    for (const code of row.unconvertedCurrencies)
      missing.set(code, (missing.get(code) ?? 0) + 1);
  return (
    <section className="ui-card" aria-labelledby="ins-worth-title">
      <h2 id="ins-worth-title" className="ui-title ins-card-title">
        Net worth over time
      </h2>
      {count > 0 && (
        <div
          className="ins-chart"
          role="img"
          aria-label={`Net worth at the end of each of the last ${count} ${count === 1 ? "month" : "months"}`}
        >
          <ol className="ins-months">
            {report.months.map((row, index) => {
              const place = worthBar(row.netWorth.amount, high, low);
              return (
                <li
                  key={row.month}
                  className={`ins-month${row.month === selected ? " ins-selected" : ""}`}
                  // Fewer than 12 months sit at the right, lined up with the chart above.
                  style={
                    index === 0 ? { gridColumnStart: 13 - count } : undefined
                  }
                >
                  <span className="ins-nw-bars">
                    {low < 0 && (
                      <span
                        className="ins-zero"
                        style={{ bottom: `${zeroAt(high, low)}%` }}
                      />
                    )}
                    <span
                      className={`ins-nw-bar${row.netWorth.amount < 0 ? " ins-neg" : ""}${row.unconvertedCurrencies.length ? " ins-partial" : ""}`}
                      style={{
                        bottom: `${place.bottom}%`,
                        height: `${place.height}%`,
                      }}
                    />
                  </span>
                  <span className="ins-month-label">
                    {shortMonth(row.month)}
                  </span>
                </li>
              );
            })}
          </ol>
        </div>
      )}
      {starts}
      {incomplete.length > 0 && (
        <p className="ins-note">
          <i className="ins-key ins-partial" aria-hidden="true" /> Hatched
          months are incomplete: a currency had no stored rate yet, so its
          accounts are left out. Missing a rate:{" "}
          {[...missing]
            .map(([code, n]) => `${code} (${n} of ${count} months)`)
            .join(", ")}
          .
        </p>
      )}
    </section>
  );
}
