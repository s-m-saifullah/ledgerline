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

// Insights in a real browser (ADR 0047, PR 8), against the approved prototype: jsdom cannot run container queries,
// so the columns from 700 px, the month control's place, the figures that wrap instead of breaking, the row sizes,
// the chart's blur and the disclosure are measured here. The reports and accounts are mocked, so the shared owner's
// ledger is never changed.
const { env, pool } = connectLocalDatabase("Insights layout browser tests");
const fixtures: string[] = [];
test.beforeEach(async ({ page }, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop",
    "one project is enough: these tests set their own widths",
  );
  const ledgerId = newId();
  fixtures.push(ledgerId);
  await createOwnerLedger(pool, env, ledgerId, "E2E insights layout ledger");
  await prepareBrowser(page, testInfo, {
    ledgerId,
    name: "Synthetic insights layout ledger",
    forwarded: [225, 22],
  });
});
test.afterEach(async () => {
  for (const id of fixtures) {
    await pool.query(
      "UPDATE ledger_members SET deleted_at=now(), updated_at=now() WHERE ledger_id=$1",
      [id],
    );
    await pool.query(
      "UPDATE ledgers SET deleted_at=now(), updated_at=now() WHERE id=$1 AND name LIKE 'E2E insights layout ledger%'",
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
  `01a19000-0000-7000-8000-${String(n).padStart(12, "0")}`;
const stamp = "2026-10-01T00:00:00.000Z";
const now = new Date();
const ym = (shift: number) => {
  const date = new Date(now.getFullYear(), now.getMonth() + shift, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
};
const month = ym(0);
const category = (
  n: number,
  name: string,
  cents: number,
  total: number,
  children: unknown[] = [],
) => ({
  categoryId: uuid(n),
  name,
  color: null,
  archived: false,
  amount: usd(cents),
  shareBps: Math.round((cents / total) * 10000),
  children,
});
const lines: [string, number][] = [
  ["Home", 159450],
  ["Food", 41635],
  ["Transport", 21215],
  ["Fun", 5499],
  ["Health", 1840],
  ["Other", 4100],
  ["Gifts", 900],
];
const total = lines.reduce((sum, [, cents]) => sum + cents, 0);
const spending = {
  month,
  monthStart: `${month}-01`,
  monthEnd: `${month}-28`,
  total: usd(total),
  categories: lines.map(([name, cents], index) =>
    category(
      100 + index,
      name,
      cents,
      total,
      name === "Food"
        ? [
            category(200, "Groceries", 30000, total),
            category(201, "Dining", 8000, total),
          ]
        : [],
    ),
  ),
};
function cashFlow(active = 12) {
  const months = Array.from({ length: 12 }, (_, index) => {
    const current = index === 11;
    const on = index >= 12 - active;
    const income = current ? 543840 : 0;
    const out = current ? total : on ? 120000 + index * 9000 : 0;
    return {
      month: ym(index - 11),
      income: usd(income),
      spending: usd(out),
      net: usd(income - out),
    };
  });
  return { from: ym(-11), to: month, months };
}
/** Net worth from the month the ledger started to be used: `count` months ending now (12 is a full window). */
const netWorthFor = (count: number) => ({
  from: ym(-11),
  to: month,
  historyStart: ym(1 - count),
  months: Array.from({ length: count }, (_, index) => {
    const at = index + 12 - count;
    return {
      month: ym(at - 11),
      asOf: `${ym(at - 11)}-28`,
      netWorth: usd(at < 2 ? -50000 + at * 20000 : 400000 + at * 90000),
      unconvertedCurrencies: at === 4 ? ["EUR"] : [],
    };
  }),
});
const account = (
  n: number,
  type: string,
  balance: number,
  currency = "USD",
) => ({
  id: uuid(300 + n),
  ledgerId: uuid(1),
  name: `${type} ${n}`,
  type,
  currency,
  openingBalance: usd(balance),
  inboundBonusBps: null,
  bonusCategoryId: null,
  feeCategoryId: null,
  defaultFee: null,
  contactId: null,
  balance: { amount: balance, currency },
  archivedAt: null,
  version: 1,
  createdAt: stamp,
  updatedAt: stamp,
});
const held = [
  account(1, "bank", 1456176),
  account(2, "cash", 105589),
  account(3, "card", -61230),
  account(4, "loan", -600000),
];

async function withReports(
  page: Page,
  {
    active = 12,
    accounts = held,
    months = 12,
  }: { active?: number; accounts?: unknown[]; months?: number } = {},
) {
  await page.route("**/api/v1/ledgers/*/reports/spending?*", (route) =>
    route.fulfill({ json: spending }),
  );
  await page.route("**/api/v1/ledgers/*/reports/cash-flow?*", (route) =>
    route.fulfill({ json: cashFlow(active) }),
  );
  await page.route("**/api/v1/ledgers/*/reports/net-worth?*", (route) =>
    route.fulfill({ json: netWorthFor(months) }),
  );
  await page.route("**/api/v1/ledgers/*/accounts?*", (route) =>
    route.fulfill({ json: { items: accounts, nextCursor: null } }),
  );
}
async function open(
  page: Page,
  width: number,
  theme?: "light" | "dark",
  options: Parameters<typeof withReports>[1] = {},
) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width, height: 900 });
  await signIn(page);
  await withReports(page, options);
  await page.goto("/insights");
  await page.waitForFunction(
    () => getComputedStyle(document.body).containerType === "inline-size",
  );
  if (theme) await setTheme(page, theme);
  await expect(page.getByRole("region", { name: "This month" })).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Net worth over time" }),
  ).toBeVisible();
}
const box = async (locator: Locator) => {
  const found = await locator.boundingBox();
  if (!found) throw new Error("not on screen");
  return found;
};
const card = (page: Page, name: string) =>
  page.getByRole("region", { name, exact: true });
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

for (const theme of ["light", "dark"] as const)
  for (const width of [320, 390, 1280])
    test(`fits ${width} px in ${theme}: five cards, figures whole inside them, each row a real target`, async ({
      page,
    }) => {
      await open(page, width, theme);
      expect(await noSideways(page)).toBe(true);
      for (const name of [
        "This month",
        "Spending",
        "Money in and out",
        "Net worth now",
        "Net worth over time",
      ])
        await expect(card(page, name)).toBeVisible();
      // Every figure sits whole inside its card: wrapped to the next line, never cut and never broken.
      for (const figure of await page.locator(".ins-fig, .ui-figure").all()) {
        const inside = await figure.evaluate((node) => {
          const own = node.getBoundingClientRect();
          const parent = (
            node.closest("section") as Element
          ).getBoundingClientRect();
          const lines =
            own.height / Number.parseFloat(getComputedStyle(node).lineHeight);
          return own.right <= parent.right && lines < 1.6;
        });
        expect(inside).toBe(true);
      }
      const rows = card(page, "Spending").locator(".ins-cat");
      await expect(rows).toHaveCount(7);
      for (const row of await rows.all()) {
        expect((await box(row)).height).toBeGreaterThanOrEqual(56);
        expect(await is44(page, row)).toBe(true);
      }
      for (const name of ["Previous month", "Next month"])
        expect(await is44(page, page.getByRole("button", { name }))).toBe(true);
      expect(await is44(page, page.getByText("Show the figures"))).toBe(true);
    });

test("a phone has one column", async ({ page }) => {
  await open(page, 390);
  const cards = [
    await box(card(page, "This month")),
    await box(card(page, "Spending")),
    await box(card(page, "Money in and out")),
    await box(card(page, "Net worth now")),
    await box(card(page, "Net worth over time")),
  ];
  for (const [index, found] of cards.entries()) {
    expect(Math.abs(found.x - (cards[0]?.x ?? 0))).toBeLessThan(1);
    if (index > 0) {
      const above = cards[index - 1] as { y: number; height: number };
      expect(found.y).toBeGreaterThan(above.y + above.height - 1);
    }
  }
});

// Widths are the page's own: the rail takes 88 px and the sidebar 248 px, so 800 px is a 712 px page.
for (const width of [800, 1099, 1280])
  test(`from a 700 px page spending is beside money in and out and net worth now (${width} px)`, async ({
    page,
  }) => {
    await open(page, width);
    const spendingBox = await box(card(page, "Spending"));
    const flowBox = await box(card(page, "Money in and out"));
    const nowBox = await box(card(page, "Net worth now"));
    expect(flowBox.x).toBeGreaterThan(spendingBox.x + spendingBox.width - 1);
    expect(Math.abs(spendingBox.y - flowBox.y)).toBeLessThan(1);
    expect(Math.abs(spendingBox.width - flowBox.width)).toBeLessThan(2);
    expect(Math.abs(flowBox.x - nowBox.x)).toBeLessThan(1);
    expect(nowBox.y).toBeGreaterThan(flowBox.y + flowBox.height - 1);
    // This month is above both and Net worth over time spans the page below them.
    const summary = await box(card(page, "This month"));
    const over = await box(card(page, "Net worth over time"));
    expect(summary.y + summary.height).toBeLessThanOrEqual(spendingBox.y + 1);
    expect(over.y).toBeGreaterThan(spendingBox.y + spendingBox.height - 1);
    expect(Math.abs(over.width - summary.width)).toBeLessThan(2);
    expect(await noSideways(page)).toBe(true);
  });

test("the month control sits under the top bar on a phone and in the head from 700 px", async ({
  page,
}) => {
  await open(page, 390);
  const title = page.getByRole("heading", { level: 1, name: "Insights" });
  expect((await box(title)).width).toBeLessThanOrEqual(1);
  const control = await box(page.locator(".month-head-control"));
  expect(Math.abs(control.x + control.width / 2 - 195)).toBeLessThan(3);

  await open(page, 1280);
  const head = await box(title);
  const wide = await box(page.locator(".month-head-control"));
  const summary = await box(card(page, "This month"));
  expect(head.width).toBeGreaterThan(40);
  expect(wide.x).toBeGreaterThan(head.x + head.width);
  expect(
    Math.abs(wide.x + wide.width - (summary.x + summary.width)),
  ).toBeLessThan(16);
});

test("a main category opens to its subcategories and its own entries", async ({
  page,
}) => {
  await open(page, 390);
  const food = card(page, "Spending").getByRole("button", { name: /^Food/ });
  await expect(food).toHaveAttribute("aria-expanded", "false");
  await food.click();
  await expect(food).toHaveAttribute("aria-expanded", "true");
  for (const name of [/^Groceries/, /^Dining/, /^Directly in Food/]) {
    const link = page.getByRole("link", { name });
    await expect(link).toBeVisible();
    expect(await is44(page, link)).toBe(true);
  }
  // A subcategory's name lines up with its parent's, under the colour key.
  const titleX = async (row: Locator) =>
    (await box(row.locator(".ui-row-title"))).x;
  expect(
    Math.abs(
      (await titleX(food)) -
        (await titleX(page.getByRole("link", { name: /^Groceries/ }))),
    ),
  ).toBeLessThan(1);
  await page.getByRole("link", { name: /^Groceries/ }).click();
  await expect(page).toHaveURL(/\/transactions\?.*categoryId=/);
});

test("Show the figures opens both tables, and the global disclosure style gives way", async ({
  page,
}) => {
  await open(page, 390);
  const summary = page.getByText("Show the figures");
  await expect(page.getByRole("table")).toHaveCount(0);
  expect(
    await summary.locator("xpath=ancestor::summary").evaluate((node) => {
      const style = getComputedStyle(node);
      return [
        style.borderTopWidth,
        style.borderTopLeftRadius,
        getComputedStyle(node, "::before").display,
      ];
    }),
  ).toEqual(["0px", "0px", "none"]);
  await summary.click();
  const tables = page.getByRole("table");
  await expect(tables).toHaveCount(2);
  await expect(tables.first()).toContainText("Oct 2026");
  expect(await noSideways(page)).toBe(true);
  const [a, b] = [await box(tables.first()), await box(tables.last())];
  expect(b.y - (a.y + a.height)).toBeGreaterThanOrEqual(16);
});

test("more than one currency leaves Net worth now out, and a quiet ledger gives spending the whole width", async ({
  page,
}) => {
  await open(page, 1280, undefined, {
    active: 1,
    accounts: [account(1, "bank", 100), account(2, "bank", 100, "EUR")],
  });
  await expect(card(page, "Net worth now")).toHaveCount(0);
  await expect(card(page, "Money in and out")).toHaveCount(0);
  const spendingBox = await box(card(page, "Spending"));
  const summary = await box(card(page, "This month"));
  expect(Math.abs(spendingBox.width - summary.width)).toBeLessThan(2);
  // One table, for net worth: the cash flow chart is not drawn.
  await page.getByText("Show the figures").click();
  await expect(page.getByRole("table")).toHaveCount(1);
});

test("the charts blur with the digits in privacy mode", async ({ page }) => {
  await open(page, 1280);
  const filter = () =>
    page
      .locator(".ins-chart")
      .first()
      .evaluate((node) => getComputedStyle(node).filter);
  expect(await filter()).toBe("none");
  await page.getByRole("button", { name: "Hide amounts", exact: true }).click();
  expect(await filter()).toContain("blur(6px)");
  expect(await page.locator("main").innerText()).not.toMatch(/\$\s?\d/);
});

for (const theme of ["light", "dark"] as const)
  for (const width of [390, 1280])
    test(`has no accessibility violations in ${theme} at ${width} px, with a category and the figures open`, async ({
      page,
    }) => {
      await open(page, width, theme);
      const check = async () =>
        (await new AxeBuilder({ page }).analyze()).violations.map(
          (item) =>
            `${item.id}: ${item.nodes.map((node) => node.target.join(" ")).join(" | ")}`,
        );
      expect(await check()).toEqual([]);
      await card(page, "Spending")
        .getByRole("button", { name: /^Food/ })
        .click();
      await page.getByText("Show the figures").click();
      expect(await check()).toEqual([]);
    });

test("the charts and the figures begin on the month the ledger started to be used", async ({
  page,
}) => {
  await open(page, 1280, undefined, { months: 3 });
  const flow = card(page, "Money in and out").locator(".ins-month");
  const worth = card(page, "Net worth over time").locator(".ins-month");
  await expect(flow).toHaveCount(3);
  await expect(worth).toHaveCount(3);
  // The same three months, in the same columns (10 to 12 of 12), at the right of each chart's own card.
  const [a, b] = [await flow.all(), await worth.all()];
  for (const [index, item] of a.entries()) {
    const other = b[index] as Locator;
    expect(await item.innerText()).toBe(await other.innerText());
    expect(
      await item.evaluate((node) => getComputedStyle(node).gridColumnStart),
    ).toBe(
      await other.evaluate((node) => getComputedStyle(node).gridColumnStart),
    );
  }
  for (const [name, items] of [
    ["Money in and out", a],
    ["Net worth over time", b],
  ] as const) {
    const whole = await box(card(page, name));
    const first = await box(items[0] as Locator);
    const last = await box(items[2] as Locator);
    expect(first.x).toBeGreaterThan(whole.x + whole.width / 2);
    expect(whole.x + whole.width - (last.x + last.width)).toBeLessThan(24);
  }
  // A table row for each of those months and no more.
  await page.getByText("Show the figures").click();
  const tables = page.getByRole("table");
  await expect(tables.first().locator("tbody tr")).toHaveCount(3);
  await expect(tables.last().locator("tbody tr")).toHaveCount(3);
});

test("a full window draws twelve months in both charts", async ({ page }) => {
  await open(page, 1280);
  await expect(
    card(page, "Money in and out").locator(".ins-month"),
  ).toHaveCount(12);
  await expect(
    card(page, "Net worth over time").locator(".ins-month"),
  ).toHaveCount(12);
});
