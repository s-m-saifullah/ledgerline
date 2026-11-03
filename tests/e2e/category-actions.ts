import { expect, type Page } from "@playwright/test";

type CategoryVerb =
  | "up"
  | "down"
  | "merge"
  | "edit"
  | "archive"
  | "unarchive"
  | "delete";

/** The words on the actions sheet's rows (ADR 0047); a row that is unavailable adds its reason after them. */
const rowLabel: Record<CategoryVerb, string> = {
  up: "Move up",
  down: "Move down",
  merge: "Merge into…",
  edit: "Edit",
  archive: "Archive",
  unarchive: "Unarchive",
  delete: "Delete",
};
const sheet = (page: Page, name: string) =>
  page.getByRole("dialog", { name, exact: true });
const row = (page: Page, verb: CategoryVerb, name: string) =>
  sheet(page, name).getByRole("button", {
    name: new RegExp(`^${rowLabel[verb]}`),
  });

/** Open a category's actions sheet; a subcategory is shown once its group is open, so everything is expanded first. */
export async function openCategoryActions(page: Page, name: string) {
  const button = page.getByRole("button", {
    name: `Actions for ${name}`,
    exact: true,
  });
  if ((await button.count()) === 0) {
    const expand = page.getByRole("button", {
      name: "Expand all",
      exact: true,
    });
    if (await expand.count()) await expand.click();
  }
  // The phone's Add button and an Undo toast sit at the bottom right, over a row's right-hand button that
  // has scrolled to the screen's edge: bring it to the middle first, as a person would.
  await button.evaluate((node) => node.scrollIntoView({ block: "center" }));
  await button.click();
  await sheet(page, name).waitFor();
}

/** Click a category action in its actions sheet. */
export async function clickCategoryAction(
  page: Page,
  verb: CategoryVerb,
  name: string,
) {
  await openCategoryActions(page, name);
  await row(page, verb, name).click();
}

/** Check a category action's state: its sheet opens and closes again. */
export async function expectCategoryAction(
  page: Page,
  verb: CategoryVerb,
  name: string,
  state: "enabled" | "disabled" | "visible",
) {
  await openCategoryActions(page, name);
  const target = row(page, verb, name);
  if (state === "enabled") await expect(target).toBeEnabled();
  else if (state === "disabled") await expect(target).toBeDisabled();
  else await expect(target).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(sheet(page, name)).toHaveCount(0);
}
