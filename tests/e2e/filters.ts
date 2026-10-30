import { expect, type Locator, type Page } from "@playwright/test";

/** One row of the Transactions list (a transfer is one row, not two). */
export const rows = (page: Page) => page.locator(".tx-row");

/** Open the Filters sheet (a sheet on a phone, a drawer from 700 px). */
export async function openFilters(page: Page): Promise<Locator> {
  await page.getByRole("button", { name: /^Filters/ }).click();
  const dialog = page.getByRole("dialog", { name: "Filters" });
  await expect(dialog).toBeVisible();
  return dialog;
}

/** Pick a name in one of the sheet's combo boxes (Account, Category or Tag): open it, then click the option. */
export async function chooseFilter(
  dialog: Locator,
  field: "Account" | "Category" | "Tag",
  name: string,
) {
  await dialog.getByRole("combobox", { name: field, exact: true }).click();
  await dialog.getByRole("option", { name, exact: true }).click();
}

/** Close the sheet with Done; what was chosen has already been applied. */
export async function closeFilters(dialog: Locator) {
  await dialog.getByRole("button", { name: "Done", exact: true }).click();
  await expect(dialog).toBeHidden();
}

/** Choose one of the entry-type chips (All, Expenses, Income, Transfers). */
export async function chooseKind(page: Page, name: string) {
  await page
    .getByRole("group", { name: "Entry type" })
    .getByRole("button", { name, exact: true })
    .click();
}

/** Type in the search box and apply it at once, as Enter does. */
export async function searchFor(page: Page, text: string) {
  const box = page.getByLabel("Search payer, payee or note");
  await box.fill(text);
  await box.press("Enter");
}
