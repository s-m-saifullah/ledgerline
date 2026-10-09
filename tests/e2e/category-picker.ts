import type { Locator, Page } from "@playwright/test";

type Scope = Page | Locator;

/** Open a category combobox, optionally type a filter, and pick the option whose label (or last path part) matches. */
export async function chooseCategory(
  scope: Scope,
  label: string,
  name: string,
  filter = "",
) {
  const box = scope.getByLabel(label, { exact: true });
  await box.click();
  if (filter) await box.fill(filter);
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  await scope
    .getByRole("listbox", { name: `${label} options`, exact: true })
    .getByRole("option")
    .filter({ hasText: new RegExp(`(^|/ )${escaped}$`) })
    .click();
}

/** Open the combobox and return every option label, then close it again. */
export async function categoryOptionLabels(scope: Scope, label: string) {
  const box = scope.getByLabel(label, { exact: true });
  await box.click();
  const labels = await scope
    .getByRole("listbox", { name: `${label} options`, exact: true })
    .getByRole("option")
    .allTextContents();
  await box.press("Escape");
  return labels;
}
