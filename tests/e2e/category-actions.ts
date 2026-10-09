import { expect, type Page } from "@playwright/test";

export type CategoryVerb =
  | "up"
  | "down"
  | "merge"
  | "edit"
  | "archive"
  | "unarchive"
  | "delete";

const menuLabel: Record<CategoryVerb, string> = {
  up: "Move up",
  down: "Move down",
  merge: "Merge into another category",
  edit: "Edit category",
  archive: "Archive category",
  unarchive: "Unarchive category",
  delete: "Delete category",
};
const phone = (page: Page) => (page.viewportSize()?.width ?? 1280) <= 700;
const buttonLabel = (verb: CategoryVerb, name: string) =>
  verb === "up"
    ? `Move ${name} up`
    : verb === "down"
      ? `Move ${name} down`
      : `${verb[0]?.toUpperCase()}${verb.slice(1)} ${name}`;
const control = (page: Page, verb: CategoryVerb, name: string) =>
  phone(page)
    ? page.getByRole("menuitem", { name: menuLabel[verb], exact: true })
    : page.getByRole("button", { name: buttonLabel(verb, name), exact: true });
const openMenu = async (page: Page, name: string) => {
  if (phone(page))
    await page
      .getByRole("button", { name: `Actions for ${name}`, exact: true })
      .click();
};

/** Click a category action: an inline button on wide screens, a row-menu item on phones. */
export async function clickCategoryAction(
  page: Page,
  verb: CategoryVerb,
  name: string,
) {
  await openMenu(page, name);
  await control(page, verb, name).click();
}

/** Check a category action's state; on phones this opens the row menu and closes it again. */
export async function expectCategoryAction(
  page: Page,
  verb: CategoryVerb,
  name: string,
  state: "enabled" | "disabled" | "visible",
) {
  await openMenu(page, name);
  const target = control(page, verb, name);
  if (state === "enabled") await expect(target).toBeEnabled();
  else if (state === "disabled") await expect(target).toBeDisabled();
  else await expect(target).toBeVisible();
  if (phone(page)) await page.keyboard.press("Escape");
}
