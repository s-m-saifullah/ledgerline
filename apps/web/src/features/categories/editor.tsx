import { zodResolver } from "@hookform/resolvers/zod";
import {
  type Category,
  type CreateCategory,
  createCategorySchema,
} from "@ledgerline/shared";
import { SegmentedControl } from "@ledgerline/ui";
import { Circle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { Overlay } from "../../components/overlay";
import { ApiError } from "../../lib/api";
import { getCategories, getCategory, prepareCategorySave } from "./api";
import { categoryColors, categoryIcons } from "./appearance";
import { AppearanceRow, NoneMark, Swatch } from "./appearance-row";
import { CategoryPicker } from "./picker";
import "./categories.css";

const categoryFormSchema = createCategorySchema.extend({
  parentId: createCategorySchema.shape.parentId.removeDefault(),
  icon: createCategorySchema.shape.icon.removeDefault(),
  color: createCategorySchema.shape.color.removeDefault(),
});
function defaults(
  category?: Category,
  kind: Category["kind"] = "expense",
  parentId: string | null = null,
): CreateCategory {
  return {
    name: category?.name ?? "",
    kind: category?.kind ?? kind,
    parentId: category ? category.parentId : parentId,
    icon: category?.icon ?? null,
    color: category?.color ?? null,
  };
}
export function CategoryEditor({
  ledgerId,
  category,
  parentId,
  categories,
  kind,
  open,
  onDismiss,
  onUnconfirmed,
  onSaved,
}: {
  ledgerId: string;
  category?: Category | undefined;
  /** A new subcategory starts under this main category. */
  parentId?: string | undefined;
  categories: Category[];
  kind: Category["kind"];
  open: boolean;
  onDismiss: () => void;
  onUnconfirmed: (value: boolean) => void;
  onSaved: (category: Category) => void;
}) {
  const [baseline, setBaseline] = useState(category);
  const [options, setOptions] = useState(categories);
  const [uncertain, setUncertain] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [reloading, setReloading] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!uncertain && !conflict) setOptions(categories);
  }, [categories, uncertain, conflict]);
  const attempt = useRef<(() => Promise<Category>) | null>(null);
  const inFlight = useRef(false);
  const {
    register,
    control,
    watch,
    reset,
    setValue,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<CreateCategory>({
    resolver: zodResolver(categoryFormSchema),
    defaultValues: defaults(
      category,
      categories.find((row) => row.id === parentId)?.kind ?? kind,
      parentId ?? null,
    ),
  });
  const values = watch();
  const hasChildren =
    !!baseline && options.some((row) => row.parentId === baseline.id);
  const busy = isSubmitting || reloading;
  const submit = handleSubmit(async (body) => {
    if (inFlight.current || conflict) return;
    inFlight.current = true;
    setError("");
    attempt.current ??= prepareCategorySave(ledgerId, baseline, body);
    try {
      const saved = await attempt.current();
      onUnconfirmed(false);
      onSaved(saved);
    } catch (failure) {
      if (!(failure instanceof ApiError) || failure.status >= 500) {
        setUncertain(true);
        onUnconfirmed(true);
        setError(
          "We couldn't confirm the save. Retry to confirm the same action.",
        );
      } else {
        attempt.current = null;
        setUncertain(false);
        onUnconfirmed(false);
        if (
          failure.status === 409 &&
          failure.fields.some((field) => field.field === "expectedVersion")
        ) {
          setConflict(true);
          setError(
            "This category changed. Reload its latest details before saving again. Reloading replaces this form.",
          );
        } else setError(failure.message);
      }
    } finally {
      inFlight.current = false;
    }
  });
  const reload = async () => {
    if (!baseline) return;
    setReloading(true);
    try {
      const [latest, items] = await Promise.all([
        getCategory(ledgerId, baseline.id),
        getCategories(ledgerId),
      ]);
      setBaseline(latest);
      setOptions(items);
      reset(defaults(latest));
      attempt.current = null;
      setConflict(false);
      setError("");
    } catch {
      setError("Couldn't reload this category. Please try again.");
    } finally {
      setReloading(false);
    }
  };
  const frozen = busy || uncertain || conflict;
  return (
    <Overlay
      open={open}
      title={baseline ? "Edit category" : "Add category"}
      description={
        baseline
          ? "Update its name, parent, icon or color. Archived labels stay available in your history."
          : "Choose a name for money coming in or going out."
      }
      busy={busy}
      onDismiss={onDismiss}
      cancelLabel={uncertain ? "Close for now" : "Cancel"}
      returnFocusId={
        baseline ? `edit-category-${baseline.id}` : "categories-title"
      }
      fallbackFocusId="categories-title"
      initialFocusId="category-name"
      footer={
        conflict ? (
          <button
            type="button"
            className="ui-btn ui-btn-primary"
            disabled={busy}
            onClick={() => void reload()}
          >
            {reloading ? "Reloading…" : "Reload latest details"}
          </button>
        ) : (
          <button
            type="submit"
            form="category-form"
            className="ui-btn ui-btn-primary"
            disabled={busy}
          >
            {isSubmitting ? "Saving…" : uncertain ? "Retry save" : "Save"}
          </button>
        )
      }
    >
      <form id="category-form" className="cg-form" onSubmit={submit} noValidate>
        <fieldset disabled={frozen} className="cg-fields">
          <SegmentedControl
            label="Category kind"
            value={values.kind}
            disabled={!!baseline}
            onChange={(value) => {
              setValue("kind", value);
              setValue("parentId", null);
            }}
            options={[
              { value: "expense", label: "Expense" },
              { value: "income", label: "Income" },
            ]}
          />
          <div className="cg-field">
            <label htmlFor="category-name">Category name</label>
            <input
              id="category-name"
              autoComplete="off"
              maxLength={100}
              placeholder="Name"
              aria-invalid={!!errors.name}
              aria-describedby={errors.name ? "category-name-error" : undefined}
              {...register("name")}
            />
            {errors.name && (
              <p className="field-error" id="category-name-error">
                Give this category a name (up to 100 characters).
              </p>
            )}
          </div>
          <div className="cg-field">
            <Controller
              name="parentId"
              control={control}
              render={({ field }) => (
                <CategoryPicker
                  categories={options}
                  kind={values.kind}
                  rootsOnly
                  allowNone
                  excludeId={baseline?.id}
                  label="Parent category"
                  value={field.value}
                  onChange={field.onChange}
                  disabled={frozen || hasChildren}
                />
              )}
            />
            {hasChildren && (
              <p className="cg-note">
                Move this category's children before choosing a parent.
              </p>
            )}
          </div>
          <div className="cg-group-card">
            <AppearanceRow
              id="category-icon"
              label="Category icon"
              value={values.icon ?? ""}
              options={[
                { value: "", label: "No icon", visual: <NoneMark /> },
                ...(values.icon && !Object.hasOwn(categoryIcons, values.icon)
                  ? [
                      {
                        value: values.icon,
                        label: `Current icon (${values.icon})`,
                        visual: <Circle size={20} aria-hidden="true" />,
                      },
                    ]
                  : []),
                ...Object.entries(categoryIcons).map(([value, item]) => {
                  const Icon = item.icon;
                  return {
                    value,
                    label: item.label,
                    visual: <Icon size={20} aria-hidden="true" />,
                  };
                }),
              ]}
              onChange={(value) => setValue("icon", value || null)}
            />
            <AppearanceRow
              id="category-color"
              label="Category color"
              value={values.color ?? ""}
              options={[
                {
                  value: "",
                  label: "No color",
                  visual: <Swatch color={null} />,
                },
                ...(values.color &&
                !categoryColors.some((color) => color.value === values.color)
                  ? [
                      {
                        value: values.color,
                        label: `Current color (${values.color})`,
                        visual: <Swatch color={values.color} />,
                      },
                    ]
                  : []),
                ...categoryColors.map((color) => ({
                  value: color.value,
                  label: color.label,
                  visual: <Swatch color={color.value} />,
                })),
              ]}
              onChange={(value) => setValue("color", value || null)}
            />
          </div>
        </fieldset>
        {error && (
          <p className="field-error" role="alert">
            {error}
          </p>
        )}
      </form>
    </Overlay>
  );
}
