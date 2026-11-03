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

// Currencies in a real browser (ADR 0047, PR 13c), against the approved prototype: jsdom cannot run container
// queries, so the page's width, the head's buttons, the rows, the sheets against the drawer, the date fold and the
// questions are measured here. The currencies are mocked, so the owner's ledger is never changed.
const { env, pool } = connectLocalDatabase("Currencies layout browser tests");
const fixtures: string[] = [];
test.beforeEach(async ({ page }, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop",
    "one project is enough: these tests set their own widths",
  );
  const ledgerId = newId();
  fixtures.push(ledgerId);
  await createOwnerLedger(pool, env, ledgerId, "E2E currencies layout ledger");
  await prepareBrowser(page, testInfo, {
    ledgerId,
    name: "Synthetic currencies layout ledger",
    forwarded: [236, 40],
  });
});
test.afterEach(async () => {
  for (const id of fixtures) {
    await pool.query(
      "UPDATE ledger_members SET deleted_at=now(), updated_at=now() WHERE ledger_id=$1",
      [id],
    );
    await pool.query(
      "UPDATE ledgers SET deleted_at=now(), updated_at=now() WHERE id=$1 AND name LIKE 'E2E currencies layout ledger%'",
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
const rate = (code: string, value: string, source: "api" | "manual") => ({
  id: uuid(100 + code.charCodeAt(0)),
  ledgerId: uuid(1),
  code,
  date: "2026-10-01",
  rate: value,
  source,
  version: 1,
  createdAt: stamp,
  updatedAt: stamp,
});
const pinned = (n: number, code: string, latestRate: unknown) => ({
  id: uuid(n),
  ledgerId: uuid(1),
  code,
  version: 1,
  latestRate,
  createdAt: stamp,
  updatedAt: stamp,
});
const currencies = {
  baseCurrency: "USD",
  items: [
    pinned(10, "EUR", rate("EUR", "1.1217", "api")),
    pinned(11, "GBP", rate("GBP", "1.3", "manual")),
    pinned(12, "JPY", null),
    pinned(13, "BDT", rate("BDT", "0.0083", "manual")),
  ],
};

async function open(page: Page, width: number, theme?: "light" | "dark") {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width, height: 900 });
  await signIn(page);
  await page.route(/\/api\/v1\/ledgers\/[^/]+\/currencies$/, (route) =>
    route.fulfill({ json: currencies }),
  );
  await page.goto("/currencies");
  await page.waitForFunction(
    () => getComputedStyle(document.body).containerType === "inline-size",
  );
  if (theme) await setTheme(page, theme);
  await expect(page.locator("#currencies-title")).toBeAttached();
  await expect(page.locator(".cu-row").first()).toBeVisible();
}
const row = (page: Page, name: string) =>
  page.getByRole("button", { name: new RegExp(`^${name}`) });

for (const theme of ["light", "dark"] as const)
  for (const width of [320, 390, 1280])
    test(`fits ${width} px in ${theme}: the base first, rows are real targets, the code fits its tile, capped near 760 px`, async ({
      page,
    }) => {
      await open(page, width, theme);
      expect(await noSideways(page)).toBe(true);
      const items = page.locator(".ui-list > .cu-row");
      await expect(items).toHaveCount(5);
      // The base currency is first and is not pressable.
      const base = items.first();
      await expect(base).toContainText("US Dollar");
      await expect(base).toContainText("Base");
      expect(await base.evaluate((n) => n.tagName)).toBe("DIV");
      for (const item of await items.all()) {
        expect((await box(item)).height).toBeGreaterThanOrEqual(56);
      }
      for (const item of await page.locator(".ui-list > button.cu-row").all())
        expect(await is44(page, item)).toBe(true);
      // Each code sits whole in its tile, at the type scale's floor.
      for (const code of await page.locator(".cu-code").all()) {
        expect(await cut(code)).toBe(true);
        expect(
          await code.evaluate((n) =>
            Number.parseFloat(getComputedStyle(n).fontSize),
          ),
        ).toBeGreaterThanOrEqual(10);
        const [tile, text] = await Promise.all([
          box(code.locator("xpath=..")),
          box(code),
        ]);
        expect(text.x).toBeGreaterThanOrEqual(tile.x - 0.5);
        expect(text.x + text.width).toBeLessThanOrEqual(
          tile.x + tile.width + 0.5,
        );
      }
      for (const title of await page.locator(".cu-row .ui-row-title").all())
        expect(await cut(title)).toBe(true);
      const card = await box(page.locator(".ui-list"));
      expect(card.width).toBeLessThanOrEqual(760.5);
      expect(await noSideways(page)).toBe(true);
    });

test("a phone keeps Refresh rates in the head and has the shell's one Add; from 700 px the page's own button leads", async ({
  page,
}) => {
  await open(page, 320);
  const refresh = page.getByRole("button", { name: "Refresh rates" });
  await expect(refresh).toBeVisible();
  expect(await is44(page, refresh)).toBe(true);
  await expect(page.locator("#add-currency")).toBeHidden();
  await expect(page.locator("#mobile-add-page")).toHaveAccessibleName(
    "Add currency",
  );
  expect(await noSideways(page)).toBe(true);
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(page.locator("#add-currency")).toBeVisible();
  await expect(refresh).toBeVisible();
  await expect(page.locator("#mobile-add-page")).toBeHidden();
  // Both head buttons sit on one line with the title.
  const [title, add, again] = await Promise.all([
    box(page.locator("#currencies-title")),
    box(page.locator("#add-currency")),
    box(refresh),
  ]);
  expect(Math.abs(add.y - again.y)).toBeLessThan(2);
  expect(
    Math.abs(title.y + title.height / 2 - (add.y + add.height / 2)),
  ).toBeLessThan(8);
});

test("the rows hint the rate base first and who set it, one line, no subtitle", async ({
  page,
}) => {
  await open(page, 390);
  await expect(row(page, "Euro")).toContainText(
    "1 USD = 0.891504 EUR · fetched",
  );
  await expect(row(page, "British Pound")).toContainText("set by you");
  await expect(row(page, "Japanese Yen")).toContainText("No rate yet");
  await expect(page.getByText("Your base currency is")).toHaveCount(0);
  await expect(page.getByText("MAKE IT YOURS")).toHaveCount(0);
});

test("Refresh rates says what it did in a toast, and the page does not move sideways", async ({
  page,
}) => {
  await open(page, 390);
  await page.route(/\/exchange-rates\/refresh$/, (route) =>
    route.fulfill({ json: { updated: 1, keptManual: 2, failed: ["JPY"] } }),
  );
  await page.getByRole("button", { name: "Refresh rates" }).click();
  await expect(
    page.getByText(
      "Updated 1 rate. Kept 2 you set yourself. Couldn't fetch JPY. You can set those by hand.",
    ),
  ).toBeVisible();
  expect(await noSideways(page)).toBe(true);
});

test("a currency's sheet is a bottom sheet on a phone and a drawer from 700 px", async ({
  page,
}) => {
  await open(page, 390);
  await row(page, "Euro").click();
  const phone = await settled(sheet(page));
  expect(Math.abs(phone.x)).toBeLessThan(1);
  expect(Math.abs(phone.width - 390)).toBeLessThan(1);
  expect(Math.abs(phone.y + phone.height - 900)).toBeLessThan(1);
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 1280, height: 900 });
  await row(page, "Euro").click();
  const drawer = await settled(sheet(page));
  expect(drawer.width).toBeLessThanOrEqual(560);
  expect(drawer.x + drawer.width).toBeGreaterThan(1279);
});

for (const width of [320, 390])
  test(`the rate sheet fits ${width} px: the rate, its source, the field in focus, the trash beside Save`, async ({
    page,
  }) => {
    await open(page, width);
    await row(page, "British Pound").click();
    const dialog = page.getByRole("dialog", { name: "British Pound" });
    await settled(sheet(page));
    await expect(dialog.getByLabel("Set the rate yourself")).toBeFocused();
    const rows = dialog.locator(".cu-card > .ui-row");
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0)).toContainText("Rate");
    await expect(rows.nth(0)).toContainText("1 USD in GBP");
    await expect(rows.nth(0)).toContainText("0.769231");
    await expect(rows.nth(1)).toContainText("Source");
    await expect(rows.nth(1)).toContainText("Set by you");
    await expect(rows.nth(1)).toContainText("2026-10-01");
    const field = dialog.getByLabel("Set the rate yourself");
    expect((await box(field)).height).toBeGreaterThanOrEqual(43.9);
    const body = dialog.locator(".ui-sheet-body");
    expect(await body.evaluate((n) => n.scrollWidth <= n.clientWidth)).toBe(
      true,
    );
    // The trash sits beside Save in the pinned foot, both real targets, on screen.
    const trash = dialog.getByRole("button", { name: "Remove currency" });
    const save = dialog.getByRole("button", { name: "Save", exact: true });
    expect(await is44(page, trash)).toBe(true);
    expect(await is44(page, save)).toBe(true);
    const [t, s, foot] = await Promise.all([
      box(trash),
      box(save),
      box(dialog.locator(".ui-sheet-foot")),
    ]);
    expect(Math.abs(t.y - s.y)).toBeLessThan(2);
    expect(t.x).toBeLessThan(s.x);
    expect(foot.y + foot.height).toBeLessThanOrEqual(900.5);
    // There is no date to pick and no More: a rate set here counts for today.
    await expect(dialog.getByText("More", { exact: true })).toHaveCount(0);
    await expect(dialog.getByLabel("Date", { exact: true })).toHaveCount(0);
    // A currency without a rate shows no source and an empty field.
    await page.keyboard.press("Escape");
    await row(page, "Japanese Yen").click();
    const empty = page.getByRole("dialog", { name: "Japanese Yen" });
    await settled(sheet(page));
    await expect(empty.getByLabel("Set the rate yourself")).toHaveValue("");
    await expect(empty.locator(".cu-card > .ui-row")).toHaveCount(1);
    await expect(empty.getByText("None yet")).toBeVisible();
  });

test("Remove currency asks in a centred question over the sheet; Cancel returns to it", async ({
  page,
}) => {
  await open(page, 390);
  await row(page, "Euro").click();
  await settled(sheet(page));
  await page.getByRole("button", { name: "Remove currency" }).click();
  const ask = page.getByRole("dialog", { name: "Remove EUR?" });
  const q = await settled(page.locator(".ui-question"));
  expect(Math.abs(q.x + q.width / 2 - 195)).toBeLessThan(2);
  expect(Math.abs(q.y + q.height / 2 - 450)).toBeLessThan(2);
  await expect(ask).toContainText(
    "Its stored rates and the entries in it are kept.",
  );
  await expect(
    ask.getByRole("button", { name: "Remove", exact: true }),
  ).toBeVisible();
  await ask.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("dialog", { name: "Remove EUR?" })).toHaveCount(
    0,
  );
  await expect(page.getByRole("dialog", { name: "Euro" })).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(row(page, "Euro")).toBeFocused();
});

test("Add currency is one pick row and one pinned button; Choose a currency comes first", async ({
  page,
}) => {
  await open(page, 390);
  await page.locator("#mobile-add-page").click();
  const dialog = page.getByRole("dialog", { name: "Add currency" });
  await settled(sheet(page));
  const pick = dialog.locator(".ui-pick-row");
  await expect(pick).toHaveCount(1);
  await expect(dialog.getByLabel("Currency")).toBeFocused();
  expect((await box(pick)).height).toBeGreaterThanOrEqual(43.9);
  const add = dialog.getByRole("button", { name: "Add currency" });
  expect(await is44(page, add)).toBe(true);
  await add.click();
  await expect(dialog.getByRole("alert")).toHaveText("Choose a currency.");
  const options = await dialog
    .getByLabel("Currency")
    .locator("option")
    .allTextContents();
  expect(options[0]).toBe("Choose…");
  expect(options).toContain("Swiss Franc (CHF)");
  expect(options.some((text) => text.endsWith("(USD)"))).toBe(false);
  expect(options.some((text) => text.endsWith("(EUR)"))).toBe(false);
  await dialog.getByLabel("Currency").selectOption("CHF");
  await expect(pick).toContainText("Swiss Franc (CHF)");
  expect(await noSideways(page)).toBe(true);
});

/** A corner's radius in px. */
const radius = (node: Locator, corner: string) =>
  node.evaluate(
    (n, name) => Number.parseFloat(getComputedStyle(n).getPropertyValue(name)),
    corner,
  );

for (const theme of ["light", "dark"] as const)
  test(`a focused pick row's ring follows the card's corners, not cut square, in ${theme}`, async ({
    page,
  }) => {
    await open(page, 390, theme);
    await page.locator("#mobile-add-page").click();
    const dialog = page.getByRole("dialog", { name: "Add currency" });
    await settled(sheet(page));
    await dialog.getByLabel("Currency").focus();
    for (const card of await dialog.locator(".cu-card").all())
      expect(await card.evaluate((n) => getComputedStyle(n).overflow)).toBe(
        "visible",
      );
    const pick = dialog.locator(".ui-pick-row");
    await expect(pick).toHaveCSS("outline-style", "solid");
    for (const corner of [
      "border-top-left-radius",
      "border-top-right-radius",
      "border-bottom-left-radius",
      "border-bottom-right-radius",
    ])
      expect(await radius(pick, corner)).toBeGreaterThan(12);
    const [ring, body] = await Promise.all([
      box(pick),
      box(dialog.locator(".ui-sheet-body")),
    ]);
    expect(ring.x).toBeGreaterThanOrEqual(body.x);
    expect(ring.x + ring.width).toBeLessThanOrEqual(body.x + body.width + 0.5);
  });

for (const theme of ["light", "dark"] as const)
  test(`passes axe in ${theme}: the list, the rate sheet, the Remove question and the Add currency sheet`, async ({
    page,
  }) => {
    await open(page, 390, theme);
    const scan = async () => {
      const result = await new AxeBuilder({ page }).analyze();
      expect(result.violations).toEqual([]);
    };
    await scan();
    await row(page, "Euro").click();
    await settled(sheet(page));
    await scan();
    await page.getByRole("button", { name: "Remove currency" }).click();
    await settled(page.locator(".ui-question"));
    await scan();
    await page.getByRole("button", { name: "Cancel" }).first().click();
    await page.keyboard.press("Escape");
    await page.locator("#mobile-add-page").click();
    await settled(sheet(page));
    await scan();
  });
