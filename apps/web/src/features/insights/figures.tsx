import type { CashFlowReport, NetWorthReport } from "@ledgerline/shared";
import { ChevronDown } from "lucide-react";
import { Amount } from "../../components/amount-text";
import { shortMonth } from "./cash-flow-card";

const label = (month: string) => `${shortMonth(month)} ${month.slice(0, 4)}`;

/** The tables behind the charts, for screen readers and for copying; one disclosure at the foot of the page. */
export function Figures({
  flow,
  worth,
}: {
  flow: CashFlowReport | null;
  worth: NetWorthReport | null;
}) {
  if (!flow && !(worth && worth.months.length > 0)) return null;
  return (
    <details className="ui-card ins-figures">
      <summary>
        <span>Show the figures</span>
        <ChevronDown size={18} aria-hidden="true" />
      </summary>
      {flow && (
        <table className="ins-table">
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
            {[...flow.months].reverse().map((row) => (
              <tr key={row.month}>
                <th scope="row">{label(row.month)}</th>
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
      )}
      {worth && worth.months.length > 0 && (
        <table className="ins-table">
          <caption className="sr-only">Net worth at each month end</caption>
          <thead>
            <tr>
              <th scope="col">Month</th>
              <th scope="col">Net worth</th>
            </tr>
          </thead>
          <tbody>
            {[...worth.months].reverse().map((row) => (
              <tr key={row.month}>
                <th scope="row">{label(row.month)}</th>
                <td>
                  <Amount cents={row.netWorth.amount} />
                  {row.unconvertedCurrencies.length > 0 && (
                    <span className="ins-muted">
                      {" "}
                      without {row.unconvertedCurrencies.join(", ")}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </details>
  );
}
