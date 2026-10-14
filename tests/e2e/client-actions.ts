import type { Page } from "@playwright/test";

const clientActions = new Set([
  "Log service",
  "Edit client",
  "Archive client",
  "Unarchive client",
  "Delete client",
]);

/** Click a Clients action: inline on wide screens, from the "more actions" menu on phones. */
export async function clickAction(page: Page, name: string) {
  const inline = page
    .getByRole("button", { name, exact: true })
    .filter({ visible: true });
  const trigger = page
    .getByRole("button", {
      name:
        clientActions.has(name) || name.startsWith("Record payment from")
          ? /^More actions for (?!Website work)/
          : /^More actions for Website work/,
    })
    .first();
  // Wait for the action bar to render in either layout before choosing.
  await inline.or(trigger).first().waitFor();
  if ((await inline.count()) > 0) return inline.first().click();
  await trigger.click();
  await page.getByRole("menuitem", { name, exact: true }).click();
}
