import { Check, ChevronDown, ChevronUp, CircleSlash } from "lucide-react";
import { type ReactNode, useId, useState } from "react";

export type AppearanceOption = {
  value: string;
  label: string;
  /** The icon or the colour itself, drawn beside its name. */
  visual: ReactNode;
};

/** A colour swatch; with no colour, an empty ring. */
export function Swatch({ color }: { color: string | null }) {
  return (
    <span
      className="cg-swatch"
      aria-hidden="true"
      style={color ? { backgroundColor: color } : undefined}
      data-empty={color ? undefined : "true"}
    />
  );
}
/** "No icon" and "No color" are drawn as a crossed circle. */
export const NoneMark = () => <CircleSlash size={20} aria-hidden="true" />;

/**
 * A row that picks one of a few looks (ADR 0047): the label and the current choice, drawn with its icon or colour,
 * and a list under it where every choice is drawn the same way. A native select cannot draw them.
 */
export function AppearanceRow({
  id,
  label,
  value,
  options,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  options: readonly AppearanceOption[];
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  const chosen = options.find((option) => option.value === value);
  return (
    <div className="cg-choice">
      <button
        type="button"
        id={id}
        className="ui-row ui-row-press cg-choice-head"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="ui-row-main">
          <span className="ui-row-title">{label}</span>
        </span>
        <span className="cg-choice-value">
          {chosen?.visual}
          <span>{chosen?.label}</span>
        </span>
        <span className="ui-row-chevron" aria-hidden="true">
          {open ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
        </span>
      </button>
      {open && (
        <div
          id={listId}
          role="radiogroup"
          aria-label={label}
          className="cg-choice-list"
        >
          {options.map((option) => (
            // biome-ignore lint/a11y/useSemanticElements: a styled row in a radio group
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={option.value === value}
              className="ui-row ui-row-press cg-choice-option"
              onClick={() => {
                onChange(option.value);
                setOpen(false);
              }}
            >
              {option.visual}
              <span className="ui-row-main">
                <span className="ui-row-title">{option.label}</span>
              </span>
              {option.value === value && (
                <Check size={18} aria-hidden="true" className="cg-check" />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
