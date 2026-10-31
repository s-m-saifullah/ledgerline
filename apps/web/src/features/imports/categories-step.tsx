import type { Category } from "@ledgerline/shared";
import { SectionLabel } from "@ledgerline/ui";
import { NativeSelect } from "../../components/native-select";
import { categoryOptions } from "../categories/tree";
import type { Wizard } from "./wizard";

const DEFAULT = "default";

function CategorySelect({
  id,
  label,
  categories,
  kind,
  value,
  onChange,
  withDefault,
}: {
  id: string;
  label: string;
  categories: Category[];
  kind: Category["kind"];
  value: string;
  onChange: (value: string) => void;
  withDefault: boolean;
}) {
  return (
    <div className="imp-field">
      <label className="imp-label" htmlFor={id}>
        {label}
      </label>
      <NativeSelect
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">Choose a category</option>
        {withDefault && (
          <option value={DEFAULT}>Use my default {kind} category</option>
        )}
        {categoryOptions(categories, kind, "").map(
          ({ category, label: text }) => (
            <option key={category.id} value={category.id}>
              {text}
            </option>
          ),
        )}
      </NativeSelect>
    </div>
  );
}

export function CategoriesStep({ w }: { w: Wizard }) {
  const { needs, choices, categories } = w;
  const unmatched = needs.wordings.filter((word) => !word.match);
  const matched = needs.wordings.length - unmatched.length;
  const usesDefault = (kind: "expense" | "income") =>
    needs.blank[kind] > 0 ||
    unmatched.some(
      (word) => word.kind === kind && choices.byWording[word.key] === DEFAULT,
    );
  return (
    <section className="imp-section" aria-labelledby="import-categories-title">
      <SectionLabel as="h2" id="import-categories-title">
        Choose categories
      </SectionLabel>
      <div className="imp-card">
        {unmatched.map((word) => (
          <CategorySelect
            key={word.key}
            id={`cat-${word.key}`}
            label={`“${word.wording}” (${word.rows} ${word.rows === 1 ? "row" : "rows"}, ${word.kind})`}
            categories={categories}
            kind={word.kind}
            value={choices.byWording[word.key] ?? ""}
            withDefault
            onChange={(value) =>
              w.setChoices({
                ...choices,
                byWording: { ...choices.byWording, [word.key]: value },
              })
            }
          />
        ))}
        {(["expense", "income"] as const).map((kind) =>
          usesDefault(kind) ? (
            <CategorySelect
              key={kind}
              id={`default-${kind}`}
              label={`Default ${kind} category`}
              categories={categories}
              kind={kind}
              value={choices.defaults[kind] ?? ""}
              withDefault={false}
              onChange={(value) =>
                w.setChoices({
                  ...choices,
                  defaults: { ...choices.defaults, [kind]: value || null },
                })
              }
            />
          ) : null,
        )}
      </div>
      {w.unresolved.length > 0 ? (
        <p className="imp-note" role="status">
          {w.unresolved.length}{" "}
          {w.unresolved.length === 1 ? "row still needs" : "rows still need"} a
          category.
        </p>
      ) : (
        matched > 0 && (
          <p className="imp-note">
            {matched} {matched === 1 ? "name matched" : "names matched"} one of
            yours.
          </p>
        )
      )}
      <div className="imp-actions">
        <button
          type="button"
          className="ui-btn ui-btn-secondary"
          onClick={() => w.go("columns")}
        >
          Back
        </button>
        <button
          type="button"
          className="ui-btn ui-btn-primary"
          disabled={w.unresolved.length > 0}
          onClick={() => w.go("review")}
        >
          Continue
        </button>
      </div>
    </section>
  );
}
