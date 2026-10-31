import { ChevronRight } from "lucide-react";
import "./pick-row.css";

export type PickOption = {
  value: string;
  label: string;
  /** What the row shows for this choice when the list's own text is longer. */
  short?: string;
  disabled?: boolean;
};

/**
 * A row that picks one of a few options (ADR 0047): the label on the left, the choice and a chevron on the right.
 * The native select lies over the row, so a click opens the platform's own list and the keyboard, the label and
 * the screen reader keep working as they do for any select.
 */
export function PickRow({
  id,
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  id: string;
  label: string;
  value: string;
  options: readonly PickOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const chosen = options.find((option) => option.value === value);
  const empty = !chosen || chosen.value === "";
  return (
    <div className="ui-row ui-pick-row">
      <label htmlFor={id} className="ui-row-main">
        <span className="ui-row-title">{label}</span>
      </label>
      <span className="ui-row-end ui-pick-value" aria-hidden="true">
        <span className={empty ? "ui-pick-placeholder" : undefined}>
          {chosen ? (chosen.short ?? chosen.label) : ""}
        </span>
      </span>
      <span className="ui-row-chevron" aria-hidden="true">
        <ChevronRight size={18} />
      </span>
      <select
        id={id}
        className="ui-pick-select"
        // Never drawn, so not part of the type scale; 16 px keeps iOS from zooming the page when the list opens.
        style={{ fontSize: 16 }}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map((option) => (
          <option
            key={option.value}
            value={option.value}
            disabled={option.disabled}
          >
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}
