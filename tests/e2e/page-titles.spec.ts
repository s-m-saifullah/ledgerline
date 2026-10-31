import { expect, test } from "@playwright/test";
import { signIn } from "./sign-in";

// ADR 0040: each screen has its own title, and changing screens moves focus to the heading and announces it.
test("each screen has its own title and a screen change moves focus to its heading", async ({
  page,
}, testInfo) => {
  await signIn(page);
  await expect(page).toHaveTitle("Home · Ledgerline");
  // The first load does not announce anything.
  await expect(page.locator("p.sr-only[aria-live=polite]")).toBeEmpty();
  const nav = page.getByRole("navigation", {
    name:
      testInfo.project.name === "mobile"
        ? "Mobile navigation"
        : "Main navigation",
  });
  await nav.getByRole("link", { name: "Budgets" }).click();
  await expect(page).toHaveTitle("Budgets · Ledgerline");
  await expect(page.getByRole("heading", { level: 1 })).toBeFocused();
  await expect(page.locator("p.sr-only[aria-live=polite]")).toHaveText(
    "Budgets",
  );
  await nav.getByRole("link", { name: "Transactions" }).click();
  await expect(page).toHaveTitle("Transactions · Ledgerline");
  await expect(page.getByRole("heading", { level: 1 })).toBeFocused();
  for (const [path, title] of [
    ["/settings", "Settings"],
    ["/accounts", "Accounts"],
    ["/import", "Import and export"],
  ] as const) {
    await page.goto(path);
    await expect(page).toHaveTitle(`${title} · Ledgerline`);
  }
});

test("opening a dialog on a screen keeps focus in the dialog", async ({
  page,
}) => {
  await signIn(page);
  await page.goto("/transactions");
  await page
    .getByRole("button", { name: /Add transaction/ })
    .first()
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.waitForTimeout(300);
  expect(
    await page.evaluate(
      () => !!document.activeElement?.closest("[role=dialog]"),
    ),
  ).toBe(true);
});

test.describe("signed out", () => {
  test.use({ storageState: { cookies: [], origins: [] } });
  test("the sign-in screen has its own title", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle("Sign in · Ledgerline");
  });
});
