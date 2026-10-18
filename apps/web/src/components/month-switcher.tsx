import { ChevronLeft, ChevronRight } from "lucide-react";
import { monthLabel, shiftMonth } from "../lib/month";

/** Previous and next arrows around the month's name (YYYY-MM), shared by Budgets and Insights. */
export function MonthSwitcher({
  month,
  onChange,
}: {
  month: string;
  onChange: (month: string) => void;
}) {
  return (
    <div className="month-switcher">
      <button
        type="button"
        className="icon-button"
        aria-label="Previous month"
        onClick={() => onChange(shiftMonth(month, -1))}
      >
        <ChevronLeft size={20} />
      </button>
      <p className="muted" aria-live="polite">
        {monthLabel(month)}
      </p>
      <button
        type="button"
        className="icon-button"
        aria-label="Next month"
        onClick={() => onChange(shiftMonth(month, 1))}
      >
        <ChevronRight size={20} />
      </button>
    </div>
  );
}
