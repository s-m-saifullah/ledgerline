import { expect, type Page } from "@playwright/test";

type AccountVerb = "archive" | "unarchive" | "delete";
const verbLabel: Record<AccountVerb, string> = {
  archive: "Archive",
  unarchive: "Unarchive",
  delete: "Delete",
};
const escapeText = (text: string) =>
  text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * An account's row on the Accounts page (ADR 0047). Its accessible name is the account's name, then its hint
 * ("Bank account · USD") and the balance, so the hint's type words tell one name from another that starts with it.
 */
export const accountRow = (page: Page, name: string) =>
  page.getByRole("button", {
    name: new RegExp(
      `^${escapeText(name)} (Bank account|Cash|Credit card|Mobile wallet|Loan|Savings) ·`,
    ),
  });

/** Open an account's sheet from its row; an archived account sits in the fold, so the fold is opened first. */
export async function openAccount(page: Page, name: string) {
  const row = accountRow(page, name);
  if (!(await row.isVisible()))
    await page.locator(".ac-fold > summary").click();
  // The phone's Add button and a toast sit at the bottom right: bring the row to the middle first.
  await row.evaluate((node) => node.scrollIntoView({ block: "center" }));
  await row.click();
  await page.getByRole("dialog", { name: "Edit account" }).waitFor();
}

/** Press Archive, Unarchive or Delete in an account's sheet; the question that follows is the caller's. */
export async function clickAccountAction(
  page: Page,
  verb: AccountVerb,
  name: string,
) {
  await openAccount(page, name);
  await page
    .getByRole("dialog", { name: "Edit account" })
    .getByRole("button", { name: verbLabel[verb], exact: true })
    .click();
  await expect(
    page.getByRole("dialog", {
      name: `${verbLabel[verb]} ${name}?`,
      exact: true,
    }),
  ).toBeVisible();
}
