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

// Recurring in a real browser (ADR 0047, PR 13b), against the approved prototype: jsdom cannot run container
// queries, so the Add button of each width, the rows, the folds, the sheet against the drawer and the question
// are measured here. The rules are mocked, so the owner's ledger is never changed.
const { env, pool } = connectLocalDatabase("Recurring layout browser tests");
const fixtures: string[] = [];
test.beforeEach(async ({ page }, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop",
    "one project is enough: these tests set their own widths",
  );
  const ledgerId = newId();
  fixtures.push(ledgerId);
  await createOwnerLedger(pool, env, ledgerId, "E2E recurring layout ledger");
  await prepareBrowser(page, testInfo, {
    ledgerId,
    name: "Synthetic recurring layout ledger",
    timeZone: "America/Chicago",
    forwarded: [232, 20],
  });
});
test.afterEach(async () => {
  for (const id of fixtures) {
    await pool.query(
      "UPDATE ledger_members SET deleted_at=now(), updated_at=now() WHERE ledger_id=$1",
      [id],
    );
    await pool.query(
      "UPDATE ledgers SET deleted_at=now(), updated_at=now() WHERE id=$1 AND name LIKE 'E2E recurring layout ledger%'",
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
const BANK = uuid(10);
const SAVINGS = uuid(11);
const HOUSING = uuid(30);
const SALARY = uuid(31);
const account = (n: number, name: string, type: string) => ({
  id: uuid(n),
  ledgerId: uuid(1),
  name,
  type,
  currency: "USD",
  openingBalance: { amount: 100000, currency: "USD" },
  inboundBonusBps: null,
  bonusCategoryId: null,
  feeCategoryId: null,
  defaultFee: null,
  contactId: null,
  balance: { amount: 100000, currency: "USD" },
  archivedAt: null,
  version: 1,
  createdAt: stamp,
  updatedAt: stamp,
});
const category = (n: number, name: string, kind: string) => ({
  id: uuid(n),
  ledgerId: uuid(1),
  name,
  kind,
  parentId: null,
  icon: null,
  color: null,
  sortOrder: n,
  archivedAt: null,
  version: 1,
  createdAt: stamp,
  updatedAt: stamp,
});
const rule = (
  n: number,
  title: string,
  over: Record<string, unknown> = {},
) => ({
  id: uuid(n),
  ledgerId: uuid(1),
  title,
  kind: "expense",
  accountId: BANK,
  toAccountId: null,
  categoryId: HOUSING,
  amount: { amount: -120000, currency: "USD" },
  receivedAmount: null,
  bonus: null,
  fee: null,
  payee: null,
  note: null,
  tagIds: [],
  frequency: "month",
  interval: 1,
  startDate: "2026-11-01",
  endDate: null,
  nextDate: "2026-11-01",
  paused: false,
  pausedReason: null,
  needsAttention: 0,
  version: 1,
  createdAt: stamp,
  updatedAt: stamp,
  ...over,
});
const LONG_TITLE =
  `Quarterly insurance premium with a very long name ${"that keeps going ".repeat(1)}`.trim();
const rules = [
  rule(40, "Rent"),
  rule(41, "Salary", {
    kind: "income",
    categoryId: SALARY,
    amount: { amount: 450000, currency: "USD" },
    frequency: "week",
    interval: 2,
  }),
  rule(42, "Savings plan", {
    kind: "transfer",
    toAccountId: SAVINGS,
    categoryId: null,
    amount: { amount: 20000, currency: "USD" },
    needsAttention: 2,
  }),
  rule(43, "Gym", { paused: true, pausedReason: "manual" }),
  rule(44, LONG_TITLE),
];

/** Rules, accounts and categories answered from memory. */
async function withRecurring(page: Page, list = rules) {
  await page.route(/\/recurring-rules$/, (route) =>
    route.fulfill({ json: { items: list, nextCursor: null } }),
  );
  await page.route(/\/recurring-rules\/[^/]+\/runs$/, (route) =>
    route.fulfill({ json: { items: [], nextCursor: null } }),
  );
  await page.route(/\/accounts\?/, (route) =>
    route.fulfill({
      json: {
        items: [
          account(10, "Harbor Checking", "bank"),
          account(11, "Rainy Day", "savings"),
        ],
        nextCursor: null,
      },
    }),
  );
  await page.route(/\/categories\?/, (route) =>
    route.fulfill({
      json: {
        items: [
          category(30, "Housing", "expense"),
          category(31, "Pay", "income"),
        ],
        nextCursor: null,
      },
    }),
  );
}
async function open(
  page: Page,
  width: number,
  theme?: "light" | "dark",
  list = rules,
) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width, height: 900 });
  await signIn(page);
  await withRecurring(page, list);
  await page.goto("/recurring");
  await page.waitForFunction(
    () => getComputedStyle(document.body).containerType === "inline-size",
  );
  if (theme) await setTheme(page, theme);
  await expect(page.locator("#recurring-title")).toBeAttached();
  if (list.length > 0)
    await expect(page.locator(".rc-row").first()).toBeVisible();
}
const row = (page: Page, name: string) =>
  page.getByRole("button", { name: new RegExp(`^${name} `) });
/** A corner's radius in px. */
const radius = (node: Locator, corner: string) =>
  node.evaluate(
    (n, name) => Number.parseFloat(getComputedStyle(n).getPropertyValue(name)),
    corner,
  );

for (const theme of ["light", "dark"] as const)
  for (const width of [320, 390, 1280])
    test(`fits ${width} px in ${theme}: rows are real targets, one hint each, nothing cut`, async ({
      page,
    }) => {
      await open(page, width, theme);
      expect(await noSideways(page)).toBe(true);
      for (const item of await page.locator(".rc-row").all()) {
        expect((await box(item)).height).toBeGreaterThanOrEqual(56);
        expect(await is44(page, item)).toBe(true);
      }
      for (const title of await page.locator(".rc-page .ui-row-title").all())
        expect(await cut(title)).toBe(true);
      await expect(row(page, "Rent")).toContainText(
        "Expense · Every month · Next",
      );
      await expect(row(page, "Rent")).toContainText("Harbor Checking");
      await expect(row(page, "Salary")).toContainText("Income · Every 2 weeks");
      await expect(row(page, "Savings plan")).toContainText(
        "Transfer · Every month",
      );
      await expect(row(page, "Savings plan")).toContainText("2 need attention");
      await expect(row(page, "Gym")).toContainText("Paused");
      expect(await noSideways(page)).toBe(true);
    });

test("a phone has the shell's one Add; from 700 px the page's own button leads", async ({
  page,
}) => {
  await open(page, 390);
  await expect(page.locator("#add-rule")).toBeHidden();
  await expect(page.locator("#mobile-add-page")).toHaveAccessibleName(
    "Add rule",
  );
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(page.locator("#add-rule")).toBeVisible();
  await expect(page.locator("#mobile-add-page")).toBeHidden();
});

test("an empty list has one first-rule button on a phone and on a desktop", async ({
  page,
}) => {
  await open(page, 390, undefined, []);
  await expect(page.getByText("Nothing recurring yet.")).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Add .*rule/ }).filter({ visible: true }),
  ).toHaveCount(1);
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(
    page.getByRole("button", { name: /Add .*rule/ }).filter({ visible: true }),
  ).toHaveCount(1);
});

test("the rule sheet is a bottom sheet on a phone and a drawer from 700 px", async ({
  page,
}) => {
  await open(page, 390);
  await row(page, "Rent").click();
  const phone = await settled(sheet(page));
  expect(Math.abs(phone.x)).toBeLessThan(1);
  expect(Math.abs(phone.width - 390)).toBeLessThan(1);
  expect(Math.abs(phone.y + phone.height - 900)).toBeLessThan(1);
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 1280, height: 900 });
  await row(page, "Rent").click();
  const drawer = await settled(sheet(page));
  expect(drawer.width).toBeLessThanOrEqual(560);
  expect(drawer.x + drawer.width).toBeGreaterThan(1279);
});

for (const width of [320, 390])
  test(`a new rule's sheet fits ${width} px: name first, nothing past the edge, Save on screen`, async ({
    page,
  }) => {
    await open(page, width);
    await page.locator("#mobile-add-page").click();
    const editor = page.getByRole("dialog", { name: "New recurring entry" });
    await settled(sheet(page));
    await expect(editor.getByLabel("Name")).toBeFocused();
    await expect(editor.getByRole("radio", { name: "Expense" })).toBeChecked();
    await expect(editor.getByLabel("Amount (USD)")).toBeVisible();
    // Every is a count: text typed into it never stays (the owner's report).
    const every = editor.getByLabel("Every", { exact: true });
    await every.fill("two 2 weeks");
    await expect(every).toHaveValue("2");
    await every.fill("1");
    // A transfer adds the receiving account, the fee and the bonus.
    await editor.getByRole("radio", { name: "Transfer" }).click();
    await editor.getByLabel("To account").selectOption(SAVINGS);
    await expect(editor.getByLabel("Fee (optional)")).toBeVisible();
    // With no fee typed the fee's row is one row tall; its live line appears only with a fee.
    const feeBlock = editor.locator(".rc-block", {
      has: page.locator("#rule-fee"),
    });
    expect((await box(feeBlock)).height).toBeLessThan(60);
    await expect(editor.locator("#rule-fee-preview")).toBeHidden();
    await editor.getByLabel("Fee (optional)").fill("2%");
    await expect(editor.locator("#rule-fee-preview")).toBeVisible();
    await editor.getByLabel("Fee (optional)").fill("");
    await editor
      .getByRole("switch", { name: "Add a bonus to each transfer" })
      .click();
    await expect(editor.getByLabel("Bonus amount (USD)")).toBeVisible();
    // Choosing a bonus without its category opens More by itself: it is open already.
    await expect(editor.locator(".rc-fold").first()).toHaveAttribute(
      "open",
      "",
    );
    await expect(editor.getByLabel("Fee category")).toBeVisible();
    await expect(editor.getByLabel("Bonus category")).toBeVisible();
    const body = editor.locator(".ui-sheet-body");
    expect(await body.evaluate((n) => n.scrollWidth <= n.clientWidth)).toBe(
      true,
    );
    for (const control of await editor
      .locator(".ui-seg, .ui-pick-row, .rc-fold > summary")
      .all())
      expect((await box(control)).height).toBeGreaterThanOrEqual(43.9);
    await expect(
      editor.getByRole("button", { name: "Save", exact: true }),
    ).toBeVisible();
    const foot = await box(editor.locator(".ui-sheet-foot"));
    expect(foot.y + foot.height).toBeLessThanOrEqual(900.5);
    // A new rule has no Active switch and no Delete.
    await expect(editor.getByRole("switch", { name: "Active" })).toHaveCount(0);
    await expect(
      editor.getByRole("button", { name: "Delete rule" }),
    ).toHaveCount(0);
  });

for (const width of [320, 390])
  test(`the Category list offers "Create expense category" for a new name at ${width} px, as Add transaction does`, async ({
    page,
  }) => {
    await open(page, width);
    const posts: unknown[] = [];
    await page.route(/\/categories$/, async (route) => {
      if (route.request().method() !== "POST") return route.fallback();
      posts.push(route.request().postDataJSON());
      await route.fulfill({
        status: 201,
        json: category(50, "Insurance", "expense"),
      });
    });
    await page.locator("#mobile-add-page").click();
    const editor = page.getByRole("dialog", { name: "New recurring entry" });
    await settled(sheet(page));
    const combo = editor.getByLabel("Category", { exact: true });
    await combo.click();
    await combo.fill("Insurance");
    const create = editor
      .getByRole("listbox", { name: "Category options" })
      .getByRole("option", { name: "Create expense category “Insurance”" });
    await expect(create).toBeVisible();
    // The row is a real target and sits inside the sheet.
    expect((await box(create)).height).toBeGreaterThanOrEqual(43.9);
    expect(
      await editor
        .locator(".ui-sheet-body")
        .evaluate((n) => n.scrollWidth <= n.clientWidth),
    ).toBe(true);
    await create.click();
    await expect.poll(() => posts.length).toBe(1);
    expect(posts[0]).toMatchObject({
      name: "Insurance",
      kind: "expense",
      parentId: null,
    });
    await expect(combo).toHaveValue(/Insurance/);
    // An income rule offers an income category.
    await editor.getByRole("radio", { name: "Income" }).click();
    await combo.fill("Gift");
    await expect(
      editor.getByRole("option", { name: "Create income category “Gift”" }),
    ).toBeVisible();
  });

test("an existing rule's sheet has the Active switch, the trash beside Save, and a history fold", async ({
  page,
}) => {
  await open(page, 390);
  await row(page, "Rent").click();
  const editor = page.getByRole("dialog", { name: "Rent" });
  await settled(sheet(page));
  const active = editor.getByRole("switch", { name: "Active" });
  await expect(active).toHaveAttribute("aria-checked", "true");
  expect((await box(active)).height).toBeGreaterThanOrEqual(56);
  const trash = editor.getByRole("button", { name: "Delete rule" });
  const save = editor.getByRole("button", { name: "Save", exact: true });
  const [t, s] = await Promise.all([box(trash), box(save)]);
  expect(Math.abs(t.y - s.y)).toBeLessThan(3);
  expect(t.x).toBeLessThan(s.x);
  await expect(editor.getByText("What it has done")).toBeVisible();
  await expect(editor.locator(".rc-fold").last().locator("summary")).toHaveText(
    "What it has done",
  );
});

for (const width of [320, 390, 1280])
  test(`Starts opens the shared calendar picker at ${width} px, a picked day lands in the box, Escape closes only the picker`, async ({
    page,
  }) => {
    await open(page, width);
    await row(page, "Rent").click();
    const editor = page.getByRole("dialog", { name: "Rent" });
    await settled(sheet(page));
    const start = editor.getByLabel("Starts", { exact: true });
    await editor.getByRole("button", { name: "Choose starts" }).click();
    const picker = page.getByRole("dialog", { name: "Starts" });
    await expect(picker).toBeVisible();
    const found = await settled(picker);
    expect(found.x).toBeGreaterThanOrEqual(0);
    expect(found.x + found.width).toBeLessThanOrEqual(width + 0.5);
    expect(found.y + found.height).toBeLessThanOrEqual(900.5);
    // It is the shared sheet: Cancel in its head, Today pinned in its footer.
    await expect(picker).toHaveClass(/ui-sheet/);
    await expect(picker.getByRole("button", { name: "Cancel" })).toBeVisible();
    await expect(
      picker.locator(".ui-sheet-foot").getByRole("button", { name: "Today" }),
    ).toBeVisible();
    await picker.locator('[data-date="2026-11-15"]').click();
    await expect(start).toHaveValue("2026-11-15");
    await editor.getByRole("button", { name: "Choose starts" }).click();
    await page.keyboard.press("Escape");
    await expect(picker).toHaveCount(0);
    await expect(editor).toBeVisible();
    // The box stays a real 44 px row with its calendar button inside it, and nothing runs past the sheet.
    const trigger = editor.getByRole("button", { name: "Choose starts" });
    expect(await is44(page, trigger)).toBe(true);
    expect(
      await editor
        .locator(".ui-sheet-body")
        .evaluate((n) => n.scrollWidth <= n.clientWidth),
    ).toBe(true);
  });

test("a paused rule's switch is off", async ({ page }) => {
  await open(page, 390);
  await row(page, "Gym").click();
  await expect(
    page
      .getByRole("dialog", { name: "Gym" })
      .getByRole("switch", { name: "Active" }),
  ).toHaveAttribute("aria-checked", "false");
});

test("Delete asks in a centred question, and Cancel keeps the sheet and its work", async ({
  page,
}) => {
  await open(page, 390);
  await row(page, "Rent").click();
  const editor = page.getByRole("dialog", { name: "Rent" });
  await settled(sheet(page));
  await editor.getByLabel("Name").fill("Rent kept");
  await editor.getByRole("button", { name: "Delete rule" }).click();
  const ask = page.getByRole("dialog", { name: "Delete Rent?" });
  const q = await settled(page.locator(".ui-question"));
  expect(Math.abs(q.x + q.width / 2 - 195)).toBeLessThan(2);
  expect(Math.abs(q.y + q.height / 2 - 450)).toBeLessThan(2);
  await expect(ask).toContainText("keeps the entries it already made");
  await expect(
    ask.getByRole("button", { name: "Delete", exact: true }),
  ).toBeVisible();
  await ask.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("dialog", { name: "Delete Rent?" })).toHaveCount(
    0,
  );
  // The sheet and what was typed in it are still there, and focus is back on the trash.
  await expect(page.getByRole("dialog", { name: /^Rent/ })).toBeVisible();
  await expect(editor.getByLabel("Name")).toHaveValue("Rent kept");
  await expect(
    editor.getByRole("button", { name: "Delete rule" }),
  ).toBeFocused();
});

for (const width of [320, 390, 1280])
  test(`a shut fold keeps one row's padding at ${width} px, and open it only adds its body`, async ({
    page,
  }) => {
    await open(page, width);
    await row(page, "Rent").click();
    const editor = page.getByRole("dialog", { name: "Rent" });
    await settled(sheet(page));
    for (const fold of await editor.locator(".rc-fold").all()) {
      await fold.scrollIntoViewIfNeeded();
      const [card, summary] = await Promise.all([
        box(fold),
        box(fold.locator("summary")),
      ]);
      expect(card.height - summary.height).toBeLessThanOrEqual(2.5);
      expect(summary.height).toBeGreaterThanOrEqual(56);
      const text = await box(fold.locator("summary > span"));
      expect(
        Math.abs(
          text.y - card.y - (card.y + card.height - (text.y + text.height)),
        ),
      ).toBeLessThan(2);
    }
    const more = editor.locator(".rc-fold").first();
    const shut = await box(more);
    await more.locator("summary").click();
    await expect
      .poll(async () => (await box(more)).height)
      .toBeGreaterThan(shut.height + 100);
    await more.locator("summary").click();
    await expect
      .poll(async () => (await box(more)).height)
      .toBeLessThan(shut.height + 2.5);
  });

for (const theme of ["light", "dark"] as const)
  test(`a focused row's ring follows the card's corners in ${theme}`, async ({
    page,
  }) => {
    await open(page, 390, theme);
    await row(page, "Savings plan").click();
    const editor = page.getByRole("dialog", { name: "Savings plan" });
    await settled(sheet(page));
    for (const card of await editor.locator(".rc-card").all())
      expect(await card.evaluate((n) => getComputedStyle(n).overflow)).toBe(
        "visible",
      );
    // The last row of the schedule card is the Active switch; the last of the first card is To account.
    const toAccount = editor.locator(".ui-pick-row").nth(1);
    expect(
      await radius(toAccount, "border-bottom-left-radius"),
    ).toBeGreaterThan(12);
    const active = editor.getByRole("switch", { name: "Active" });
    await active.focus();
    expect(await radius(active, "border-bottom-left-radius")).toBeGreaterThan(
      12,
    );
    expect(await radius(active, "border-bottom-right-radius")).toBeGreaterThan(
      12,
    );
  });

test("privacy mode removes the amounts from the rows", async ({ page }) => {
  await open(page, 390);
  await page
    .getByRole("button", { name: "Hide amounts", exact: true })
    .first()
    .click();
  await expect(row(page, "Rent")).not.toContainText("1,200");
  await expect(row(page, "Rent").getByText("Amount hidden")).toBeAttached();
  expect(await page.locator(".rc-page").textContent()).not.toContain("4,500");
});

for (const theme of ["light", "dark"] as const)
  test(`passes axe in ${theme}: the list, the rule sheet, a new transfer and the Delete question`, async ({
    page,
  }) => {
    await open(page, 390, theme);
    const scan = async () => {
      const result = await new AxeBuilder({ page }).analyze();
      expect(result.violations).toEqual([]);
    };
    await scan();
    await row(page, "Rent").click();
    await settled(sheet(page));
    await scan();
    await page
      .getByRole("dialog", { name: "Rent" })
      .getByRole("button", { name: "Delete rule" })
      .click();
    await settled(page.locator(".ui-question"));
    await scan();
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    await page.locator("#mobile-add-page").click();
    const editor = page.getByRole("dialog", { name: "New recurring entry" });
    await settled(sheet(page));
    await editor.getByRole("radio", { name: "Transfer" }).click();
    await editor.getByLabel("To account").selectOption(SAVINGS);
    await scan();
  });
