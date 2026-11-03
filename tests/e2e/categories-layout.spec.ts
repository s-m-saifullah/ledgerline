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

// Loans in a real browser (ADR 0047, PR 11), against the approved prototype: jsdom cannot run container
// queries, so one pane or two, the Add button of each width, the card, the rows, the sheets against the drawer
// and the Add loan sheet's height are measured here. The people are mocked, so the owner's ledger is never changed.
const { env, pool } = connectLocalDatabase("Categories layout browser tests");
const fixtures: string[] = [];
test.beforeEach(async ({ page }, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop",
    "one project is enough: these tests set their own widths",
  );
  const ledgerId = newId();
  fixtures.push(ledgerId);
  await createOwnerLedger(pool, env, ledgerId, "E2E categories layout ledger");
  await prepareBrowser(page, testInfo, {
    ledgerId,
    name: "Synthetic categories layout ledger",
    forwarded: [228, 24],
  });
});
test.afterEach(async () => {
  for (const id of fixtures) {
    await pool.query(
      "UPDATE ledger_members SET deleted_at=now(), updated_at=now() WHERE ledger_id=$1",
      [id],
    );
    await pool.query(
      "UPDATE ledgers SET deleted_at=now(), updated_at=now() WHERE id=$1 AND name LIKE 'E2E categories layout ledger%'",
      [id],
    );
  }
  fixtures.length = 0;
});
test.afterAll(async () => {
  await pool.end();
});

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
const cut = (node: Locator) =>
  node.evaluate((n) => n.scrollWidth <= n.clientWidth + 1);
const sheet = (page: Page) => page.locator(".ui-sheet");

const stamp = "2026-10-01T00:00:00.000Z";
const uuid = (n: number) =>
  `01a1a000-0000-7000-8000-${String(n).padStart(12, "0")}`;
const cat = (n: number, name: string, over: Record<string, unknown> = {}) => ({
  id: uuid(n),
  ledgerId: uuid(1),
  name,
  kind: "expense",
  parentId: null,
  icon: "utensils",
  color: "#0D9488",
  sortOrder: n,
  archivedAt: null,
  version: 1,
  createdAt: stamp,
  updatedAt: stamp,
  ...over,
});
const FOOD = uuid(10);
const LONG_NAME =
  `Household with a very long name ${"that keeps going ".repeat(4)}`.trim();
const categories = [
  cat(10, "Food"),
  cat(11, "Groceries", { parentId: FOOD, sortOrder: 0 }),
  cat(12, "Dining out", { parentId: FOOD, sortOrder: 1 }),
  cat(13, LONG_NAME, { icon: "house" }),
  cat(14, "Transport", { icon: "bus" }),
  cat(15, "Old hobby", { archivedAt: stamp }),
  cat(20, "Salary", { kind: "income", sortOrder: 0 }),
  cat(21, "Gifts", { kind: "income", sortOrder: 1 }),
];

/** Categories answered from memory. */
async function withCategories(page: Page) {
  await page.route(/\/categories\?/, (route) =>
    route.fulfill({ json: { items: categories, nextCursor: null } }),
  );
}
async function open(
  page: Page,
  width: number,
  theme?: "light" | "dark",
  reduce = true,
) {
  if (reduce) await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width, height: 900 });
  await signIn(page);
  await withCategories(page);
  await page.goto("/categories");
  await page.waitForFunction(
    () => getComputedStyle(document.body).containerType === "inline-size",
  );
  if (theme) await setTheme(page, theme);
  await expect(page.locator("#categories-title")).toBeAttached();
  await expect(page.locator(".cg-toggle").first()).toBeVisible();
}
const actions = (page: Page, name: string) =>
  page.getByRole("button", { name: `Actions for ${name}`, exact: true });

for (const theme of ["light", "dark"] as const)
  for (const width of [320, 390, 1280])
    test(`fits ${width} px in ${theme}: rows, chips and actions are real targets, nothing cut`, async ({
      page,
    }) => {
      await open(page, width, theme);
      expect(await noSideways(page)).toBe(true);
      const narrow = width < 700;
      // One kind under 700 px, both from it.
      await expect(page.locator(".cg-col:visible")).toHaveCount(narrow ? 1 : 2);
      await page.getByRole("button", { name: "Expand all" }).click();
      for (const head of await page
        .locator(
          ".cg-col:visible .cg-head, .cg-col:visible .cg-toggle:not(.cg-head .cg-toggle)",
        )
        .all()) {
        expect((await box(head)).height).toBeGreaterThanOrEqual(56);
      }
      for (const row of await page.locator(".cg-col:visible .cg-sub").all()) {
        expect((await box(row)).height).toBeGreaterThanOrEqual(48);
        expect(await cut(row.locator(".ui-row-title"))).toBe(true);
      }
      for (const title of await page
        .locator(".cg-col:visible .ui-row-title")
        .all())
        expect(await cut(title)).toBe(true);
      for (const button of await page
        .locator(".cg-col:visible")
        .getByRole("button", { name: /^Actions for/ })
        .all())
        expect(await is44(page, button)).toBe(true);
      for (const chip of await page.locator(".cg-chips button").all())
        expect(await is44(page, chip)).toBe(true);
      expect(
        (await box(page.getByRole("searchbox"))).height,
      ).toBeGreaterThanOrEqual(43.9);
      expect(await noSideways(page)).toBe(true);
    });

test("a phone shows one kind through the switch with counts; a desktop shows both side by side", async ({
  page,
}) => {
  await open(page, 390);
  const kind = page.getByRole("radiogroup", { name: "Category kind" });
  await expect(kind.getByRole("radio", { name: "Expense 3" })).toBeChecked();
  await expect(kind.getByRole("radio", { name: "Income 2" })).toBeVisible();
  await expect(actions(page, "Salary")).toBeHidden();
  await kind.getByRole("radio", { name: "Income 2" }).click();
  await expect(actions(page, "Salary")).toBeVisible();
  await expect(actions(page, "Food")).toBeHidden();
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(kind).toBeHidden();
  await expect(actions(page, "Salary")).toBeVisible();
  await expect(actions(page, "Food")).toBeVisible();
  const [expense, income] = await Promise.all([
    box(page.locator(".cg-col").nth(0)),
    box(page.locator(".cg-col").nth(1)),
  ]);
  expect(income.x).toBeGreaterThan(expense.x + expense.width - 1);
  expect(Math.abs(income.y - expense.y)).toBeLessThan(2);
  await expect(page.getByText("EXPENSE · 3", { exact: false })).toBeVisible();
});

test("the accordion opens a main category to its subcategories, and search opens them", async ({
  page,
}) => {
  await open(page, 390);
  await expect(page.getByText("Groceries")).toHaveCount(0);
  await page.getByRole("button", { name: /^Food/ }).click();
  await expect(page.getByText("Groceries")).toBeVisible();
  await expect(page.getByRole("button", { name: /^Food/ })).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  await page.getByRole("button", { name: /^Food/ }).click();
  await expect(page.getByText("Groceries")).toHaveCount(0);
  await page.getByRole("searchbox").fill("dining");
  await expect(page.getByText("Dining out")).toBeVisible();
  await expect(page.getByText("Transport")).toHaveCount(0);
});

test("the actions sheet is a bottom sheet on a phone and a drawer from 700 px, with Delete last in red", async ({
  page,
}) => {
  await open(page, 390);
  await actions(page, "Food").click();
  const phone = await settled(sheet(page));
  expect(Math.abs(phone.x)).toBeLessThan(1);
  expect(Math.abs(phone.width - 390)).toBeLessThan(1);
  expect(Math.abs(phone.y + phone.height - 900)).toBeLessThan(1);
  const dialog = page.getByRole("dialog", { name: "Food", exact: true });
  const titles = dialog.locator(".ui-row-title");
  await expect(titles).toHaveText([
    "Edit",
    "Add subcategory",
    "Move up",
    "Move down",
    "Merge into…",
    "Archive",
    "Delete",
  ]);
  await expect(titles.last()).toHaveCSS("color", /rgb/);
  const color = await titles.last().evaluate((n) => getComputedStyle(n).color);
  const plain = await titles.first().evaluate((n) => getComputedStyle(n).color);
  expect(color).not.toBe(plain);
  for (const row of await dialog.locator(".ui-row").all())
    expect((await box(row)).height).toBeGreaterThanOrEqual(56);
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 1280, height: 900 });
  await actions(page, "Food").click();
  const drawer = await settled(sheet(page));
  expect(drawer.width).toBeLessThanOrEqual(560);
  expect(drawer.x + drawer.width).toBeGreaterThan(1279);
});

for (const width of [320, 390])
  test(`the icon and colour lists draw each option with its icon or colour at ${width} px`, async ({
    page,
  }) => {
    await open(page, width);
    await page.locator("#mobile-add-page").click();
    const editor = page.getByRole("dialog", { name: "Add category" });
    await settled(sheet(page));
    for (const [row, count] of [
      ["Category icon", 19],
      ["Category color", 9],
    ] as const) {
      await editor.getByRole("button", { name: new RegExp(`^${row}`) }).click();
      const list = editor.getByRole("radiogroup", { name: row });
      const options = list.getByRole("radio");
      await expect(options).toHaveCount(count);
      for (const option of await options.all()) {
        expect((await box(option)).height).toBeGreaterThanOrEqual(48);
        // Each option carries its icon or its colour, so the choice is seen, not only read.
        await expect(option.locator("svg, .cg-swatch").first()).toBeVisible();
      }
      expect(
        await editor
          .locator(".ui-sheet-body")
          .evaluate((n) => n.scrollWidth <= n.clientWidth),
      ).toBe(true);
      // Choosing closes the list and the row shows the choice with its look.
      await options.nth(1).click();
      await expect(list).toHaveCount(0);
      await expect(
        editor
          .getByRole("button", { name: new RegExp(`^${row}`) })
          .locator("svg, .cg-swatch")
          .first(),
      ).toBeVisible();
    }
    // The save button stays on screen with the lists open.
    await editor.getByRole("button", { name: /^Category icon/ }).click();
    const foot = await box(editor.locator(".ui-sheet-foot"));
    expect(foot.y + foot.height).toBeLessThanOrEqual(900.5);
  });

test("the editor, the starter question and the Delete question fit", async ({
  page,
}) => {
  await open(page, 390);
  await page.locator("#mobile-add-page").click();
  const editor = page.getByRole("dialog", { name: "Add category" });
  await settled(sheet(page));
  await expect(editor.getByLabel("Category name")).toBeFocused();
  await expect(editor.getByRole("radio", { name: "Expense" })).toBeChecked();
  expect(
    await editor
      .locator(".ui-sheet-body")
      .evaluate((n) => n.scrollWidth <= n.clientWidth),
  ).toBe(true);
  await expect(
    editor.getByRole("button", { name: "Save", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await actions(page, "Transport").click();
  await page
    .getByRole("dialog", { name: "Transport", exact: true })
    .getByRole("button", { name: "Delete" })
    .click();
  const ask = page.getByRole("dialog", { name: "Delete Transport?" });
  const q = await settled(page.locator(".ui-question"));
  expect(Math.abs(q.x + q.width / 2 - 195)).toBeLessThan(2);
  expect(Math.abs(q.y + q.height / 2 - 450)).toBeLessThan(2);
  await expect(
    ask.getByRole("button", { name: "Delete", exact: true }),
  ).toBeVisible();
  await expect(ask).toContainText("A deleted category has no Undo");
});

for (const theme of ["light", "dark"] as const)
  test(`passes axe in ${theme}: the list, the actions sheet and the editor`, async ({
    page,
  }) => {
    await open(page, 390, theme);
    const scan = async () => {
      const result = await new AxeBuilder({ page }).analyze();
      expect(result.violations).toEqual([]);
    };
    await scan();
    await actions(page, "Food").click();
    await settled(sheet(page));
    await scan();
    await page.keyboard.press("Escape");
    await page.locator("#mobile-add-page").click();
    await settled(sheet(page));
    await scan();
  });
