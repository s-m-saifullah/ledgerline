import { MonthControl } from "./month-control";
import "./month-head.css";

/**
 * The head of a page that follows a month (Budgets, Insights): the page's one h1 with the month control. On a
 * phone the title is the top bar's and the control sits under it, centred; from 700 px both are in the head.
 */
export function MonthHead({
  title,
  id,
  month,
  onChange,
}: {
  title: string;
  /** The h1's id, which the shell focuses after navigation and a sheet gives focus back to. */
  id: string;
  month: string;
  onChange: (month: string) => void;
}) {
  return (
    <div className="page-heading month-head">
      <h1 id={id} tabIndex={-1}>
        {title}
      </h1>
      <div className="month-head-control">
        <MonthControl month={month} onChange={onChange} />
      </div>
    </div>
  );
}
