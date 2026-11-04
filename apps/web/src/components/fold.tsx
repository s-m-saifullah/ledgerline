import { ChevronDown } from "lucide-react";
import type { ReactNode } from "react";
import "./fold.css";

/**
 * A shut card with one summary row that opens to more rows (Tags' archived, Users' recently deleted). A native
 * `<details>`, so the keyboard and screen readers get it for free; the rows inside are laid out by the caller.
 */
export function Fold({
  summary,
  children,
}: {
  summary: string;
  children: ReactNode;
}) {
  return (
    <details className="ui-card ui-fold">
      <summary>
        <span>{summary}</span>
        <ChevronDown size={18} aria-hidden="true" />
      </summary>
      <div className="ui-fold-body">{children}</div>
    </details>
  );
}
