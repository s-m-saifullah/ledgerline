import type { SpendingReport } from "@ledgerline/shared";
import { EmptyState, ProportionBar, RowBody } from "@ledgerline/ui";
import { Link } from "@tanstack/react-router";
import { ChevronDown } from "lucide-react";
import { useState } from "react";
import { Amount } from "../../components/amount-text";
import { monthLabel } from "../../lib/month";
import { categoryColour, percentOf } from "./model";

type Parent = SpendingReport["categories"][number];
type Range = { start: string; end: string };

const named = (line: { name: string; archived: boolean }) =>
  `${line.name}${line.archived ? " (archived)" : ""}`;

/** A square of the category's colour, the key to its slice of the bar above. */
const Swatch = ({ colour }: { colour: string }) => (
  <span className="ins-swatch" aria-hidden="true">
    <i style={{ background: colour }} />
  </span>
);

/** One category's entries for the month; a parent's own entries are filtered by the parent alone. */
function EntriesLink({
  categoryId,
  range,
  children,
}: {
  categoryId: string;
  range: Range;
  children: React.ReactNode;
}) {
  return (
    <Link
      to="/transactions"
      search={{ categoryId, from: range.start, to: range.end }}
      className="ui-row ui-row-press ins-cat"
    >
      {children}
    </Link>
  );
}

/** The amount and its share, at the end of a row. */
const End = ({ cents, total }: { cents: number; total: number }) => (
  <>
    <Amount cents={cents} />
    <span className="ui-row-hint">{percentOf(cents, total)}</span>
  </>
);

function Main({
  name,
  hint,
  share,
  chevron,
}: {
  name: string;
  hint?: string;
  share?: number;
  chevron?: { open: boolean };
}) {
  return (
    <span className="ui-row-main ins-cat-main">
      <span className="ui-row-title">
        {name}
        {chevron && (
          <ChevronDown
            size={16}
            aria-hidden="true"
            className={`ins-chevron${chevron.open ? " ins-chevron-open" : ""}`}
          />
        )}
      </span>
      {hint && <span className="ui-row-hint">{hint}</span>}
      {share !== undefined && <ProportionBar share={share} />}
    </span>
  );
}

function ParentRow({
  line,
  colour,
  total,
  range,
}: {
  line: Parent;
  colour: string;
  total: number;
  range: Range;
}) {
  const [open, setOpen] = useState(false);
  const share = total > 0 ? line.amount.amount / total : 0;
  if (line.children.length === 0)
    return (
      <EntriesLink categoryId={line.categoryId} range={range}>
        <Swatch colour={colour} />
        <Main name={named(line)} share={share} />
        <span className="ui-row-end">
          <End cents={line.amount.amount} total={total} />
        </span>
      </EntriesLink>
    );
  const direct =
    line.amount.amount -
    line.children.reduce((sum, child) => sum + child.amount.amount, 0);
  const listId = `insight-children-${line.categoryId}`;
  return (
    <div className="ins-parent">
      <button
        type="button"
        className="ui-row ui-row-press ins-cat"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen(!open)}
      >
        <Swatch colour={colour} />
        <Main
          name={named(line)}
          hint={`${line.children.length} ${line.children.length === 1 ? "subcategory" : "subcategories"}`}
          share={share}
          chevron={{ open }}
        />
        <span className="ui-row-end">
          <End cents={line.amount.amount} total={total} />
        </span>
      </button>
      {open && (
        <div id={listId} className="ins-kids">
          {line.children.map((child) => (
            <EntriesLink
              key={child.categoryId}
              categoryId={child.categoryId}
              range={range}
            >
              <RowBody
                title={named(child)}
                value={<Amount cents={child.amount.amount} />}
                valueHint={percentOf(child.amount.amount, total)}
              />
            </EntriesLink>
          ))}
          {direct > 0 && (
            <EntriesLink categoryId={line.categoryId} range={range}>
              <RowBody
                title={`Directly in ${line.name}`}
                value={<Amount cents={direct} />}
                valueHint={percentOf(direct, total)}
              />
            </EntriesLink>
          )}
        </div>
      )}
    </div>
  );
}

/** Spending by category: a bar split by category, then a row each; a main category opens to its subcategories. */
export function SpendingCard({
  report,
  month,
}: {
  report: SpendingReport;
  month: string;
}) {
  const range = { start: report.monthStart, end: report.monthEnd };
  const total = report.total.amount;
  return (
    <section
      className="ui-card ui-list ins-spending"
      aria-labelledby="ins-spending-title"
    >
      <h2 id="ins-spending-title" className="ui-title ins-card-title">
        Spending
      </h2>
      {report.categories.length === 0 ? (
        <EmptyState text={`No spending in ${monthLabel(month)}.`} />
      ) : (
        <>
          <div className="ins-segbar ins-segbar-cats" aria-hidden="true">
            {report.categories.map((line, index) => (
              <i
                key={line.categoryId}
                style={{
                  width: `${total > 0 ? (line.amount.amount * 100) / total : 0}%`,
                  background: categoryColour(index),
                }}
              />
            ))}
          </div>
          <ul aria-label="Spending by category" className="ins-cats">
            {report.categories.map((line, index) => (
              <li key={line.categoryId}>
                <ParentRow
                  line={line}
                  colour={categoryColour(index)}
                  total={total}
                  range={range}
                />
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
