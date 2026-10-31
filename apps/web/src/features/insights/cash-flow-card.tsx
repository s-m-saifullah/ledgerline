import type { CashFlowReport } from "@ledgerline/shared";
import { barHeight } from "./model";

export const shortMonth = (month: string) => {
  const [year, index] = month.split("-").map(Number);
  const local = new Date(0);
  local.setFullYear(year ?? 1, (index ?? 1) - 1, 1);
  local.setHours(12, 0, 0, 0);
  return new Intl.DateTimeFormat("en-US", { month: "short" }).format(local);
};

/**
 * Money in and out from the month the ledger started to be used, up to twelve months: two bars a month, drawn with
 * plain markup so it follows the theme. Fewer than twelve sit at the right, lined up with the net worth chart.
 */
export function CashFlowCard({
  report,
  selected,
}: {
  report: CashFlowReport;
  selected: string;
}) {
  const count = report.months.length;
  const peak = Math.max(
    0,
    ...report.months.flatMap((row) => [row.income.amount, row.spending.amount]),
  );
  return (
    <section className="ui-card" aria-labelledby="ins-flow-title">
      <h2 id="ins-flow-title" className="ui-title ins-card-title">
        Money in and out
      </h2>
      <div
        className="ins-chart"
        role="img"
        aria-label={`Money in and spending for each of the last ${count} ${count === 1 ? "month" : "months"}`}
      >
        <ol className="ins-months">
          {report.months.map((row, index) => (
            <li
              key={row.month}
              className={`ins-month${row.month === selected ? " ins-selected" : ""}`}
              style={index === 0 ? { gridColumnStart: 13 - count } : undefined}
            >
              <span className="ins-bars">
                <span
                  className="ins-bar ins-in"
                  style={{ height: `${barHeight(row.income.amount, peak)}%` }}
                />
                <span
                  className="ins-bar ins-out"
                  style={{ height: `${barHeight(row.spending.amount, peak)}%` }}
                />
              </span>
              <span className="ins-month-label">{shortMonth(row.month)}</span>
            </li>
          ))}
        </ol>
      </div>
      <p className="ins-legend">
        <span>
          <i className="ins-key ins-in" aria-hidden="true" />
          In
        </span>
        <span>
          <i className="ins-key ins-out" aria-hidden="true" />
          Out
        </span>
      </p>
    </section>
  );
}
