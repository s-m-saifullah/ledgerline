import type { Category } from "@ledgerline/shared";
import { type ComboCreate, ComboField } from "../../components/combo-field";
import { categoryOptions } from "../categories/tree";

/**
 * The category field of an entry: type to narrow the list, and a name nobody has yet offers to create it. A
 * choice is required, so there is no "All" row. A chosen category that is no longer in the list (archived)
 * still shows its name.
 */
export function CategoryCombo({
  categories,
  kind,
  value,
  onChange,
  label = "Category",
  create,
}: {
  categories: readonly Category[];
  kind: Category["kind"];
  value: string | null;
  onChange: (id: string) => void;
  label?: string;
  create?: ComboCreate | undefined;
}) {
  const options = categoryOptions(categories, kind, "").map((option) => ({
    id: option.category.id,
    label: option.label,
  }));
  const chosen = categories.find((row) => row.id === value);
  const selectedLabel =
    chosen && !options.some((option) => option.id === chosen.id)
      ? `${chosen.name}${chosen.archivedAt ? " (archived)" : " (current selection)"}`
      : undefined;
  return (
    <ComboField
      label={label}
      allLabel="Choose a category"
      emptyText="No matching active categories."
      clearable={false}
      options={options}
      value={value}
      onChange={(id) => id && onChange(id)}
      creates={create ? [create] : []}
      selectedLabel={selectedLabel}
    />
  );
}
