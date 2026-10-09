import type { Category } from "@ledgerline/shared";
import { useContext } from "react";
import { type UseFormReturn, useFieldArray } from "react-hook-form";
import { CategoryPicker } from "../categories/picker";
import { PrivacyContext } from "../shell/preferences";
import type { TransactionFormValues } from "./form";
export function SplitFields({
  form,
  categories,
  kind,
}: {
  form: UseFormReturn<TransactionFormValues>;
  categories: readonly Category[];
  kind: "expense" | "income";
}) {
  const { fields, append, remove, replace } = useFieldArray({
    control: form.control,
    name: "splits",
    keyName: "fieldKey",
  });
  const enabled = form.watch("splitEnabled");
  const privateMode = useContext(PrivacyContext);
  return (
    <>
      <label className="split-toggle">
        <input
          type="checkbox"
          checked={!!enabled}
          onChange={(event) => {
            form.setValue("splitEnabled", event.target.checked);
            if (event.target.checked && fields.length < 2)
              replace([
                {
                  categoryId: form.getValues("categoryId"),
                  amount: "",
                  note: "",
                },
                { categoryId: "", amount: "", note: "" },
              ]);
          }}
        />{" "}
        Split across categories
      </label>
      {enabled && (
        <div className="split-lines">
          <p className="form-help">
            Allocate the full amount across 2–50 lines. Every line has the
            entry’s direction.
          </p>
          {fields.map((field, index) => (
            <fieldset
              key={field.fieldKey}
              className="account-fields split-line"
            >
              <legend>Split {index + 1}</legend>
              <CategoryPicker
                label={`Split ${index + 1} category`}
                categories={categories}
                kind={kind}
                value={form.watch(`splits.${index}.categoryId`) ?? null}
                onChange={(id) =>
                  form.setValue(`splits.${index}.categoryId`, id ?? "")
                }
              />
              {form.formState.errors.splits?.[index]?.categoryId && (
                <p className="field-error">Choose a category.</p>
              )}
              <label htmlFor={`split-amount-${index}`}>
                Split {index + 1} amount (USD)
              </label>
              <input
                id={`split-amount-${index}`}
                type={privateMode ? "password" : "text"}
                inputMode="decimal"
                autoComplete="off"
                {...form.register(`splits.${index}.amount`)}
              />
              {form.formState.errors.splits?.[index]?.amount && (
                <p className="field-error">
                  Enter a positive exact USD amount.
                </p>
              )}
              <label htmlFor={`split-note-${index}`}>
                Split {index + 1} note
              </label>
              <input
                id={`split-note-${index}`}
                maxLength={2000}
                {...form.register(`splits.${index}.note`)}
              />
              <button
                type="button"
                className="quiet-button"
                disabled={fields.length <= 2}
                aria-label={`Remove split ${index + 1}`}
                onClick={() => remove(index)}
              >
                Remove line
              </button>
            </fieldset>
          ))}
          {(form.formState.errors.splits?.message ??
            form.formState.errors.splits?.root?.message) && (
            <p role="alert" className="field-error">
              {form.formState.errors.splits?.message ??
                form.formState.errors.splits?.root?.message}
            </p>
          )}
          <button
            type="button"
            className="secondary-button"
            disabled={fields.length >= 50}
            onClick={() => append({ categoryId: "", amount: "", note: "" })}
          >
            Add split line
          </button>
        </div>
      )}
    </>
  );
}
