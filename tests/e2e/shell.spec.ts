import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

// The shell of the web redesign (ADR 0047, PR 3): a bottom bar and one Add button on a phone, an icon rail from
// 700 px, a sidebar that also lists More's pages from 1100 px, and a top bar of global tools. The widths are
// the container's, so they are tested here in a real browser at the edges. These tests set their own widths,
// so one project is enough.
test.beforeEach(({ browserName: _browser }, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop",
    "one project is enough: these tests set their own widths",
  );
});

async function at(page: Page, width: number, path = "/", height = 800) {
  await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "light" });
  await page.setViewportSize({ width, height });
  await page.goto(path);
  await expect(page.locator("main h1")).toBeAttached();
  // In development the stylesheets are injected after the first paint; measure only once they are in.
  await page.waitForFunction(
    () => getComputedStyle(document.body).containerType === "inline-size",
  );
}
const rect = (page: Page, selector: string) =>
  page
    .locator(selector)
    .first()
    .evaluate((node) => {
      const r = node.getBoundingClientRect();
      return {
        left: r.left,
        right: r.right,
        top: r.top,
        bottom: r.bottom,
        width: r.width,
        height: r.height,
      };
    });
const addButton = (page: Page) =>
  page.getByRole("button", { name: "Add transaction", exact: true });

test.describe("a phone, under 700 px", () => {
  test("has a top bar, the five tabs and one Add button at the bottom right above the bar", async ({
    page,
  }) => {
    await at(page, 390);
    await expect(
      page.getByRole("navigation", { name: "Mobile navigation" }),
    ).toBeVisible();
    await expect(
      page.getByRole("navigation", { name: "Main navigation" }),
    ).toBeHidden();
    await expect(page.locator(".ui-topbar-title")).toHaveText("Home");
    const fab = await rect(page, "#mobile-add-transaction");
    const bar = await rect(page, "nav[aria-label='Mobile navigation']");
    await expect(addButton(page)).toHaveCount(1);
    expect(fab.right).toBeGreaterThanOrEqual(390 - 24);
    expect(fab.right).toBeLessThanOrEqual(390 - 12);
    expect(fab.bottom).toBeLessThan(bar.top);
    expect(bar.top - fab.bottom).toBeLessThanOrEqual(24);
    expect(fab.width).toBeGreaterThanOrEqual(44);
    expect(fab.height).toBeGreaterThanOrEqual(44);
  });

  test("shows no breadcrumb", async ({ page }) => {
    await at(page, 390);
    await expect(
      page.locator("header").getByText("Personal ledger"),
    ).toHaveCount(0);
  });

  for (const path of ["/more", "/settings", "/import"])
    test(`has no Add button on ${path}`, async ({ page }) => {
      await at(page, 390, path);
      await expect(page.locator("#mobile-add-transaction")).toBeHidden();
    });

  for (const path of [
    "/",
    "/transactions",
    "/budgets",
    "/insights",
    "/accounts",
  ])
    test(`adds a transaction from ${path}`, async ({ page }) => {
      await at(page, 390, path);
      await addButton(page).click();
      await expect(
        page.getByRole("dialog", { name: "Add transaction" }),
      ).toBeVisible();
    });

  test("puts a back arrow before the title on pages opened from More, and only there", async ({
    page,
  }) => {
    await at(page, 390, "/accounts");
    const back = page.getByRole("link", { name: "Back to More", exact: true });
    await expect(back).toBeVisible();
    expect((await back.boundingBox())?.width).toBeGreaterThanOrEqual(44);
    await back.click();
    await expect(page).toHaveURL(/\/more$/);
    await expect(
      page.getByRole("link", { name: "Back to More", exact: true }),
    ).toHaveCount(0);
    await page.goto("/transactions");
    await expect(
      page.getByRole("link", { name: "Back to More", exact: true }),
    ).toHaveCount(0);
  });

  test("has no Sign out in a phone's top bar: Settings carries it", async ({
    page,
  }) => {
    await at(page, 390);
    await expect(
      page
        .getByRole("button", { name: "Sign out", exact: true })
        .filter({ visible: true }),
    ).toHaveCount(0);
    await page.goto("/settings");
    await expect(
      page
        .getByRole("main")
        .getByRole("button", { name: "Sign out", exact: true }),
    ).toBeVisible();
  });

  test("shows the sync state only when it is not Synced", async ({
    page,
    context,
  }) => {
    await at(page, 390);
    await expect(
      page.locator(".ui-sync").filter({ hasText: /Synced|Updating|Offline/ }),
    ).toBeHidden();
    await context.setOffline(true);
    await expect(
      page.locator(".ui-sync").filter({ hasText: "Offline" }),
    ).toBeVisible();
    await context.setOffline(false);
  });

  test("the page's own heading is only for screen readers on a phone, and shows from 700 px", async ({
    page,
  }) => {
    await at(page, 390, "/budgets");
    const small = await page.locator("main h1").boundingBox();
    expect(small?.width).toBeLessThanOrEqual(2);
    expect(small?.height).toBeLessThanOrEqual(2);
    await expect(page.locator(".ui-topbar-title")).toBeVisible();
    await at(page, 820, "/budgets");
    const large = await page.locator("main h1").boundingBox();
    expect(large?.height).toBeGreaterThan(20);
  });

  test("the page's own heading carries the title, read once", async ({
    page,
  }) => {
    await at(page, 390, "/budgets");
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Budgets");
    expect(
      await page.locator(".ui-topbar-title").getAttribute("aria-hidden"),
    ).toBe("true");
  });
});

test.describe("the edges at 699, 700, 1099 and 1100 px", () => {
  test("699 px is a phone: bottom bar, no rail", async ({ page }) => {
    await at(page, 699);
    await expect(
      page.getByRole("navigation", { name: "Mobile navigation" }),
    ).toBeVisible();
    await expect(page.locator(".ui-side")).toBeHidden();
  });

  test("700 px is an 88 px rail with labelled icons, a thin top bar and no bottom bar or phone Add", async ({
    page,
  }) => {
    await at(page, 700);
    await expect(
      page.getByRole("navigation", { name: "Mobile navigation" }),
    ).toBeHidden();
    await expect(page.locator("#mobile-add-transaction")).toBeHidden();
    await expect
      .poll(async () => (await rect(page, ".ui-side")).width)
      .toBeGreaterThanOrEqual(88);
    expect((await rect(page, ".ui-side")).width).toBeLessThanOrEqual(89);
    const nav = page.getByRole("navigation", { name: "Main navigation" });
    await expect(nav.getByRole("link", { name: "Budgets" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Budgets" })).toContainText(
      "Budgets",
    );
    await expect(
      nav.getByRole("link", { name: "More", exact: true }),
    ).toBeVisible();
    await expect(page.getByText("Receivables and lending")).toBeHidden();
    await expect(addButton(page)).toBeVisible();
    await expect(page.locator(".ui-topbar-title")).toBeHidden();
  });

  test("1099 px is still the rail", async ({ page }) => {
    await at(page, 1099);
    await expect(page.locator(".ui-side")).toBeVisible();
    expect((await rect(page, ".ui-side")).width).toBeLessThanOrEqual(89);
    await expect(page.getByText("Receivables and lending")).toBeHidden();
  });

  test("1100 px is the 248 px sidebar with More's pages in three groups and no More link", async ({
    page,
  }) => {
    await at(page, 1100);
    await expect
      .poll(async () => (await rect(page, ".ui-side")).width)
      .toBeGreaterThanOrEqual(248);
    expect((await rect(page, ".ui-side")).width).toBeLessThanOrEqual(249);
    for (const label of [
      "Receivables and lending",
      "Money setup",
      "Data and preferences",
    ])
      await expect(page.getByText(label, { exact: true })).toBeVisible();
    const nav = page.getByRole("navigation", { name: "Main navigation" });
    await expect(
      nav.getByRole("link", { name: "More", exact: true }),
    ).toBeHidden();
    const pages = page.getByRole("navigation", { name: "More pages" });
    for (const name of [
      "Clients",
      "Loans",
      "Accounts",
      "Categories",
      "Tags",
      "Currencies",
      "Recurring",
      "Import and export",
      "Settings",
    ])
      await expect(
        pages.getByRole("link", { name, exact: true }),
      ).toBeVisible();
  });
});

test.describe("the sidebar", () => {
  test("goes to a More page and marks it as the current page", async ({
    page,
  }) => {
    await at(page, 1280);
    const pages = page.getByRole("navigation", { name: "More pages" });
    await pages.getByRole("link", { name: "Currencies", exact: true }).click();
    await expect(page).toHaveURL(/\/currencies$/);
    await expect(
      page.getByRole("heading", { level: 1, name: "Currencies" }),
    ).toBeVisible();
    await expect(
      pages.getByRole("link", { name: "Currencies", exact: true }),
    ).toHaveAttribute("aria-current", "page");
    await expect(
      page
        .getByRole("navigation", { name: "Main navigation" })
        .locator("[aria-current=page]")
        .filter({ visible: true }),
    ).toHaveCount(0); // More is not listed in the sidebar, so no visible destination is current.
  });

  test("keeps the jump-to button, the owner and Sign out in view in a short window while the pages scroll", async ({
    page,
  }) => {
    await at(page, 1280, "/", 560);
    const scroll = page.locator(".ui-side-scroll");
    await expect
      .poll(() =>
        scroll.evaluate((node) => node.scrollHeight > node.clientHeight),
      )
      .toBe(true);
    await expect(page.getByRole("button", { name: /Jump to/ })).toBeInViewport({
      ratio: 1,
    });
    await expect(
      page
        .getByRole("button", { name: "Sign out", exact: true })
        .filter({ visible: true }),
    ).toBeInViewport({ ratio: 1 });
    await scroll.evaluate((node) => node.scrollTo(0, node.scrollHeight));
    await expect(
      page
        .getByRole("navigation", { name: "More pages" })
        .getByRole("link", { name: "Settings", exact: true }),
    ).toBeInViewport({ ratio: 1 });
  });

  test("marks the destination it is on", async ({ page }) => {
    await at(page, 1280, "/budgets");
    await expect(
      page
        .getByRole("navigation", { name: "Main navigation" })
        .getByRole("link", { name: "Budgets" }),
    ).toHaveAttribute("aria-current", "page");
  });

  test("has one Add transaction button, the jump-to button, the owner and Sign out", async ({
    page,
  }) => {
    await at(page, 1280);
    await expect(addButton(page)).toHaveCount(1);
    await expect(page.getByRole("button", { name: /Jump to/ })).toBeVisible();
    await expect(
      page
        .getByRole("button", { name: "Sign out", exact: true })
        .filter({ visible: true }),
    ).toHaveCount(1);
  });
});

test.describe("the top bar on a wider screen", () => {
  test("holds only global tools: sync status, privacy and theme, with no title or breadcrumb", async ({
    page,
  }) => {
    await at(page, 1280);
    await expect(page.locator(".ui-topbar-title")).toBeHidden();
    await expect(
      page.locator("header").getByText("Personal ledger"),
    ).toHaveCount(0);
    await expect(
      page.locator(".ui-sync").filter({ hasText: "Synced" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Hide amounts" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Switch to (dark|light) theme/ }),
    ).toBeVisible();
  });

  test("says Offline when the browser is offline, and Synced again after", async ({
    page,
    context,
  }) => {
    await at(page, 1280);
    await context.setOffline(true);
    await expect(
      page.locator(".ui-sync").filter({ hasText: "Offline" }),
    ).toBeVisible();
    await context.setOffline(false);
    await expect(
      page.locator(".ui-sync").filter({ hasText: "Synced" }),
    ).toBeVisible({ timeout: 20_000 });
  });
});

test.describe("the theme and the palette", () => {
  test("one click switches light and dark, from either side", async ({
    page,
  }) => {
    await at(page, 1280);
    await page.evaluate(() => localStorage.removeItem("ledgerline.theme"));
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await page
      .getByRole("button", { name: "Switch to dark theme", exact: true })
      .click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await page
      .getByRole("button", { name: "Switch to light theme", exact: true })
      .click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  });

  test("the palette opens from the sidebar button and the keyboard, and Escape returns focus", async ({
    page,
  }) => {
    await at(page, 1280);
    const jump = page.getByRole("button", { name: /Jump to/ });
    await jump.click();
    const dialog = page.getByRole("dialog", { name: "Go to", exact: true });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel("Search pages and actions")).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(jump).toBeFocused();
    await page.keyboard.press("Control+k");
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Control+k");
    await expect(dialog).toBeHidden();
  });

  test("the palette shows no description paragraph and no close button", async ({
    page,
  }) => {
    await at(page, 1280);
    await page.keyboard.press("Control+k");
    const dialog = page.getByRole("dialog", { name: "Go to", exact: true });
    await expect(
      dialog.getByText("Type to find a page or action."),
    ).toHaveClass(/sr-only/);
    await expect(
      dialog.getByRole("button", { name: "Close navigation" }),
    ).toHaveCount(0);
  });

  test("a phone has no palette button", async ({ page }) => {
    await at(page, 390);
    await expect(page.getByRole("button", { name: /Jump to/ })).toBeHidden();
  });
});

test.describe("fit and accessibility", () => {
  for (const width of [320, 390, 700, 1099, 1100, 1280])
    for (const path of ["/", "/more", "/accounts"])
      test(`nothing scrolls sideways at ${width} px on ${path}`, async ({
        page,
      }) => {
        await at(page, width, path);
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth,
          ),
        ).toBe(true);
      });

  test("the skip link and one h1 are there at every width", async ({
    page,
  }) => {
    for (const width of [390, 820, 1280]) {
      await at(page, width);
      await expect(page.locator(".skip-link")).toHaveCount(1);
      await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    }
  });

  for (const theme of ["light", "dark"])
    for (const width of [390, 820, 1280])
      test(`axe finds nothing on Home at ${width} px in the ${theme} theme`, async ({
        page,
      }) => {
        await at(page, width);
        if (theme === "dark")
          await page
            .getByRole("button", { name: "Switch to dark theme", exact: true })
            .click();
        await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
        await page.waitForTimeout(300);
        const results = await new AxeBuilder({ page })
          .withTags([
            "wcag2a",
            "wcag2aa",
            "wcag21a",
            "wcag21aa",
            "wcag22aa",
            "best-practice",
          ])
          .analyze();
        expect(
          results.violations.map(
            (v) => `${v.id}: ${v.nodes.map((n) => n.target).join(" | ")}`,
          ),
        ).toEqual([]);
      });
});
