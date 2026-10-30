import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { newId } from "../../packages/shared/src/index";
import {
  connectLocalDatabase,
  createOwnerLedger,
  prepareBrowser,
} from "./ledger-setup";
import { signIn } from "./sign-in";
import { setTheme } from "./theme";

// Accessibility guard (ADR 0040): axe (WCAG 2.0 to 2.2 A and AA plus best-practice rules) must find nothing on
// the main screens and dialogs at a phone and a desktop width in both themes. Only violations count; axe's
// "needs review" items (for example a background it cannot resolve, or the focus guards Radix adds around a
// dialog) are not failures.
const { env, pool } = connectLocalDatabase("Accessibility browser tests");
let ledgerId = "";
let emptyLedgerId = "";

const routes = [
  "/",
  "/transactions",
  "/budgets",
  "/insights",
  "/more",
  "/accounts",
  "/categories",
  "/clients",
  "/loans",
  "/currencies",
  "/recurring",
  "/tags",
  "/settings",
  "/import",
];

test.beforeAll(async () => {
  ledgerId = newId();
  emptyLedgerId = newId();
  await createOwnerLedger(pool, env, ledgerId, "E2E a11y ledger");
  await createOwnerLedger(pool, env, emptyLedgerId, "E2E a11y empty ledger");
  const checking = newId();
  const food = newId();
  await pool.query(
    "INSERT INTO accounts (id,ledger_id,name,type,opening_balance) VALUES ($1,$3,'Checking','bank',100000),($2,$3,'Savings','bank',5000)",
    [checking, newId(), ledgerId],
  );
  await pool.query(
    "INSERT INTO categories (id,ledger_id,name,kind) VALUES ($1,$2,'Food','expense')",
    [food, ledgerId],
  );
  await pool.query(
    "INSERT INTO transactions (id,ledger_id,account_id,category_id,kind,date,amount,base_amount) VALUES ($1,$2,$3,$4,'expense',$5,-2500,-2500)",
    [newId(), ledgerId, checking, food, new Date().toISOString().slice(0, 10)],
  );
});

test.afterAll(async () => {
  for (const id of [ledgerId, emptyLedgerId]) {
    if (!id) continue;
    for (const table of ["transactions", "accounts", "categories"])
      await pool.query(`DELETE FROM ${table} WHERE ledger_id=$1`, [id]);
    await pool.query("DELETE FROM ledger_members WHERE ledger_id=$1", [id]);
    await pool.query("DELETE FROM ledgers WHERE id=$1", [id]);
  }
  await pool.end();
});

async function violations(page: Page, scene: string) {
  await page.waitForTimeout(300);
  const result = await new AxeBuilder({ page })
    .withTags([
      "wcag2a",
      "wcag2aa",
      "wcag21a",
      "wcag21aa",
      "wcag22aa",
      "best-practice",
    ])
    .analyze();
  return result.violations
    .map((violation) =>
      // Known gap (docs/PROGRESS.md): a transaction row's accessible name is a short summary
      // ("Open transaction: <payee>") that does not contain all of the row's visible text, which many
      // browser specs rely on. Everything else under this rule still counts.
      violation.id === "label-content-name-mismatch"
        ? {
            ...violation,
            nodes: violation.nodes.filter(
              (node) => !node.target.join(" ").startsWith("#transaction-"),
            ),
          }
        : violation,
    )
    .filter((violation) => violation.nodes.length > 0)
    .map(
      (violation) =>
        `${scene}: ${violation.id} (${violation.nodes.length}) ${violation.nodes
          .slice(0, 2)
          .map((node) => node.target.join(" "))
          .join(", ")}`,
    );
}

/** Contrast ratio of an input's outline against the input and the page behind it. */
async function fieldBorderContrast(page: Page) {
  return page.evaluate(() => {
    const channels = (color: string) =>
      (color.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
    const luminance = (color: string) => {
      const [r, g, b] = channels(color).map((value) => {
        const unit = value / 255;
        return unit <= 0.03928 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4;
      }) as [number, number, number];
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const ratio = (a: string, b: string) => {
      const [high, low] = [luminance(a), luminance(b)].sort(
        (x, y) => y - x,
      ) as [number, number];
      return (high + 0.05) / (low + 0.05);
    };
    const input = document.querySelector<HTMLInputElement>(
      "input[placeholder^=Search]",
    );
    if (!input) return null;
    const style = getComputedStyle(input);
    return {
      surface: ratio(style.borderTopColor, style.backgroundColor),
      page: ratio(
        style.borderTopColor,
        getComputedStyle(document.body).backgroundColor,
      ),
    };
  });
}

for (const width of [390, 1280]) {
  for (const theme of ["light", "dark"] as const) {
    test(`no accessibility violations at ${width}px in ${theme}`, async ({
      page,
    }, testInfo) => {
      test.skip(testInfo.project.name !== "desktop");
      test.setTimeout(240000);
      await prepareBrowser(page, testInfo, {
        ledgerId,
        name: "E2E a11y ledger",
        forwarded: [230, 20],
      });
      await signIn(page);
      await page.setViewportSize({ width, height: width < 600 ? 800 : 900 });
      await setTheme(page, theme);
      const found: string[] = [];
      const titles = new Map<string, string>();
      for (const route of routes) {
        await page.goto(route);
        await expect(page.locator("main h1").first()).toBeVisible();
        titles.set(route, await page.title());
        found.push(...(await violations(page, route)));
      }
      expect(
        new Set(titles.values()).size,
        "every screen has its own title",
      ).toBe(routes.length);

      await page.goto("/transactions");
      await expect(
        page.getByPlaceholder("Search payee, payer or note"),
      ).toBeVisible();
      const contrast = await fieldBorderContrast(page);
      expect(contrast, "a text field to measure").not.toBeNull();
      expect(
        contrast?.surface,
        "field border against its field",
      ).toBeGreaterThanOrEqual(3);
      expect(
        contrast?.page,
        "field border against the page",
      ).toBeGreaterThanOrEqual(3);

      const dialogs: [string, () => Promise<void>][] = [
        [
          "add transaction",
          async () => {
            await page.goto("/");
            await page
              .getByRole("button", { name: /Add transaction/ })
              .first()
              .click();
            await page.getByText("More details", { exact: true }).click();
          },
        ],
        [
          "edit transaction",
          async () => {
            await page.goto("/transactions");
            await page
              .getByRole("button", { name: /^Open transaction/ })
              .first()
              .click();
          },
        ],
        [
          "add account",
          async () => {
            await page.goto("/accounts");
            await page
              .getByRole("button", { name: /Add (your first )?account/ })
              .first()
              .click();
          },
        ],
        [
          "filters",
          async () => {
            await page.goto("/transactions");
            await page.getByRole("button", { name: /^Filters/ }).click();
          },
        ],
      ];
      for (const [name, open] of dialogs) {
        await open();
        found.push(...(await violations(page, `dialog: ${name}`)));
      }
      expect(found).toEqual([]);
    });
  }
}

test("no accessibility violations on an empty ledger", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop");
  await prepareBrowser(page, testInfo, {
    ledgerId: emptyLedgerId,
    name: "E2E a11y empty ledger",
    forwarded: [230, 20],
  });
  await signIn(page);
  await page.setViewportSize({ width: 390, height: 800 });
  const found: string[] = [];
  for (const route of [
    "/",
    "/accounts",
    "/transactions",
    "/budgets",
    "/insights",
  ]) {
    await page.goto(route);
    await expect(page.locator("main h1").first()).toBeVisible();
    found.push(...(await violations(page, `empty ${route}`)));
  }
  expect(found).toEqual([]);
});

test.describe("signed out", () => {
  test.use({ storageState: { cookies: [], origins: [] } });
  for (const theme of ["light", "dark"] as const) {
    test(`the sign-in screen has no violations in ${theme}`, async ({
      page,
    }, testInfo) => {
      test.skip(testInfo.project.name !== "desktop");
      await page.emulateMedia({ colorScheme: theme });
      for (const width of [390, 1280]) {
        await page.setViewportSize({ width, height: 800 });
        await page.goto("/");
        await expect(
          page.getByRole("heading", { name: "Welcome back" }),
        ).toBeVisible();
        expect(await violations(page, `sign-in ${width}`)).toEqual([]);
      }
    });
  }
});
