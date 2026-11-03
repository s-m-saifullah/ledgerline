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

// Accounts in a real browser (ADR 0047, PR 13a), against the approved prototype: jsdom cannot run container
// queries, so one column or two, the Add button of each width, the rows, the fold, the sheets against the drawer
// and the questions are measured here. The accounts are mocked, so the owner's ledger is never changed.
const { env, pool } = connectLocalDatabase("Accounts layout browser tests");
const fixtures: string[] = [];
test.beforeEach(async ({ page }, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop",
    "one project is enough: these tests set their own widths",
  );
  const ledgerId = newId();
  fixtures.push(ledgerId);
  await createOwnerLedger(pool, env, ledgerId, "E2E accounts layout ledger");
  await prepareBrowser(page, testInfo, {
    ledgerId,
    name: "Synthetic accounts layout ledger",
    forwarded: [228, 40],
  });
});
test.afterEach(async () => {
  for (const id of fixtures) {
    await pool.query(
      "UPDATE ledger_members SET deleted_at=now(), updated_at=now() WHERE ledger_id=$1",
      [id],
    );
    await pool.query(
      "UPDATE ledgers SET deleted_at=now(), updated_at=now() WHERE id=$1 AND name LIKE 'E2E accounts layout ledger%'",
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
const account = (
  n: number,
  name: string,
  type: string,
  amount: number,
  over: Record<string, unknown> = {},
) => ({
  id: uuid(n),
  ledgerId: uuid(1),
  name,
  type,
  currency: "USD",
  openingBalance: { amount, currency: "USD" },
  inboundBonusBps: null,
  bonusCategoryId: null,
  feeCategoryId: null,
  defaultFee: null,
  contactId: null,
  balance: { amount, currency: "USD" },
  archivedAt: null,
  version: 1,
  createdAt: stamp,
  updatedAt: stamp,
  ...over,
});
const LONG_NAME =
  `Household account with a very long name ${"that keeps going ".repeat(3)}`.trim();
const accounts = [
  account(10, "Harbor Checking", "bank", 120000),
  account(11, "Rainy Day", "savings", 540000),
  account(12, "Pocket", "cash", -2500),
  account(13, LONG_NAME, "wallet", 8000),
  account(20, "Everyday Visa", "card", -125050),
  account(21, "Car loan", "loan", -990000),
  account(30, "Old Passbook", "savings", 0, { archivedAt: stamp }),
];

/** Accounts answered from memory; `currencies` adds a second one to the ledger. */
async function withAccounts(page: Page, currencies = false) {
  await page.route(/\/accounts\?/, (route) =>
    route.fulfill({ json: { items: accounts, nextCursor: null } }),
  );
  if (currencies)
    await page.route(/\/currencies$/, (route) =>
      route.fulfill({
        json: {
          baseCurrency: "USD",
          items: [
            {
              id: uuid(40),
              ledgerId: uuid(1),
              code: "EUR",
              version: 1,
              latestRate: null,
              createdAt: stamp,
              updatedAt: stamp,
            },
          ],
        },
      }),
    );
}
async function open(
  page: Page,
  width: number,
  theme?: "light" | "dark",
  currencies = false,
) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width, height: 900 });
  await signIn(page);
  await withAccounts(page, currencies);
  await page.goto("/accounts");
  await page.waitForFunction(
    () => getComputedStyle(document.body).containerType === "inline-size",
  );
  if (theme) await setTheme(page, theme);
  await expect(page.locator("#accounts-title")).toBeAttached();
  await expect(page.locator(".ac-row").first()).toBeVisible();
}
const row = (page: Page, name: string) =>
  page.getByRole("button", {
    name: new RegExp(
      `^${name} (Bank account|Cash|Credit card|Mobile wallet|Loan|Savings) ·`,
    ),
  });

for (const theme of ["light", "dark"] as const)
  for (const width of [320, 390, 1280])
    test(`fits ${width} px in ${theme}: one column or two, rows are real targets, nothing cut`, async ({
      page,
    }) => {
      await open(page, width, theme);
      expect(await noSideways(page)).toBe(true);
      const columns = page.locator(".ac-col");
      await expect(columns).toHaveCount(2);
      const [cash, debt] = await Promise.all([
        box(columns.nth(0)),
        box(columns.nth(1)),
      ]);
      if (width < 700) {
        // One under the other.
        expect(debt.y).toBeGreaterThan(cash.y + cash.height - 1);
        expect(Math.abs(debt.x - cash.x)).toBeLessThan(2);
      } else {
        // Side by side, from the top.
        expect(debt.x).toBeGreaterThan(cash.x + cash.width - 1);
        expect(Math.abs(debt.y - cash.y)).toBeLessThan(2);
      }
      for (const label of ["Cash and banking", "Cards and loans"])
        await expect(page.getByText(label, { exact: true })).toBeVisible();
      for (const item of await page.locator(".ac-col .ac-row").all()) {
        expect((await box(item)).height).toBeGreaterThanOrEqual(56);
        expect(await is44(page, item)).toBe(true);
      }
      // A long name wraps in its row; it is never cut or pushed past the edge.
      for (const title of await page.locator(".ac-col .ui-row-title").all())
        expect(await cut(title)).toBe(true);
      expect(await noSideways(page)).toBe(true);
    });

test("a phone has the shell's one Add; from 700 px the page's own button leads", async ({
  page,
}) => {
  await open(page, 390);
  await expect(page.locator("#add-account")).toBeHidden();
  await expect(page.locator("#mobile-add-page")).toHaveAccessibleName(
    "Add account",
  );
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(page.locator("#add-account")).toBeVisible();
  await expect(page.locator("#mobile-add-page")).toBeHidden();
});

test("the rows say what each account is, and a balance owed or overdrawn reads as such", async ({
  page,
}) => {
  await open(page, 390);
  await expect(row(page, "Harbor Checking")).toContainText(
    "Bank account · USD",
  );
  await expect(row(page, "Everyday Visa")).toContainText(
    "Credit card · USD · Owed",
  );
  await expect(row(page, "Everyday Visa")).toContainText("-$1,250.50");
  await expect(row(page, "Pocket")).toContainText("Cash · USD · Overdrawn");
  // Red is only for money to hand below zero.
  const red = (name: string) =>
    row(page, name)
      .locator(".ac-neg, .ui-row-end > span")
      .first()
      .evaluate((n) => getComputedStyle(n).color);
  expect(await red("Pocket")).not.toBe(await red("Everyday Visa"));
});

test("the archived accounts are one fold under the cards, shut until opened", async ({
  page,
}) => {
  await open(page, 390);
  const fold = page.locator(".ac-fold");
  await expect(fold.locator("summary")).toHaveText("1 archived");
  await expect(row(page, "Old Passbook")).toBeHidden();
  expect((await box(fold.locator("summary"))).height).toBeGreaterThanOrEqual(
    56,
  );
  await fold.locator("summary").click();
  await expect(row(page, "Old Passbook")).toBeVisible();
  expect(await is44(page, row(page, "Old Passbook"))).toBe(true);
  // The fold sits under both cards, as wide as the page's content.
  const [cards, shut] = await Promise.all([
    box(page.locator(".ac-cols")),
    box(fold),
  ]);
  expect(shut.y).toBeGreaterThan(cards.y + cards.height - 1);
  expect(Math.abs(shut.width - cards.width)).toBeLessThan(2);
  expect(await noSideways(page)).toBe(true);
});

/** A shut fold is its one row and its border, nothing more: the card adds no padding of its own (owner's report). */
async function expectShutFoldIsItsRow(fold: Locator) {
  const [card, row] = await Promise.all([
    box(fold),
    box(fold.locator("summary")),
  ]);
  expect(card.height - row.height).toBeLessThanOrEqual(2.5);
  expect(row.height).toBeGreaterThanOrEqual(56);
  // The row's text sits in the middle of the card, so the space above and below it is the same.
  const text = await box(fold.locator("summary > span"));
  const above = text.y - card.y;
  const below = card.y + card.height - (text.y + text.height);
  expect(Math.abs(above - below)).toBeLessThan(2);
}

for (const width of [320, 390, 1280])
  test(`a shut fold keeps one row's padding at ${width} px, and open it only adds its body`, async ({
    page,
  }) => {
    await open(page, width);
    const archived = page.locator(".ac-fold");
    await expectShutFoldIsItsRow(archived);
    await page
      .locator("#mobile-add-page, #add-account")
      .locator("visible=true")
      .first()
      .click();
    await settled(sheet(page));
    const more = page.locator(".ac-more-fold");
    await more.scrollIntoViewIfNeeded();
    await expectShutFoldIsItsRow(more);
    const shut = await box(more);
    await more.locator("summary").click();
    // Opening keeps the row where it was; the body is what grows.
    await expect
      .poll(async () => (await box(more)).height)
      .toBeGreaterThan(shut.height + 100);
    const row = await box(more.locator("summary"));
    expect(Math.abs(row.height - 56)).toBeLessThan(2);
    await more.locator("summary").click();
    await expect
      .poll(async () => (await box(more)).height)
      .toBeLessThan(shut.height + 2.5);
    await expectShutFoldIsItsRow(more);
  });

test("the account sheet is a bottom sheet on a phone and a drawer from 700 px", async ({
  page,
}) => {
  await open(page, 390);
  await row(page, "Harbor Checking").click();
  const phone = await settled(sheet(page));
  expect(Math.abs(phone.x)).toBeLessThan(1);
  expect(Math.abs(phone.width - 390)).toBeLessThan(1);
  expect(Math.abs(phone.y + phone.height - 900)).toBeLessThan(1);
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 1280, height: 900 });
  await row(page, "Harbor Checking").click();
  const drawer = await settled(sheet(page));
  expect(drawer.width).toBeLessThanOrEqual(560);
  expect(drawer.x + drawer.width).toBeGreaterThan(1279);
});

for (const width of [320, 390])
  test(`the editor fits ${width} px: name first, nothing past the edge, Save on screen, More and the direction included`, async ({
    page,
  }) => {
    await open(page, width, undefined, true);
    await page.locator("#mobile-add-page").click();
    const editor = page.getByRole("dialog", { name: "Add account" });
    await settled(sheet(page));
    await expect(editor.getByLabel("Account name")).toBeFocused();
    // A second currency in the ledger gives the currency row; a card flips the direction to Money owed.
    await expect(editor.getByLabel("Currency")).toBeVisible();
    await editor.getByLabel("Account type").selectOption("card");
    await expect(
      editor.getByRole("radio", { name: "Money owed" }),
    ).toBeChecked();
    await editor.getByText("More", { exact: true }).click();
    await expect(editor.getByLabel("Bonus rate (%)")).toBeVisible();
    await expect(editor.getByLabel("Usual fee")).toBeVisible();
    await editor.getByLabel("Bonus rate (%)").fill("2.5");
    await expect(editor.getByLabel("Bonus category")).toBeVisible();
    const body = editor.locator(".ui-sheet-body");
    expect(await body.evaluate((n) => n.scrollWidth <= n.clientWidth)).toBe(
      true,
    );
    for (const control of await editor
      .locator(".ui-seg, .ui-pick-row, .ac-more-fold > summary")
      .all())
      expect((await box(control)).height).toBeGreaterThanOrEqual(43.9);
    const save = editor.getByRole("button", { name: "Save", exact: true });
    await expect(save).toBeVisible();
    const foot = await box(editor.locator(".ui-sheet-foot"));
    expect(foot.y + foot.height).toBeLessThanOrEqual(900.5);
    // A new account has no Archive or Delete.
    await expect(editor.getByRole("button", { name: "Delete" })).toHaveCount(0);
  });

/** A corner's radius in px. */
const radius = (node: Locator, corner: string) =>
  node.evaluate(
    (n, name) => Number.parseFloat(getComputedStyle(n).getPropertyValue(name)),
    corner,
  );

for (const theme of ["light", "dark"] as const)
  test(`a focused row's ring follows the card's corners, not cut square, in ${theme} (owner's report)`, async ({
    page,
  }) => {
    await open(page, 390, theme);
    await row(page, "Harbor Checking").click();
    const editor = page.getByRole("dialog", { name: "Edit account" });
    await settled(sheet(page));
    // No card clips its rows: a clip is what cut the ring.
    for (const card of await editor.locator(".ac-card").all())
      expect(await card.evaluate((n) => getComputedStyle(n).overflow)).toBe(
        "visible",
      );
    // The first row of the type card is the one that holds the ring at the top corners.
    await editor.getByLabel("Account type").focus();
    const pick = editor.locator(".ui-pick-row").first();
    await expect(pick).toHaveCSS("outline-style", "solid");
    expect(await radius(pick, "border-top-left-radius")).toBeGreaterThan(12);
    expect(await radius(pick, "border-top-right-radius")).toBeGreaterThan(12);
    // The last row of the Archive and Delete card holds it at the bottom ones.
    const remove = editor.getByRole("button", { name: "Delete", exact: true });
    expect(await radius(remove, "border-bottom-left-radius")).toBeGreaterThan(
      12,
    );
    expect(await radius(remove, "border-bottom-right-radius")).toBeGreaterThan(
      12,
    );
    const archive = editor.getByRole("button", {
      name: "Archive",
      exact: true,
    });
    expect(await radius(archive, "border-top-left-radius")).toBeGreaterThan(12);
    // And the ring stays inside the sheet's body, whole.
    const [ring, body] = await Promise.all([
      box(pick),
      box(editor.locator(".ui-sheet-body")),
    ]);
    expect(ring.x).toBeGreaterThanOrEqual(body.x);
    expect(ring.x + ring.width).toBeLessThanOrEqual(body.x + body.width + 0.5);
  });

test("the currency row is left out of a ledger with one currency", async ({
  page,
}) => {
  await open(page, 390);
  await page.locator("#mobile-add-page").click();
  const editor = page.getByRole("dialog", { name: "Add account" });
  await settled(sheet(page));
  await expect(editor.getByLabel("Account name")).toBeFocused();
  await expect(editor.getByLabel("Currency")).toHaveCount(0);
});

test("an account's sheet ends with Archive and Delete, Delete in red, and Delete asks first", async ({
  page,
}) => {
  await open(page, 390);
  await row(page, "Harbor Checking").click();
  const editor = page.getByRole("dialog", { name: "Edit account" });
  await settled(sheet(page));
  const archive = editor.getByRole("button", { name: "Archive", exact: true });
  const remove = editor.getByRole("button", { name: "Delete", exact: true });
  for (const item of [archive, remove]) {
    expect((await box(item)).height).toBeGreaterThanOrEqual(56);
    expect(await is44(page, item)).toBe(true);
  }
  const colour = (node: Locator) =>
    node.locator(".ui-row-title").evaluate((n) => getComputedStyle(n).color);
  expect(await colour(remove)).not.toBe(await colour(archive));
  // Delete comes after Archive.
  expect((await box(remove)).y).toBeGreaterThan((await box(archive)).y);
  await remove.click();
  const ask = page.getByRole("dialog", { name: "Delete Harbor Checking?" });
  const q = await settled(page.locator(".ui-question"));
  expect(Math.abs(q.x + q.width / 2 - 195)).toBeLessThan(2);
  expect(Math.abs(q.y + q.height / 2 - 450)).toBeLessThan(2);
  await expect(
    ask.getByRole("button", { name: "Delete", exact: true }),
  ).toBeVisible();
  await expect(ask).toContainText("A deleted account has no Undo");
  await ask.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  // Focus comes back to the row that opened it.
  await expect(row(page, "Harbor Checking")).toBeFocused();
});

test("an archived account's sheet says Unarchive, not Archive", async ({
  page,
}) => {
  await open(page, 390);
  await page.locator(".ac-fold summary").click();
  await row(page, "Old Passbook").click();
  const editor = page.getByRole("dialog", { name: "Edit account" });
  await expect(
    editor.getByRole("button", { name: "Unarchive", exact: true }),
  ).toBeVisible();
  await expect(
    editor.getByRole("button", { name: "Archive", exact: true }),
  ).toHaveCount(0);
});

test("privacy mode removes the balances from the rows", async ({ page }) => {
  await open(page, 390);
  await page
    .getByRole("button", { name: "Hide amounts", exact: true })
    .first()
    .click();
  await expect(row(page, "Harbor Checking")).not.toContainText("1,200");
  await expect(
    row(page, "Harbor Checking").getByText("Amount hidden"),
  ).toBeAttached();
  expect(await page.locator(".ac-page").textContent()).not.toContain("1,250");
});

for (const theme of ["light", "dark"] as const)
  test(`passes axe in ${theme}: the list, the account sheet and the Delete question`, async ({
    page,
  }) => {
    await open(page, 390, theme);
    const scan = async () => {
      const result = await new AxeBuilder({ page }).analyze();
      expect(result.violations).toEqual([]);
    };
    await scan();
    await row(page, "Harbor Checking").click();
    await settled(sheet(page));
    await scan();
    await page
      .getByRole("dialog", { name: "Edit account" })
      .getByRole("button", { name: "Delete", exact: true })
      .click();
    await settled(page.locator(".ui-question"));
    await scan();
  });
