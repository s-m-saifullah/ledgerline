import { Search } from "lucide-react";
import "./search-field.css";

/**
 * The one search box (ADR 0047, the prototype's `search()`): a magnifier inside a tinted field, 44 px high, with a
 * hidden label for screen readers and the same words as its placeholder. It is a `search` landmark; put it in a
 * form with `ui-btn` beside it when a button belongs next to it (Transactions has Filters).
 */
export function SearchField({
  id,
  label,
  value,
  onChange,
  placeholder = label,
  maxLength = 200,
}: {
  id: string;
  /** What a screen reader says, and the placeholder unless one is given. */
  label: string;
  value: string;
  onChange: (text: string) => void;
  placeholder?: string;
  maxLength?: number;
}) {
  return (
    <search className="ui-search">
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <Search size={18} aria-hidden="true" />
      <input
        id={id}
        type="search"
        autoComplete="off"
        maxLength={maxLength}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
    </search>
  );
}
