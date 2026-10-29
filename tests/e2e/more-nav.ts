import { expect, type Page } from "@playwright/test";

/**
 * Opens one of More's pages the way a person does at the current width: a phone and a tablet go through the
 * More tab and its list, a desktop clicks the page in the sidebar (More is not listed there, ADR 0047).
 */
export async function openMorePage(page: Page, name: string) {
  const sidebar = page.getByRole("navigation", { name: "More pages" });
  if (await sidebar.isVisible()) {
    await sidebar.getByRole("link", { name, exact: true }).click();
    return;
  }
  await page
    .getByRole("navigation", { name: /Mobile navigation|Main navigation/ })
    .filter({ visible: true })
    .getByRole("link", { name: "More", exact: true })
    .click();
  await page.getByRole("link", { name: new RegExp(`^${name}`) }).click();
}

/** Checks that the page is the current one: its sidebar link on a desktop, the More tab elsewhere. */
export async function expectMorePageCurrent(page: Page, name: string) {
  const sidebar = page.getByRole("navigation", { name: "More pages" });
  if (await sidebar.isVisible())
    await expect(
      sidebar.getByRole("link", { name, exact: true }),
    ).toHaveAttribute("aria-current", "page");
  else
    await expect(
      page
        .getByRole("navigation", { name: /Mobile navigation|Main navigation/ })
        .filter({ visible: true })
        .getByRole("link", { name: "More", exact: true }),
    ).toHaveAttribute("aria-current", "page");
}

/**
 * Moves to some other page without reloading, to prove that something survives a change of screen. Budgets
 * is a tab at every width and has the phone's Add button, which More does not.
 */
export async function leaveForAnotherPage(page: Page) {
  await page
    .getByRole("navigation", { name: /Mobile navigation|Main navigation/ })
    .filter({ visible: true })
    .getByRole("link", { name: "Budgets", exact: true })
    .click();
  await expect(page).toHaveURL(/\/budgets$/);
}
