import { zodResolver } from "@hookform/resolvers/zod";
import {
  type Category,
  type CreateCategory,
  createCategorySchema,
} from "@ledgerline/shared";
import { Button } from "@ledgerline/ui";
import { useEffect, useRef, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { EditorDialog } from "../../components/editor-dialog";
import { NativeSelect } from "../../components/native-select";
import { ApiError } from "../../lib/api";
import { getCategories, getCategory, prepareCategorySave } from "./api";
import { CategoryMark, categoryColors, categoryIcons } from "./appearance";
import { CategoryPicker } from "./picker";

const categoryFormSchema = createCategorySchema.extend({
  parentId: createCategorySchema.shape.parentId.removeDefault(),
  icon: createCategorySchema.shape.icon.removeDefault(),
  color: createCategorySchema.shape.color.removeDefault(),
});
function defaults(
  category?: Category,
  kind: Category["kind"] = "expense",
): CreateCategory {
  return {
    name: category?.name ?? "",
    kind: category?.kind ?? kind,
    parentId: category?.parentId ?? null,
    icon: category?.icon ?? null,
    color: category?.color ?? null,
  };
}
export function CategoryEditor({
  ledgerId,
  category,
  categories,
  kind,
  open,
  onDismiss,
  onUnconfirmed,
  onSaved,
}: {
  ledgerId: string;
  category?: Category | undefined;
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
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<CreateCategory>({
    resolver: zodResolver(categoryFormSchema),
    defaultValues: defaults(category, kind),
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
  return (
    <EditorDialog
      open={open}
      title={baseline ? "Edit category" : "Add category"}
      description={
        baseline
          ? "Update its name, parent, icon or color. Archived labels stay available in your history."
          : "Choose a name for money coming in or going out."
      }
      busy={busy}
      onDismiss={onDismiss}
      returnFocusId={
        baseline ? `edit-category-${baseline.id}` : "categories-title"
      }
      closeLabel="Close category dialog"
      fallbackFocusId="categories-title"
    >
      <form onSubmit={submit} noValidate>
        <fieldset
          disabled={busy || uncertain || conflict}
          className="account-fields category-fields"
        >
          <label htmlFor="category-name">Category name</label>
          <input
            id="category-name"
            autoComplete="off"
            maxLength={100}
            aria-invalid={!!errors.name}
            aria-describedby={errors.name ? "category-name-error" : undefined}
            {...register("name")}
          />
          {errors.name && (
            <p className="field-error" id="category-name-error">
              Give this category a name (up to 100 characters).
            </p>
          )}
          <label htmlFor="category-kind">Category kind</label>
          <NativeSelect
            id="category-kind"
            disabled={!!baseline}
            {...register("kind")}
            onChange={(event) => {
              register("kind").onChange(event);
              reset({
                ...values,
                kind: event.target.value as Category["kind"],
                parentId: null,
              });
            }}
          >
            <option value="expense">Expense</option>
            <option value="income">Income</option>
          </NativeSelect>
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
                disabled={busy || uncertain || conflict || hasChildren}
              />
            )}
          />
          {hasChildren && (
            <p className="form-help">
              Move this category's children before choosing a parent.
            </p>
          )}
          <label htmlFor="category-icon">Category icon</label>
          <NativeSelect
            id="category-icon"
            {...register("icon", { setValueAs: (value) => value || null })}
            value={values.icon ?? ""}
          >
            <option value="">No icon</option>
            {values.icon && !Object.hasOwn(categoryIcons, values.icon) && (
              <option value={values.icon}>Current icon ({values.icon})</option>
            )}
            {Object.entries(categoryIcons).map(([value, item]) => (
              <option key={value} value={value}>
                {item.label}
              </option>
            ))}
          </NativeSelect>
          <label htmlFor="category-color">Category color</label>
          <NativeSelect
            id="category-color"
            {...register("color", { setValueAs: (value) => value || null })}
            value={values.color ?? ""}
          >
            <option value="">No color</option>
            {values.color &&
              !categoryColors.some((color) => color.value === values.color) && (
                <option value={values.color}>
                  Current color ({values.color})
                </option>
              )}
            {categoryColors.map((color) => (
              <option key={color.value} value={color.value}>
                {color.label}
              </option>
            ))}
          </NativeSelect>
          <div className="category-preview">
            <CategoryMark icon={values.icon} color={values.color} />
            <span>{values.name.trim() || "Category preview"}</span>
          </div>
        </fieldset>
        {error && (
          <p className="field-error account-error" role="alert">
            {error}
          </p>
        )}
        <div className="account-dialog-actions">
          <button
            type="button"
            className="secondary-button"
            disabled={busy}
            onClick={onDismiss}
          >
            {uncertain ? "Close for now" : "Cancel"}
          </button>
          {conflict ? (
            <Button type="button" disabled={busy} onClick={() => void reload()}>
              {reloading ? "Reloading…" : "Reload latest details"}
            </Button>
          ) : (
            <Button type="submit" disabled={busy}>
              {isSubmitting
                ? "Saving…"
                : uncertain
                  ? "Retry save"
                  : baseline
                    ? "Save changes"
                    : "Add category"}
            </Button>
          )}
        </div>
      </form>
    </EditorDialog>
  );
}
