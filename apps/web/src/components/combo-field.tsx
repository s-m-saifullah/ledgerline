import { ChevronDown } from "lucide-react";
import { useId, useState } from "react";

export type ComboOption = { id: string; label: string };
/** A way to make what was typed: `run` saves it and returns the new id. */
export type ComboCreate = {
  key: string;
  label: (text: string) => string;
  run: (text: string) => Promise<string>;
};
type Row =
  | { kind: "all" }
  | { kind: "option"; option: ComboOption }
  | { kind: "create"; create: ComboCreate };

/**
 * A field you can type in: the list narrows as you type, "All" clears the choice, and a name nobody has yet can
 * offer to create it. The ARIA 1.2 combobox pattern (input + listbox, the active option by
 * aria-activedescendant), as the category picker does; the styles are the shared `combobox` ones.
 */
export function ComboField({
  label,
  allLabel,
  emptyText,
  options,
  value,
  onChange,
  creates = [],
  disabled = false,
}: {
  label: string;
  /** The text of the choice that clears the field, and the placeholder while nothing is chosen. */
  allLabel: string;
  emptyText: string;
  options: readonly ComboOption[];
  value: string | null;
  onChange: (id: string | null) => void;
  creates?: readonly ComboCreate[];
  disabled?: boolean;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  // null means "not typing": the box shows the chosen name and the list shows everything.
  const [query, setQuery] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const text = (query ?? "").trim();
  const term = text.toLocaleLowerCase();
  const selected = options.find((option) => option.id === value);
  const matches = options.filter((option) =>
    option.label.toLocaleLowerCase().includes(term),
  );
  const exact = options.some(
    (option) => option.label.toLocaleLowerCase() === term,
  );
  const rows: Row[] = [
    ...(term ? [] : [{ kind: "all" } as const]),
    ...matches.map((option) => ({ kind: "option", option }) as const),
    ...(term && !exact
      ? creates.map((create) => ({ kind: "create", create }) as const)
      : []),
  ];
  const rowKey = (row: Row) =>
    row.kind === "all"
      ? "all"
      : row.kind === "option"
        ? row.option.id
        : `create-${row.create.key}`;
  const close = () => {
    setOpen(false);
    setQuery(null);
  };
  const choose = async (row: Row) => {
    if (busy) return;
    if (row.kind === "all") onChange(null);
    else if (row.kind === "option") onChange(row.option.id);
    else {
      setBusy(true);
      setError("");
      try {
        onChange(await row.create.run(text));
      } catch (failure) {
        setError(
          failure instanceof Error && failure.message
            ? failure.message
            : "Couldn't add it. Try again.",
        );
        setBusy(false);
        return;
      }
      setBusy(false);
    }
    close();
  };
  const show = () => {
    if (disabled || busy || open) return;
    setOpen(true);
    const current = rows.findIndex(
      (row) => row.kind === "option" && row.option.id === value,
    );
    setActive(current < 0 ? 0 : current);
  };
  const activeRow = rows[Math.min(active, rows.length - 1)];
  return (
    <div className="category-picker">
      <label htmlFor={`${id}-value`}>{label}</label>
      <div className="combobox">
        <input
          id={`${id}-value`}
          role="combobox"
          aria-expanded={open}
          aria-controls={`${id}-list`}
          aria-autocomplete="list"
          aria-activedescendant={
            open && activeRow ? `${id}-option-${rowKey(activeRow)}` : undefined
          }
          autoComplete="off"
          spellCheck={false}
          disabled={disabled || busy}
          placeholder={allLabel}
          value={open && query !== null ? query : (selected?.label ?? "")}
          // Focus alone does not open the list (a sheet starts on its first field); a click, typing or an arrow does.
          onFocus={(event) => event.currentTarget.select()}
          onClick={show}
          onBlur={close}
          onChange={(event) => {
            setOpen(true);
            setQuery(event.target.value);
            setError("");
            setActive(0);
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              if (!open) return show();
              const step = event.key === "ArrowDown" ? 1 : -1;
              setActive((index) =>
                rows.length ? (index + step + rows.length) % rows.length : 0,
              );
            } else if (event.key === "Enter" && open) {
              // Enter picks a row; it must not submit what surrounds the field.
              event.preventDefault();
              if (activeRow) void choose(activeRow);
            } else if (event.key === "Escape" && open) {
              // The overlay a field sits in also leaves its own Escape to an open list.
              close();
            } else if (event.key === "Home" && open) {
              event.preventDefault();
              setActive(0);
            } else if (event.key === "End" && open) {
              event.preventDefault();
              setActive(Math.max(rows.length - 1, 0));
            }
          }}
        />
        <ChevronDown size={16} aria-hidden="true" />
        {open && (
          <div
            id={`${id}-list`}
            role="listbox"
            aria-label={`${label} options`}
            className="combobox-list"
          >
            {rows.map((row, index) => (
              // biome-ignore lint/a11y/useFocusableInteractive: options use aria-activedescendant; focus stays on the input.
              // biome-ignore lint/a11y/useKeyWithClickEvents: the combobox input owns keyboard selection.
              <div
                key={rowKey(row)}
                id={`${id}-option-${rowKey(row)}`}
                role="option"
                aria-selected={
                  row.kind === "option"
                    ? row.option.id === value
                    : row.kind === "all"
                      ? value === null
                      : false
                }
                data-active={index === active || undefined}
                // mousedown fires before blur; prevent it so the click still lands.
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setActive(index)}
                onClick={() => void choose(row)}
              >
                {row.kind === "all"
                  ? allLabel
                  : row.kind === "option"
                    ? row.option.label
                    : row.create.label(text)}
              </div>
            ))}
            {rows.length === 0 && (
              <div className="combobox-empty" role="status">
                {emptyText}
              </div>
            )}
          </div>
        )}
      </div>
      {error && (
        <p role="alert" className="field-error">
          {error}
        </p>
      )}
    </div>
  );
}
