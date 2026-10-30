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

/** Press Apply and wait for the sheet to close. */
export async function applyFilters(dialog: Locator) {
  await dialog.getByRole("button", { name: "Apply", exact: true }).click();
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
