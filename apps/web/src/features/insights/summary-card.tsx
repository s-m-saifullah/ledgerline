import { Amount } from "../../components/amount-text";
import { keptPercent, summaryBar } from "./model";

/**
 * This month: what was spent against what came in, as a bar and three figures. Money in and Net come from the
 * cash flow report, so they wait for it; the bar says the same in words.
 */
export function SummaryCard({
  spent,
  income,
  net,
}: {
  spent: number;
  income: number | null;
  net: number | null;
}) {
  const bar =
    income === null ? { kind: "none" as const } : summaryBar(income, spent);
  const kept = income === null ? null : keptPercent(income, spent);
  return (
    <section
      className="ui-card ins-summary"
      aria-labelledby="ins-summary-title"
    >
      <h2 id="ins-summary-title" className="ui-title">
        This month
      </h2>
      {bar.kind !== "none" && (
        <div
          className={`ins-segbar${bar.kind === "over" ? " ins-segbar-over" : ""}`}
          role="img"
          aria-label={
            bar.kind === "over"
              ? "More went out than came in"
              : `${Math.round(bar.spent * 100)}% of the money in went out`
          }
        >
          {bar.kind === "split" && (
            <i style={{ width: `${bar.spent * 100}%` }} />
          )}
        </div>
      )}
      <div className="ins-sum-cols">
        <div>
          <p className="ins-label">Spent</p>
          <p className="ins-fig">
            <Amount cents={spent} />
          </p>
        </div>
        {income !== null && (
          <div>
            <p className="ins-label">Money in</p>
            <p className="ins-fig">
              <Amount cents={income} />
            </p>
          </div>
        )}
        {net !== null && (
          <div>
            <p className="ins-label">Net</p>
            <p className={`ins-fig${net > 0 ? " ins-pos" : ""}`}>
              <Amount cents={net} plus />
            </p>
            {kept !== null && <p className="ins-label">{kept}% kept</p>}
          </div>
        )}
      </div>
    </section>
  );
}
