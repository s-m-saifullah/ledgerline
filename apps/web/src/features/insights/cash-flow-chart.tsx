import type { CashFlowReport } from "@ledgerline/shared";
import { Amount } from "../../components/amount-text";

export const shortMonth = (month: string) => {
  const [year, index] = month.split("-").map(Number);
  const local = new Date(0);
  local.setFullYear(year ?? 1, (index ?? 1) - 1, 1);
  local.setHours(12, 0, 0, 0);
  return new Intl.DateTimeFormat("en-US", { month: "short" }).format(local);
};

/** Two bars per month (money in and spending), drawn with plain markup so it follows the theme. */
export function CashFlowChart({
  report,
  selected,
}: {
  report: CashFlowReport;
  selected: string;
}) {
  const peak = Math.max(
    0,
    ...report.months.flatMap((row) => [row.income.amount, row.spending.amount]),
  );
  const height = (cents: number) =>
    cents > 0 && peak > 0 ? `${Math.max(2, (cents * 100) / peak)}%` : "0%";
  return (
    <>
      <div
        className="flow-chart"
        role="img"
        aria-label="Money in and spending for each of the last 12 months"
      >
        <ol className="flow-months">
          {report.months.map((row) => (
            <li
              key={row.month}
              className={`flow-month${row.month === selected ? " selected" : ""}`}
            >
              <span className="flow-bars">
                <span
                  className="flow-bar flow-in"
                  style={{ height: height(row.income.amount) }}
                />
                <span
                  className="flow-bar flow-out"
                  style={{ height: height(row.spending.amount) }}
                />
              </span>
              <span className="flow-label">{shortMonth(row.month)}</span>
            </li>
          ))}
        </ol>
      </div>
      <p className="flow-legend muted">
        <span className="flow-key flow-in" aria-hidden="true" /> Money in
        <span className="flow-key flow-out" aria-hidden="true" /> Spending
      </p>
      <details className="flow-details">
        <summary className="flow-summary">Show the figures</summary>
        <table className="flow-table">
          <caption className="sr-only">Money in, spending and net</caption>
          <thead>
            <tr>
              <th scope="col">Month</th>
              <th scope="col">In</th>
              <th scope="col">Out</th>
              <th scope="col">Net</th>
            </tr>
          </thead>
          <tbody>
            {[...report.months].reverse().map((row) => (
              <tr key={row.month}>
                <th scope="row">
                  {shortMonth(row.month)} {row.month.slice(0, 4)}
                </th>
                <td>
                  <Amount cents={row.income.amount} />
                </td>
                <td>
                  <Amount cents={row.spending.amount} />
                </td>
                <td>
                  <Amount cents={row.net.amount} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </>
  );
}
