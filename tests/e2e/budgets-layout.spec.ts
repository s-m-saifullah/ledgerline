import AxeBuilder from "@axe-core/playwright";
import { expect, type Locator, type Page, test } from "@playwright/test";
import { newId } from "../../packages/shared/src/index";
import {
  connectLocalDatabase,
  createOwnerLedger,
  prepareBrowser,
} from "./ledger-setup";
import { signIn } from "./sign-in";
import { setTheme } from "./theme";

// Budgets in a real browser (ADR 0047, PR 7), against the approved prototype: jsdom cannot run container queries,
// so the hero beside the list from 1100 px, the month control's place, the row sizes, the sheet against the drawer
// and the foot are measured here. The budgets are mocked, so the shared owner's ledger is never changed.
const { env, pool } = connectLocalDatabase("Budgets layout browser tests");
const fixtures: string[] = [];
test.beforeEach(async ({ page }, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop",
    "one project is enough: these tests set their own widths",
  );
  const ledgerId = newId();
  fixtures.push(ledgerId);
  await createOwnerLedger(pool, env, ledgerId, "E2E budgets layout ledger");
  await prepareBrowser(page, testInfo, {
    ledgerId,
    name: "Synthetic budgets layout ledger",
    forwarded: [225, 21],
  });
});
test.afterEach(async () => {
  for (const id of fixtures) {
    await pool.query(
      "UPDATE ledger_members SET deleted_at=now(), updated_at=now() WHERE ledger_id=$1",
      [id],
    );
    await pool.query(
      "UPDATE ledgers SET deleted_at=now(), updated_at=now() WHERE id=$1 AND name LIKE 'E2E budgets layout ledger%'",
      [id],
    );
  }
  fixtures.length = 0;
});
test.afterAll(async () => {
  await pool.end();
});

const usd = (amount: number) => ({ amount, currency: "USD" });
const uuid = (n: number) =>
  `01a17000-0000-7000-8000-${String(n).padStart(12, "0")}`;
const stamp = "2026-10-01T00:00:00.000Z";
const now = new Date();
const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
// name, budget, spent, carried in
const lines: [string, number | null, number, number][] = [
  ["Food", 60000, 41635, 0],
  ["Home", 170000, 159450, 0],
  ["Transport", 15000, 21215, 1500],
  ["Fun", 8000, 5499, 0],
  ["Health", null, 1840, 0],
  ["Gifts", null, 0, 0],
];
function view(month: string, empty: boolean) {
  const items = lines.map(([name, limit, spent, carry], index) => {
    const has = limit !== null && !empty;
    return {
      categoryId: uuid(100 + index),
      name,
      icon: null,
      color: null,
      archived: false,
      budget: has
        ? {
            id: uuid(200 + index),
            ledgerId: uuid(1),
            categoryId: uuid(100 + index),
            month,
            amount: usd(limit),
            rollover: carry > 0,
            version: 1,
            createdAt: stamp,
            updatedAt: stamp,
          }
        : null,
      carriedIn: usd(has ? carry : 0),
      spent: usd(empty ? 0 : spent),
      left: has ? usd(limit + carry - spent) : null,
    };
  });
  const budgeted = items.filter((item) => item.budget);
  const sum = (pick: (item: (typeof items)[number]) => number) =>
    budgeted.reduce((total, item) => total + pick(item), 0);
  return {
    month,
    items,
    totals: {
      budgeted: usd(sum((item) => item.budget?.amount.amount ?? 0)),
      carriedIn: usd(sum((item) => item.carriedIn.amount)),
      spent: usd(sum((item) => item.spent.amount)),
      left: usd(sum((item) => item.left?.amount ?? 0)),
      unbudgetedSpent: usd(
        items
          .filter((item) => !item.budget)
          .reduce((total, item) => total + item.spent.amount, 0),
      ),
    },
  };
}

/** Budgets answered from memory: this month has budgets, any other month has none. */
async function withBudgets(page: Page) {
  await page.route("**/api/v1/ledgers/*/budgets?*", async (route) => {
    const month =
      new URL(route.request().url()).searchParams.get("month") ?? "";
    await route.fulfill({ json: view(month, month !== thisMonth) });
  });
  // A write goes to a path under /budgets without a query string.
  await page.route("**/api/v1/ledgers/*/budgets", async (route) => {
    const body = route.request().postDataJSON();
    await route.fulfill({
      status: 201,
      json: {
        id: uuid(300),
        ledgerId: uuid(1),
        categoryId: body.categoryId,
        month: body.month,
        amount: body.amount,
        rollover: body.rollover,
        version: 1,
        createdAt: stamp,
        updatedAt: stamp,
      },
    });
  });
  await page.route("**/api/v1/ledgers/*/budgets/*", (route) =>
    route.fulfill({ status: 204, body: "" }),
  );
}

async function open(page: Page, width: number, theme?: "light" | "dark") {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width, height: 900 });
  await signIn(page);
  await withBudgets(page);
  await page.goto("/budgets");
  await page.waitForFunction(
    () => getComputedStyle(document.body).containerType === "inline-size",
  );
  if (theme) await setTheme(page, theme);
  await expect(page.getByText("Left this month")).toBeVisible();
}
const box = async (locator: Locator) => {
  const found = await locator.boundingBox();
  if (!found) throw new Error("not on screen");
  return found;
};
/** A box that has stopped moving: a sheet slides in, so two reads in a row must agree. */
async function settled(locator: Locator) {
  let last = await box(locator);
  for (let tries = 0; tries < 40; tries++) {
    await locator.page().waitForTimeout(60);
    const next = await box(locator);
    if (
      Math.abs(next.x - last.x) < 0.5 &&
      Math.abs(next.y - last.y) < 0.5 &&
      Math.abs(next.width - last.width) < 0.5 &&
      Math.abs(next.height - last.height) < 0.5
    )
      return next;
    last = next;
  }
  throw new Error("never settled");
}
const noSideways = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
/** An element is a real 44 px target when a click 21 px out from its centre still lands on it. */
async function is44(page: Page, locator: Locator) {
  await locator.evaluate((node) => node.scrollIntoView({ block: "center" }));
  const found = await box(locator);
  const x = found.x + found.width / 2;
  const y = found.y + found.height / 2;
  return page.evaluate(
    ({ x, y }) => {
      const target = document.elementFromPoint(x, y);
      const control = target?.closest("button, a, label, summary");
      return [
        [x - 21, y],
        [x + 21, y],
        [x, y - 21],
        [x, y + 21],
      ].every(([px, py]) => {
        const element = document.elementFromPoint(px as number, py as number);
        return !!element && !!control && control.contains(element);
      });
    },
    { x, y },
  );
}
const rows = (page: Page) => page.locator(".bud-list .bud-row");

for (const theme of ["light", "dark"] as const)
  for (const width of [320, 390, 1280])
    test(`fits ${width} px in ${theme}: the hero, four rows, one fold, nothing cut, each a real target`, async ({
      page,
    }) => {
      await open(page, width, theme);
      expect(await noSideways(page)).toBe(true);
      await expect(rows(page)).toHaveCount(4);
      const hero = page.locator(".ui-hero");
      expect(
        await hero.evaluate((node) => node.scrollWidth <= node.clientWidth),
      ).toBe(true);
      for (const row of await rows(page).all()) {
        expect((await box(row)).height).toBeGreaterThanOrEqual(56);
        // The prototype's row: 12 px above and below, 16 px at the sides.
        expect(
          await row.evaluate((node) => {
            const style = getComputedStyle(node);
            return [style.paddingTop, style.paddingBottom, style.paddingLeft];
          }),
        ).toEqual(["12px", "12px", "16px"]);
        // The name, what is left and the hint fit their own room: wrapped, never cut.
        for (const part of [".ui-row-title", ".bud-left", ".ui-row-hint"])
          expect(
            await row
              .locator(part)
              .evaluate((node) => node.scrollWidth <= node.clientWidth + 1),
          ).toBe(true);
        expect(await is44(page, row)).toBe(true);
      }
      const fold = page.getByText("2 without a budget");
      await expect(fold.locator("xpath=ancestor::details")).not.toHaveAttribute(
        "open",
        "",
      );
      expect(await is44(page, fold)).toBe(true);
      // The global disclosure style (bordered, with its own arrow) gives way: the summary is the first row.
      const summary = fold.locator("xpath=ancestor::summary");
      expect(
        await summary.evaluate((node) => {
          const style = getComputedStyle(node);
          return [
            style.borderTopWidth,
            style.borderTopLeftRadius,
            getComputedStyle(node, "::before").display,
          ];
        }),
      ).toEqual(["0px", "0px", "none"]);
      // The bar on the hero is light on the hero, not the accent on the deep accent.
      expect(
        await hero.evaluate(
          (node) =>
            getComputedStyle(node.querySelector(".ui-bar > i") as Element)
              .backgroundColor === getComputedStyle(node).color,
        ),
      ).toBe(true);
      for (const name of ["Previous month", "Next month"])
        expect(await is44(page, page.getByRole("button", { name }))).toBe(true);
    });

test("a phone has one column, and so does a page narrower than 1100 px", async ({
  page,
}) => {
  for (const width of [390, 800, 1099]) {
    await open(page, width);
    const hero = await box(page.locator(".ui-hero"));
    const list = await box(page.locator(".bud-list"));
    expect(Math.abs(hero.x - list.x)).toBeLessThan(1);
    expect(list.y).toBeGreaterThan(hero.y + hero.height - 1);
    expect(await noSideways(page)).toBe(true);
  }
});

test("from 1100 px the hero is beside the list, 5 to 7, both starting on one line", async ({
  page,
}) => {
  await open(page, 1280);
  const hero = await box(page.locator(".ui-hero"));
  const list = await box(page.locator(".bud-list"));
  expect(list.x).toBeGreaterThan(hero.x + hero.width - 1);
  expect(Math.abs(hero.y - list.y)).toBeLessThan(1);
  const ratio = hero.width / list.width;
  expect(Math.abs(ratio - 5 / 7)).toBeLessThan(0.05);
});

test("the month control sits under the top bar on a phone and in the head from 700 px", async ({
  page,
}) => {
  await open(page, 390);
  const title = page.getByRole("heading", { level: 1, name: "Budgets" });
  // The phone's title is the top bar's; the page's own is for screen readers and focus.
  expect((await box(title)).width).toBeLessThanOrEqual(1);
  const month = await box(page.locator(".month-head-control"));
  expect(Math.abs(month.x + month.width / 2 - 195)).toBeLessThan(3);

  await open(page, 1280);
  const head = await box(title);
  const wide = await box(page.locator(".month-head-control"));
  const list = await box(page.locator(".bud-list"));
  expect(head.width).toBeGreaterThan(40);
  expect(wide.x).toBeGreaterThan(head.x + head.width);
  expect(
    Math.abs(head.y + head.height / 2 - (wide.y + wide.height / 2)),
  ).toBeLessThan(10);
  // The control ends where the list ends.
  expect(Math.abs(wide.x + wide.width - (list.x + list.width))).toBeLessThan(
    16,
  );
});

test("the month control shows the empty month with a Copy button", async ({
  page,
}) => {
  await open(page, 390);
  await page.getByRole("button", { name: "Previous month" }).click();
  await expect(page.getByText(/^No budgets for/)).toBeVisible();
  await expect(page.getByText("Left this month")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Copy from/ })).toBeVisible();
  // Nothing is budgeted, so the fold is open and every category can be tapped.
  await expect(page.getByText("6 without a budget")).toBeVisible();
  await expect(page.getByRole("button", { name: /^Food/ })).toBeVisible();
  expect(await noSideways(page)).toBe(true);
});

test("a folded category opens the sheet from the fold", async ({ page }) => {
  await open(page, 390);
  await page.getByText("2 without a budget").click();
  await page.getByRole("button", { name: /^Health/ }).click();
  const sheet = page.getByRole("dialog", { name: "Set limit" });
  await expect(sheet).toBeVisible();
  await expect(sheet).toContainText("Health");
  await expect(sheet.getByRole("button", { name: "Remove limit" })).toHaveCount(
    0,
  );
});

test("on a phone Set limit is a sheet at the bottom with Remove limit and Save pinned in one row", async ({
  page,
}) => {
  await open(page, 390);
  await page.getByRole("button", { name: /^Transport/ }).click();
  const sheet = page.getByRole("dialog", { name: "Set limit" });
  await expect(sheet).toBeVisible();
  const found = await settled(sheet);
  expect(Math.abs(found.x)).toBeLessThan(1);
  expect(Math.abs(found.width - 390)).toBeLessThan(1);
  expect(Math.abs(found.y + found.height - 900)).toBeLessThan(1);
  const save = sheet.getByRole("button", { name: "Save" });
  const remove = sheet.getByRole("button", { name: "Remove limit" });
  const [a, b] = [await box(save), await box(remove)];
  expect(a.y + a.height).toBeLessThanOrEqual(900);
  expect(Math.abs(a.y - b.y)).toBeLessThan(1);
  for (const target of [save, remove]) {
    expect((await box(target)).height).toBeGreaterThanOrEqual(43.9);
  }
  for (const label of ["$50", "$100", "$150", "$250"])
    expect(
      await is44(page, sheet.getByRole("button", { name: label, exact: true })),
    ).toBe(true);
  expect(
    await is44(page, sheet.getByRole("switch", { name: /Carry over/ })),
  ).toBe(true);
});

test("from 700 px Set limit is a drawer on the right", async ({ page }) => {
  await open(page, 1280);
  await page.getByRole("button", { name: /^Transport/ }).click();
  const sheet = page.getByRole("dialog", { name: "Set limit" });
  await expect(sheet).toBeVisible();
  const found = await settled(sheet);
  expect(Math.abs(found.x + found.width - 1280)).toBeLessThan(1);
  expect(found.width).toBeLessThan(600);
  expect(found.height).toBeGreaterThan(800);
});

test("a preset fills the big amount, Save says so and the sheet closes", async ({
  page,
}) => {
  await open(page, 390);
  await page.getByRole("button", { name: /^Transport/ }).click();
  const sheet = page.getByRole("dialog", { name: "Set limit" });
  await sheet.getByRole("button", { name: "$250", exact: true }).click();
  await expect(sheet.getByLabel(/Budget for the month/)).toHaveValue("250.00");
  await sheet.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Limit saved.")).toBeVisible();
  await expect(sheet).toHaveCount(0);
});

test("Remove limit takes the limit away in one tap and says so", async ({
  page,
}) => {
  await open(page, 390);
  await page.getByRole("button", { name: /^Fun/ }).click();
  const sheet = page.getByRole("dialog", { name: "Set limit" });
  await sheet.getByRole("button", { name: "Remove limit" }).click();
  await expect(page.getByText("Limit removed")).toBeVisible();
  await expect(sheet).toHaveCount(0);
});

for (const theme of ["light", "dark"] as const)
  for (const width of [390, 1280])
    test(`has no accessibility violations in ${theme} at ${width} px, with the sheet shut and open`, async ({
      page,
    }) => {
      await open(page, width, theme);
      const check = async () =>
        (await new AxeBuilder({ page }).analyze()).violations.map(
          (item) =>
            `${item.id}: ${item.nodes.map((node) => node.target.join(" ")).join(" | ")}`,
        );
      expect(await check()).toEqual([]);
      await page.getByRole("button", { name: /^Transport/ }).click();
      const sheet = page.getByRole("dialog", { name: "Set limit" });
      await settled(sheet);
      expect(await check()).toEqual([]);
    });
