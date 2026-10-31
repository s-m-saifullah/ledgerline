import { Amount } from "../../components/amount-text";
import type { WorthSnapshot } from "./model";

/** What is held and what is owed today, with their total: the figure the chart below ends on. */
export function NetWorthNow({ snapshot }: { snapshot: WorthSnapshot }) {
  return (
    <section className="ui-card" aria-labelledby="ins-now-title">
      <h2 id="ins-now-title" className="ui-title ins-card-title">
        Net worth now
      </h2>
      <p className="ui-figure">
        <Amount cents={snapshot.net.amount} currency={snapshot.net.currency} />
      </p>
      <div className="ins-now-cols">
        <div>
          <p className="ins-label">Assets</p>
          <p className="ins-fig">
            <Amount
              cents={snapshot.assets.amount}
              currency={snapshot.assets.currency}
            />
          </p>
        </div>
        <div>
          <p className="ins-label">Liabilities</p>
          <p className="ins-fig">
            <Amount
              cents={snapshot.liabilities.amount}
              currency={snapshot.liabilities.currency}
            />
          </p>
        </div>
      </div>
    </section>
  );
}
