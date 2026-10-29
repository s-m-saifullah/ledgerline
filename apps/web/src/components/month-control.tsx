import { ChevronLeft, ChevronRight } from "lucide-react";
import { monthLabel, shiftMonth } from "../lib/month";

/** Previous and next arrows around the month's name (YYYY-MM): the redesign's twin of the phone's month control. */
export function MonthControl({
  month,
  onChange,
}: {
  month: string;
  onChange: (month: string) => void;
}) {
  return (
    <div className="ui-month">
      <button
        type="button"
        className="ui-icon-btn"
        aria-label="Previous month"
        onClick={() => onChange(shiftMonth(month, -1))}
      >
        <ChevronLeft size={20} />
      </button>
      <p className="ui-month-label" aria-live="polite">
        {monthLabel(month)}
      </p>
      <button
        type="button"
        className="ui-icon-btn"
        aria-label="Next month"
        onClick={() => onChange(shiftMonth(month, 1))}
      >
        <ChevronRight size={20} />
      </button>
    </div>
  );
}
