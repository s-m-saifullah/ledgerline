import { expect, test } from "@playwright/test";
import { signIn } from "./sign-in";

// These tests sign out and check the sign-in form, so they start signed out, not from the shared session.
test.use({ storageState: { cookies: [], origins: [] } });

test("an expired or missing session falls back to the real sign-in form", async ({
  page,
}) => {
  await signIn(page);
  await page.context().clearCookies();
  await signIn(page);
  await expect(
    page.getByRole("heading", { name: "Home", exact: true }),
  ).toBeVisible();
});

test("owner signs in, navigates, changes theme, and signs out", async ({
  page,
}, testInfo) => {
  await page.emulateMedia({ colorScheme: "light" });
  await signIn(page);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page
    .getByRole("button", { name: "Switch to light theme", exact: true })
    .click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.emulateMedia({ colorScheme: "light" });
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page
    .getByRole("button", { name: "Switch to dark theme", exact: true })
    .click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator(".sidebar")).not.toContainText("Personal ledger");
  await page.getByRole("button", { name: "Hide amounts" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-privacy", "true");
  const navigation = page.getByRole("navigation", {
    name:
      testInfo.project.name === "mobile"
        ? "Mobile navigation"
        : "Main navigation",
    exact: true,
  });
  await navigation.getByRole("link", { name: "Budgets" }).click();
  await expect(
    page.getByRole("heading", { name: "Budgets", exact: true }),
  ).toBeVisible();
  if (testInfo.project.name === "desktop") {
    await page.keyboard.press("Meta+k");
    await expect(page.getByRole("dialog")).toBeVisible();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Home", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Home", exact: true }),
    ).toBeVisible();
  }
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(
    page.getByRole("button", { name: "Switch to light theme", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page
    .getByRole("button", { name: "Sign out", exact: true })
    .filter({ visible: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Welcome back" }),
  ).toBeVisible();
  await page.goto("/budgets");
  await expect(
    page.getByRole("heading", { name: "Welcome back" }),
  ).toBeVisible();
});

test("Appearance setting can return to the system theme", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await signIn(page);
  await page
    .getByRole("button", { name: "Switch to dark theme", exact: true })
    .click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.goto("/more");
  const theme = page.getByRole("group", { name: "Theme" });
  await expect(theme.getByRole("radio", { name: "Dark" })).toBeChecked();
  await theme.getByRole("radio", { name: "System" }).check();
  // Following the system again: light now, dark when the device switches.
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await theme.getByRole("radio", { name: "Light" }).check();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(
    page
      .getByRole("group", { name: "Theme" })
      .getByRole("radio", { name: "Light" }),
  ).toBeChecked();
});

test("command palette filters pages and actions and runs them from the keyboard", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name === "mobile",
    "Palette is a keyboard feature",
  );
  await page.emulateMedia({ colorScheme: "light" });
  await signIn(page);
  await page.keyboard.press("Control+k");
  const dialog = page.getByRole("dialog");
  const search = dialog.getByLabel("Search pages and actions");
  await expect(search).toBeFocused();
  await search.fill("peo");
  await expect(
    dialog.getByRole("group", { name: "Results" }).getByRole("button"),
  ).toHaveText([/People/]);
  await search.fill("zzzz");
  await expect(dialog.getByText("Nothing matches")).toBeVisible();
  await search.fill("theme: dark");
  await search.press("Enter");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.keyboard.press("Control+k");
  await search.fill("hide");
  await search.press("ArrowDown");
  await expect(
    dialog.getByRole("button", { name: "Hide amounts" }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("html")).toHaveAttribute("data-privacy", "true");
  await page.keyboard.press("Control+k");
  await dialog.getByLabel("Search pages and actions").fill("show");
  await page.keyboard.press("Enter");
  await expect(page.locator("html")).toHaveAttribute("data-privacy", "false");
  await page.keyboard.press("Control+k");
  await dialog.getByLabel("Search pages and actions").fill("people");
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("heading", { name: "People", exact: true }),
  ).toBeVisible();
});
