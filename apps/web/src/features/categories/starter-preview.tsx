import {
  categoryStarterAddOns,
  defaultCategoryStarterSet,
  type StarterGroupKey,
} from "@ledgerline/shared";
import { useEffect, useId, useState } from "react";
import { CategoryMark } from "./appearance";

const kinds = [
  { kind: "income", label: "Income" },
  { kind: "expense", label: "Expenses" },
] as const;

const sections = [
  ...kinds.map(({ kind, label }) => ({
    id: kind,
    label,
    groups: defaultCategoryStarterSet.filter((group) => group.kind === kind),
  })),
  {
    id: "add-ons",
    label: "Optional add-ons (off by default)",
    groups: categoryStarterAddOns,
  },
];

/** Every default group of the starter set, then its optional add-ons; ticking is optional and only used in the dialog. */
export function StarterGroups({
  selected,
  onToggle,
  disabled,
}: {
  selected: ReadonlySet<StarterGroupKey>;
  onToggle: (key: StarterGroupKey) => void;
  disabled: boolean;
}) {
  return (
    <div className="starter-groups">
      {sections.map(({ id, label, groups }) => (
        <section key={id}>
          <h3>{label}</h3>
          <ul className="starter-preview">
            {groups.map((group) => (
              <li key={group.key}>
                <input
                  type="checkbox"
                  id={`starter-${group.key}`}
                  checked={selected.has(group.key)}
                  disabled={disabled}
                  onChange={() => onToggle(group.key)}
                />
                <CategoryMark icon={group.icon} color={group.color} />
                <label htmlFor={`starter-${group.key}`}>
                  {group.name}
                  {group.children.length > 0 && (
                    <small className="muted">
                      {group.children.join(" · ")}
                    </small>
                  )}
                </label>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

/** Primary first-run button; hovering or focusing it lists what will be added. Nothing is created here. */
export function StarterButton({
  disabled,
  onChoose,
}: {
  disabled: boolean;
  onChoose: () => void;
}) {
  const hintId = useId();
  const [shown, setShown] = useState(false);
  // Escape closes the hint wherever focus is, including after a mouse hover.
  useEffect(() => {
    if (!shown) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") setShown(false);
    };
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [shown]);
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: the wrapper only tracks hover and focus for the tooltip; the button inside is the control.
    <div
      className="starter-button-wrap"
      onMouseEnter={() => setShown(true)}
      onMouseLeave={() => setShown(false)}
      onFocus={() => setShown(true)}
      onBlur={() => setShown(false)}
    >
      <button
        type="button"
        className="button"
        aria-describedby={hintId}
        disabled={disabled}
        onClick={() => {
          // The dialog shows the same list; the hint must not float over it.
          setShown(false);
          onChoose();
        }}
      >
        Add starter categories
      </button>
      <div id={hintId} role="tooltip" className="starter-hint" hidden={!shown}>
        <p>These categories will be added after you confirm:</p>
        {kinds.map(({ kind, label }) => (
          <p key={kind}>
            <strong>{label}: </strong>
            {defaultCategoryStarterSet
              .filter((group) => group.kind === kind)
              .map(
                (group) =>
                  group.name +
                  (group.children.length > 0
                    ? ` (${group.children.join(", ")})`
                    : ""),
              )
              .join(" · ")}
          </p>
        ))}
      </div>
    </div>
  );
}
