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

// Home's layout (ADR 0047, PR 4), measured in a real browser: jsdom cannot run container queries. The money
// owed and the pending count are filled in by answering the Home request, so every optional line is on screen
// at once; what the figures and links are is covered by the unit tests.
const { env, pool } = connectLocalDatabase("Home layout browser tests");
const fixtures: string[] = [];
test.beforeEach(async ({ page }, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop",
    "one project is enough: these tests set their own widths",
  );
  const ledgerId = newId();
  fixtures.push(ledgerId);
  await createOwnerLedger(pool, env, ledgerId, "E2E home layout ledger");
  for (const [name, type, amount] of [
    ["Checking", "bank", 100000],
    ["Cash", "cash", 20000],
    ["Visa", "card", -30000],
  ] as const)
    await pool.query(
      "INSERT INTO accounts (id,ledger_id,name,type,opening_balance) VALUES ($1,$2,$3,$4,$5)",
      [newId(), ledgerId, name, type, amount],
    );
  await pool.query(
    "INSERT INTO categories (id,ledger_id,name,kind) VALUES ($1,$2,'Food','expense')",
    [newId(), ledgerId],
  );
  await prepareBrowser(page, testInfo, {
    ledgerId,
    name: "Synthetic home layout ledger",
    forwarded: [61, 61],
  });
  await page.route(/\/api\/v1\/ledgers\/[^/]+\/home\?/, async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    body.owed = {
      ...body.owed,
      total: { amount: 4250000, currency: "USD" },
      personCount: 2,
    };
    body.loans = {
      lent: { amount: 60000, currency: "USD" },
      borrowed: { amount: 1250000, currency: "USD" },
    };
    body.pendingCount = 2;
    body.moneyIn = { amount: 543840, currency: "USD" };
    body.moneyOut = { amount: 411200, currency: "USD" };
    await route.fulfill({ response, json: body });
  });
});
test.afterEach(async () => {
  for (const id of fixtures) {
    for (const table of ["transactions", "accounts", "categories"])
      await pool.query(
        `UPDATE ${table} SET deleted_at=now(), updated_at=now() WHERE ledger_id=$1`,
        [id],
      );
    await pool.query(
      "UPDATE ledger_members SET deleted_at=now(), updated_at=now() WHERE ledger_id=$1",
      [id],
    );
    await pool.query(
      "UPDATE ledgers SET deleted_at=now(), updated_at=now() WHERE id=$1 AND name LIKE 'E2E home layout ledger%'",
      [id],
    );
  }
  fixtures.length = 0;
});
test.afterAll(async () => {
  await pool.end();
});

async function openHome(page: Page, width: number) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width, height: 900 });
  await signIn(page);
  // In development the stylesheets arrive after the first paint, so wait for the layout system.
  await page.waitForFunction(
    () => getComputedStyle(document.body).containerType === "inline-size",
  );
  await expect(page.locator(".ui-hero-fig")).toHaveCount(3);
  await expect(page.getByText("Visa", { exact: true })).toBeVisible();
}
const rect = (page: Page, selector: string, nth = 0) =>
  page
    .locator(selector)
    .nth(nth)
    .evaluate((node) => {
      const box = node.getBoundingClientRect();
      return {
        top: box.top,
        bottom: box.bottom,
        left: box.left,
        right: box.right,
        height: box.height,
        width: box.width,
      };
    });
const near = (a: number, b: number) => Math.abs(a - b) <= 1;

for (const theme of ["light", "dark"] as const)
  for (const width of [320, 390]) {
    test(`fits a ${width} px phone in ${theme}: nothing scrolls sideways and no label wraps`, async ({
      page,
    }) => {
      await openHome(page, width);
      await setTheme(page, theme);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
      // A hero label is one line: its height is a single line, whatever the width.
      for (const label of await page.locator(".ui-hero-fig-label").all()) {
        const { height, lineHeight } = await label.evaluate((node) => ({
          height: node.getBoundingClientRect().height,
          lineHeight:
            Number.parseFloat(getComputedStyle(node).lineHeight) || 16,
        }));
        expect(height).toBeLessThan(lineHeight * 1.6);
      }
      // The figures stay inside the hero card.
      const hero = await rect(page, ".ui-hero");
      for (let i = 0; i < 3; i++) {
        const fig = await rect(page, ".ui-hero-fig", i);
        expect(fig.left).toBeGreaterThanOrEqual(hero.left - 1);
        expect(fig.right).toBeLessThanOrEqual(hero.right + 1);
      }
      for (const row of await page.locator(".ui-row").all()) {
        expect((await row.boundingBox())?.height).toBeGreaterThanOrEqual(44);
        expect(
          await row.evaluate(
            (node) => node.scrollWidth <= node.clientWidth + 1,
          ),
        ).toBe(true);
      }
    });
  }

test("is one column under 700 px and two bands from 700 px", async ({
  page,
}) => {
  await openHome(page, 699);
  let hero = await rect(page, ".ui-hero");
  let month = await rect(page, ".home-month");
  expect(month.top).toBeGreaterThan(hero.bottom - 1);
  const accounts = await rect(page, ".home-accounts");
  let latest = await rect(page, "section[aria-labelledby=home-latest]");
  expect(latest.top).toBeGreaterThan(accounts.bottom - 1);

  for (const width of [700, 900, 1099, 1100, 1400]) {
    await page.setViewportSize({ width, height: 900 });
    hero = await rect(page, ".ui-hero");
    month = await rect(page, ".home-month");
    // Side by side, starting on one line and ending on one line.
    expect(month.left).toBeGreaterThan(hero.right - 1);
    expect(near(hero.top, month.top)).toBe(true);
    expect(near(hero.height, month.height)).toBe(true);
    const left = await rect(page, ".home-accounts");
    latest = await rect(page, "section[aria-labelledby=home-latest]");
    expect(latest.left).toBeGreaterThan(left.right - 1);
    expect(near(left.top, latest.top)).toBe(true);
    // The label rows have one height, so the first cards start on one line too.
    const leftLabel = await rect(page, "#home-accounts");
    const rightLabel = await rect(page, "#home-latest");
    expect(near(leftLabel.top, rightLabel.top)).toBe(true);
    const leftCard = await rect(page, ".home-accounts > :nth-child(2)");
    const rightCard = await rect(
      page,
      "section[aria-labelledby=home-latest] > :nth-child(2)",
    );
    expect(near(leftCard.top, rightCard.top)).toBe(true);
    // The two bands share their column edges.
    expect(near(hero.left, left.left)).toBe(true);
    expect(near(month.left, latest.left)).toBe(true);
  }
});

test("keeps the first cards on one line with the currency control showing", async ({
  page,
}) => {
  // Give the list a second currency by answering the accounts request.
  await page.route(
    /\/api\/v1\/ledgers\/[^/]+\/accounts\?.*status=active/,
    async (route) => {
      const response = await route.fetch();
      const body = await response.json();
      const first = body.items[0];
      body.items.push({
        ...first,
        id: newId(),
        name: "Euro bank",
        currency: "EUR",
        openingBalance: { amount: 5000, currency: "EUR" },
        balance: { amount: 5000, currency: "EUR" },
      });
      body.items.push({
        ...first,
        id: newId(),
        name: "Second euro",
        currency: "EUR",
        balance: { amount: 100, currency: "EUR" },
        openingBalance: { amount: 100, currency: "EUR" },
      });
      await route.fulfill({ response, json: body });
    },
  );
  for (const width of [320, 390, 800, 1400]) {
    await openHome(page, width);
    const control = page.getByRole("radiogroup", { name: "Currency" });
    await expect(control).toBeVisible();
    const leftCard = await rect(page, ".home-accounts > :nth-child(2)");
    const rightCard = await rect(
      page,
      "section[aria-labelledby=home-latest] > :nth-child(2)",
    );
    if (width >= 700) expect(near(leftCard.top, rightCard.top)).toBe(true);
    // An option's touch area is a 44 px band around its centre (the foundation's rule).
    for (const option of await control.getByRole("radio").all()) {
      const reach = await option.evaluate((node) => {
        node.scrollIntoView({ block: "center" });
        const box = node.getBoundingClientRect();
        const x = box.left + box.width / 2;
        return [-21, 21].map((offset) => {
          const found = document.elementFromPoint(
            x,
            box.top + box.height / 2 + offset,
          );
          return found === node || node.contains(found);
        });
      });
      expect(reach).toEqual([true, true]);
    }
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  }
});

test("the pending note opens the pending entries", async ({ page }) => {
  await openHome(page, 1200);
  await page.getByRole("link", { name: /^2 pending entries/ }).click();
  await expect(page).toHaveURL(/\/transactions\?.*status=pending/);
  await expect(
    page.getByRole("heading", { name: "Transactions", exact: true }),
  ).toBeVisible();
});

test("the figures and This month are links to their pages", async ({
  page,
}) => {
  await openHome(page, 1200);
  await expect(
    page.getByRole("link", { name: /^Clients owe/ }),
  ).toHaveAttribute("href", "/clients");
  await expect(page.getByRole("link", { name: /^People owe/ })).toHaveAttribute(
    "href",
    "/loans",
  );
  await expect(page.getByRole("link", { name: /^You owe/ })).toHaveAttribute(
    "href",
    "/loans",
  );
  await page.getByRole("link", { name: /^This month/ }).click();
  await expect(page).toHaveURL(/\/insights/);
});

for (const theme of ["light", "dark"] as const)
  test(`has no accessibility violations in ${theme}`, async ({ page }) => {
    await openHome(page, 1200);
    await setTheme(page, theme);
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  });
