import { expect, type Locator, type Page } from "@playwright/test";

const clientMenu = new Set([
  "Edit client",
  "Archive client",
  "Unarchive client",
  "Delete client",
]);

/** The clients in the list, one link each (ADR 0047); `name` picks one. */
export const clientLink = (page: Page, name?: string): Locator => {
  const links = page.locator('a[id^="client-"]');
  return name ? links.filter({ hasText: name }) : links;
};

/** A service's row under the client card; opening it shows its sheet. */
export const serviceRow = (
  page: Page,
  description: string | RegExp = "Website work",
) => page.locator("button.ui-row").filter({ hasText: description });

/** Open a service's sheet (or return it if it is open), where its payments and actions are. */
export async function openService(
  page: Page,
  description: string | RegExp = "Website work",
) {
  const sheet = page.getByRole("dialog", { name: description, exact: true });
  if (!(await sheet.isVisible())) {
    await serviceRow(page, description).first().click();
    await sheet.waitFor();
  }
  return sheet;
}

/** Close a sheet with its Cancel button and wait until it is gone. */
export async function closeSheet(sheet: Locator) {
  await sheet.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(sheet).toHaveCount(0);
}

/**
 * Click a Clients action wherever it lives: Log service on the card (or a phone's one Add button), the client
 * actions in the card's menu sheet, a payment from the client on the card, and a service's own actions in the
 * service's sheet.
 */
export async function clickAction(page: Page, name: string) {
  if (name === "Log service")
    // The card's button on a page from 700 px, the shell's one Add button below it: only one is on screen.
    return page
      .locator("#log-service:visible, #mobile-add-page:visible")
      .first()
      .click();
  if (name.startsWith("Record payment from"))
    return page.locator("#record-client-payment").click();
  if (clientMenu.has(name)) {
    await page
      .locator(".cl-card")
      .getByRole("button", { name: /^More actions for/ })
      .click();
    return page
      .getByRole("dialog")
      .getByRole("button", { name, exact: true })
      .click();
  }
  const sheet = await openService(page);
  return sheet.getByRole("button", { name, exact: true }).click();
}
