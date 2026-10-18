import type { SpendingReport } from "@ledgerline/shared";
import { Link } from "@tanstack/react-router";
import { ChevronDown } from "lucide-react";
import { useState } from "react";
import { Amount } from "../../components/amount-text";

type Parent = SpendingReport["categories"][number];

const percent = (cents: number, total: number) =>
  total > 0 ? `${((cents * 100) / total).toFixed(1)}%` : "0.0%";
const width = (cents: number, total: number) =>
  `${total > 0 ? Math.min(100, (cents * 100) / total) : 0}%`;

function Body({
  name,
  cents,
  total,
  detail,
  chevron,
}: {
  name: string;
  cents: number;
  total: number;
  detail?: string;
  chevron?: { open: boolean };
}) {
  return (
    <>
      <span className="insight-line-top">
        <strong>
          {name}
          {chevron && (
            <ChevronDown
              size={20}
              aria-hidden="true"
              className={`insight-chevron${chevron.open ? " open" : ""}`}
            />
          )}
        </strong>
        <Amount cents={cents} />
      </span>
      <span className="budget-bar" aria-hidden="true">
        <span
          className="budget-bar-fill"
          style={{ width: width(cents, total) }}
        />
      </span>
      <span className="insight-line-detail muted">
        {percent(cents, total)} of spending{detail ? ` · ${detail}` : ""}
      </span>
    </>
  );
}

/** One category's entries for the month; a parent's own entries are filtered by the parent alone. */
function EntriesLink({
  categoryId,
  range,
  children,
}: {
  categoryId: string;
  range: { start: string; end: string };
  children: React.ReactNode;
}) {
  return (
    <Link
      to="/transactions"
      search={{ categoryId, from: range.start, to: range.end }}
      className="insight-line"
    >
      {children}
    </Link>
  );
}

function ParentRow({
  line,
  total,
  range,
}: {
  line: Parent;
  total: number;
  range: { start: string; end: string };
}) {
  const [open, setOpen] = useState(false);
  const name = `${line.name}${line.archived ? " (archived)" : ""}`;
  if (line.children.length === 0)
    return (
      <li>
        <EntriesLink categoryId={line.categoryId} range={range}>
          <Body name={name} cents={line.amount.amount} total={total} />
        </EntriesLink>
      </li>
    );
  const direct =
    line.amount.amount -
    line.children.reduce((sum, child) => sum + child.amount.amount, 0);
  const listId = `insight-children-${line.categoryId}`;
  return (
    <li>
      <button
        type="button"
        className="insight-line"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen(!open)}
      >
        <Body
          name={name}
          cents={line.amount.amount}
          total={total}
          detail={`${line.children.length} ${line.children.length === 1 ? "subcategory" : "subcategories"}`}
          chevron={{ open }}
        />
      </button>
      {open && (
        <ul id={listId} className="insight-children">
          {line.children.map((child) => (
            <li key={child.categoryId}>
              <EntriesLink categoryId={child.categoryId} range={range}>
                <Body
                  name={`${child.name}${child.archived ? " (archived)" : ""}`}
                  cents={child.amount.amount}
                  total={total}
                />
              </EntriesLink>
            </li>
          ))}
          {direct > 0 && (
            <li>
              <EntriesLink categoryId={line.categoryId} range={range}>
                <Body
                  name={`Directly in ${line.name}`}
                  cents={direct}
                  total={total}
                />
              </EntriesLink>
            </li>
          )}
        </ul>
      )}
    </li>
  );
}

export function SpendingList({ report }: { report: SpendingReport }) {
  const range = { start: report.monthStart, end: report.monthEnd };
  return (
    <ul className="budget-list" aria-label="Spending by category">
      {report.categories.map((line) => (
        <ParentRow
          key={line.categoryId}
          line={line}
          total={report.total.amount}
          range={range}
        />
      ))}
    </ul>
  );
}
