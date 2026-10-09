import type { Category } from "@ledgerline/shared";
import { ChevronDown } from "lucide-react";
import { useId, useRef, useState } from "react";
import { categoryOptions } from "./tree";

/**
 * One field: tap to open the list, type to filter it. Follows the ARIA 1.2
 * combobox pattern (input + listbox, active option via aria-activedescendant).
 */
export function CategoryPicker({
  categories,
  kind,
  value,
  onChange,
  label = "Category",
  rootsOnly = false,
  childrenOnly = false,
  excludeId,
  allowNone = false,
  disabled = false,
}: {
  categories: readonly Category[];
  kind: Category["kind"];
  value: string | null;
  onChange: (id: string | null) => void;
  label?: string;
  rootsOnly?: boolean;
  childrenOnly?: boolean;
  excludeId?: string | undefined;
  allowNone?: boolean;
  disabled?: boolean;
}) {
  const id = useId();
  const listId = `${id}-list`;
  const input = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  // null means "not typing": show the selected label and the full list.
  const [query, setQuery] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const all = categoryOptions(
    categories,
    kind,
    "",
    rootsOnly,
    excludeId,
  ).filter((option) => !childrenOnly || !!option.category.parentId);
  const selected = categories.find((row) => row.id === value);
  const term = (query ?? "").trim().toLocaleLowerCase();
  const matches = all.filter((option) =>
    option.label.toLocaleLowerCase().includes(term),
  );
  const none = "No parent (top level)";
  const rows: { id: string | null; text: string }[] = [
    ...(allowNone && (!term || none.toLocaleLowerCase().includes(term))
      ? [{ id: null, text: none }]
      : []),
    ...matches.map((option) => ({
      id: option.category.id,
      text: option.label,
    })),
  ];
  const selectedText = selected
    ? (all.find((option) => option.category.id === selected.id)?.label ??
      `${selected.name}${selected.archivedAt ? " (archived)" : " (current selection)"}`)
    : allowNone && value === null
      ? none
      : "";
  const close = () => {
    setOpen(false);
    setQuery(null);
  };
  const choose = (row: { id: string | null }) => {
    onChange(row.id);
    close();
  };
  const show = () => {
    if (disabled || open) return;
    setOpen(true);
    const current = rows.findIndex((row) => row.id === value);
    setActive(current < 0 ? 0 : current);
  };
  const activeRow = rows[Math.min(active, rows.length - 1)];
  return (
    <div className="category-picker">
      <label htmlFor={`${id}-value`}>{label}</label>
      <div className="combobox">
        <input
          ref={input}
          id={`${id}-value`}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={
            open && activeRow
              ? `${id}-option-${activeRow.id ?? "none"}`
              : undefined
          }
          autoComplete="off"
          spellCheck={false}
          disabled={disabled}
          placeholder={allowNone ? none : "Choose a category"}
          value={open && query !== null ? query : selectedText}
          onFocus={(event) => {
            show();
            event.currentTarget.select();
          }}
          onClick={show}
          onBlur={close}
          onChange={(event) => {
            setOpen(true);
            setQuery(event.target.value);
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
              // Keep Enter from submitting the surrounding form.
              event.preventDefault();
              if (activeRow) choose(activeRow);
            } else if (event.key === "Escape" && open) {
              event.stopPropagation();
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
            id={listId}
            role="listbox"
            aria-label={`${label} options`}
            className="combobox-list"
          >
            {rows.map((row, index) => (
              // biome-ignore lint/a11y/useFocusableInteractive: options use aria-activedescendant; focus stays on the input.
              // biome-ignore lint/a11y/useKeyWithClickEvents: the combobox input owns keyboard selection.
              <div
                key={row.id ?? "none"}
                id={`${id}-option-${row.id ?? "none"}`}
                role="option"
                aria-selected={row.id === value}
                data-active={index === active || undefined}
                // mousedown fires before blur; prevent it so the click still lands.
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setActive(index)}
                onClick={() => choose(row)}
              >
                {row.text}
              </div>
            ))}
            {rows.length === 0 && (
              <div className="combobox-empty" role="status">
                No matching active categories.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
