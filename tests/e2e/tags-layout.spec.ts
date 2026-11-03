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

// Tags in a real browser (ADR 0047, PR 13c), against the approved prototype: jsdom cannot run container queries,
// so the page's width, the Add button of each width, the rows, the fold, the sheet against the drawer and the
// questions are measured here. The tags are mocked, so the owner's ledger is never changed.
const { env, pool } = connectLocalDatabase("Tags layout browser tests");
const fixtures: string[] = [];
test.beforeEach(async ({ page }, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop",
    "one project is enough: these tests set their own widths",
  );
  const ledgerId = newId();
  fixtures.push(ledgerId);
  await createOwnerLedger(pool, env, ledgerId, "E2E tags layout ledger");
  await prepareBrowser(page, testInfo, {
    ledgerId,
    name: "Synthetic tags layout ledger",
    forwarded: [232, 40],
  });
});
test.afterEach(async () => {
  for (const id of fixtures) {
    await pool.query(
      "UPDATE ledger_members SET deleted_at=now(), updated_at=now() WHERE ledger_id=$1",
      [id],
    );
    await pool.query(
      "UPDATE ledgers SET deleted_at=now(), updated_at=now() WHERE id=$1 AND name LIKE 'E2E tags layout ledger%'",
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
const tag = (
  n: number,
  name: string,
  usageCount: number,
  over: Record<string, unknown> = {},
) => ({
  id: uuid(n),
  ledgerId: uuid(1),
  name,
  archivedAt: null,
  usageCount,
  version: 1,
  createdAt: stamp,
  updatedAt: stamp,
  ...over,
});
const LONG_TAG = "Reimbursable work trip to main office";
const tags = [
  tag(10, "Holiday trip", 3),
  tag(11, "Gift", 1),
  tag(12, "Spare", 0),
  tag(13, LONG_TAG, 12),
  tag(20, "Old trip", 2, { archivedAt: stamp }),
];

async function open(page: Page, width: number, theme?: "light" | "dark") {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width, height: 900 });
  await signIn(page);
  await page.route(/\/tags\?/, (route) =>
    route.fulfill({ json: { items: tags, nextCursor: null } }),
  );
  await page.goto("/tags");
  await page.waitForFunction(
    () => getComputedStyle(document.body).containerType === "inline-size",
  );
  if (theme) await setTheme(page, theme);
  await expect(page.locator("#tags-title")).toBeAttached();
  await expect(page.locator(".tg-row").first()).toBeVisible();
}
const row = (page: Page, name: string) =>
  page.getByRole("button", { name: new RegExp(`^${name} \\d+ entr`) });

for (const theme of ["light", "dark"] as const)
  for (const width of [320, 390, 1280])
    test(`fits ${width} px in ${theme}: one card, rows are real targets, nothing cut, capped near 760 px`, async ({
      page,
    }) => {
      await open(page, width, theme);
      expect(await noSideways(page)).toBe(true);
      const search = page.getByRole("searchbox", { name: "Search tags" });
      expect((await box(search)).height).toBeGreaterThanOrEqual(43.9);
      const items = page.locator(".ui-list > .tg-row");
      await expect(items).toHaveCount(4);
      for (const item of await items.all()) {
        expect((await box(item)).height).toBeGreaterThanOrEqual(56);
        expect(await is44(page, item)).toBe(true);
      }
      // A long name wraps in its row; it is never cut or pushed past the edge.
      for (const title of await page.locator(".tg-row .ui-row-title").all())
        expect(await cut(title)).toBe(true);
      const card = await box(page.locator(".ui-list"));
      expect(card.width).toBeLessThanOrEqual(760.5);
      if (width < 700) expect(card.width).toBeGreaterThanOrEqual(width - 41);
      // The rows are in name order.
      const names = await page
        .locator(".ui-list > .tg-row .ui-row-title")
        .allTextContents();
      expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
      expect(await noSideways(page)).toBe(true);
    });

test("a phone has the shell's one Add; from 700 px the page's own button leads", async ({
  page,
}) => {
  await open(page, 390);
  await expect(page.locator("#add-tag")).toBeHidden();
  await expect(page.locator("#mobile-add-page")).toHaveAccessibleName(
    "Add tag",
  );
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(page.locator("#add-tag")).toBeVisible();
  await expect(page.locator("#mobile-add-page")).toBeHidden();
});

test("the rows say how many entries use a tag, with no page subtitle", async ({
  page,
}) => {
  await open(page, 390);
  await expect(row(page, "Holiday trip")).toContainText("3 entries");
  await expect(row(page, "Gift")).toContainText("1 entry");
  await expect(row(page, "Spare")).toContainText("0 entries");
  await expect(page.getByText("Free-form labels")).toHaveCount(0);
  await expect(page.getByText("YOUR LEDGER")).toHaveCount(0);
});

test("the search narrows the card and stays where it is while typing", async ({
  page,
}) => {
  await open(page, 390);
  const search = page.getByRole("searchbox", { name: "Search tags" });
  const before = await box(search);
  await search.pressSequentially("gif");
  await expect(page.locator(".ui-list > .tg-row")).toHaveCount(1);
  await expect(row(page, "Gift")).toBeVisible();
  const after = await box(search);
  expect(Math.abs(after.y - before.y)).toBeLessThan(0.5);
  expect(Math.abs(after.height - before.height)).toBeLessThan(0.5);
  await search.fill("zzz");
  await expect(page.getByText("No tag matches.")).toBeVisible();
  expect(Math.abs((await box(search)).y - before.y)).toBeLessThan(0.5);
});

test("the archived tags are one fold under the card, shut until opened", async ({
  page,
}) => {
  await open(page, 390);
  const fold = page.locator(".tg-fold");
  await expect(fold.locator("summary")).toHaveText("1 archived");
  await expect(row(page, "Old trip")).toBeHidden();
  await expectShutFoldIsItsRow(fold);
  await fold.locator("summary").click();
  await expect(row(page, "Old trip")).toBeVisible();
  expect(await is44(page, row(page, "Old trip"))).toBe(true);
  const [card, shut] = await Promise.all([
    box(page.locator(".ui-list")),
    box(fold),
  ]);
  expect(shut.y).toBeGreaterThan(card.y + card.height - 1);
  expect(Math.abs(shut.width - card.width)).toBeLessThan(2);
  expect(await noSideways(page)).toBe(true);
});

/** A shut fold is its one row and its border, nothing more: the card adds no padding of its own (owner's report). */
async function expectShutFoldIsItsRow(fold: Locator) {
  const [card, summary] = await Promise.all([
    box(fold),
    box(fold.locator("summary")),
  ]);
  expect(card.height - summary.height).toBeLessThanOrEqual(2.5);
  expect(summary.height).toBeGreaterThanOrEqual(56);
  const text = await box(fold.locator("summary > span"));
  const above = text.y - card.y;
  const below = card.y + card.height - (text.y + text.height);
  expect(Math.abs(above - below)).toBeLessThan(2);
}

test("a tag's sheet is a bottom sheet on a phone and a drawer from 700 px", async ({
  page,
}) => {
  await open(page, 390);
  await row(page, "Holiday trip").click();
  const phone = await settled(sheet(page));
  expect(Math.abs(phone.x)).toBeLessThan(1);
  expect(Math.abs(phone.width - 390)).toBeLessThan(1);
  expect(Math.abs(phone.y + phone.height - 900)).toBeLessThan(1);
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 1280, height: 900 });
  await row(page, "Holiday trip").click();
  const drawer = await settled(sheet(page));
  expect(drawer.width).toBeLessThanOrEqual(560);
  expect(drawer.x + drawer.width).toBeGreaterThan(1279);
});

test("the actions sheet lists View entries, Rename, Archive and Delete in red, each a real target", async ({
  page,
}) => {
  await open(page, 390);
  await row(page, "Gift").click();
  const dialog = page.getByRole("dialog", { name: "Gift" });
  await settled(sheet(page));
  const view = dialog.getByRole("link", { name: "View entries" });
  const rename = dialog.getByRole("button", { name: "Rename", exact: true });
  const archive = dialog.getByRole("button", { name: "Archive", exact: true });
  const remove = dialog.getByRole("button", { name: "Delete", exact: true });
  const items = [view, rename, archive, remove];
  for (const item of items) {
    expect((await box(item)).height).toBeGreaterThanOrEqual(56);
    expect(await is44(page, item)).toBe(true);
  }
  // In that order, one under the other.
  const tops = await Promise.all(
    items.map(async (item) => (await box(item)).y),
  );
  expect(tops).toEqual([...tops].sort((a, b) => a - b));
  const colour = (node: Locator) =>
    node.locator(".ui-row-title").evaluate((n) => getComputedStyle(n).color);
  expect(await colour(remove)).not.toBe(await colour(archive));
  // The actions sheet has no primary button to pin.
  await expect(dialog.locator(".ui-sheet-foot")).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "Save" })).toHaveCount(0);
  await expect(view).toHaveAttribute("href", /tagId=/);
});

test("Rename swaps inside the open sheet, which does not slide in again, and Save is pinned", async ({
  page,
}) => {
  await open(page, 390);
  await row(page, "Gift").click();
  const dialog = page.getByRole("dialog", { name: "Gift" });
  const before = await settled(sheet(page));
  await dialog.getByRole("button", { name: "Rename", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Rename tag" })).toBeVisible();
  // At once, not after a slide: the sheet is where it was and as wide.
  const after = await box(sheet(page));
  expect(Math.abs(after.x - before.x)).toBeLessThan(1);
  expect(Math.abs(after.width - before.width)).toBeLessThan(1);
  expect(
    Math.abs(after.y + after.height - (before.y + before.height)),
  ).toBeLessThan(1);
  const name = page.getByLabel("Name", { exact: true });
  await expect(name).toBeFocused();
  await expect(name).toHaveValue("Gift");
  expect((await box(name)).height).toBeGreaterThanOrEqual(43.9);
  const save = page.getByRole("button", { name: "Save", exact: true });
  const foot = await box(page.locator(".ui-sheet-foot"));
  expect(foot.y + foot.height).toBeLessThanOrEqual(900.5);
  expect(await is44(page, save)).toBe(true);
  // The rule's words show for a name that breaks it, and the sheet stays.
  await name.fill("a,b");
  await save.click();
  await expect(page.getByRole("alert")).toContainText(
    "Use 1 to 40 characters, without commas or semicolons, for a tag name.",
  );
});

test("Add tag opens on an empty Name with Save pinned, on a phone and on a desktop", async ({
  page,
}) => {
  await open(page, 390);
  await page.locator("#mobile-add-page").click();
  const dialog = page.getByRole("dialog", { name: "Add tag" });
  await settled(sheet(page));
  await expect(dialog.getByLabel("Name")).toBeFocused();
  await expect(dialog.getByLabel("Name")).toHaveValue("");
  await expect(
    dialog.getByRole("button", { name: "Save", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.locator("#add-tag").click();
  await expect(page.getByRole("dialog", { name: "Add tag" })).toBeVisible();
});

test("Delete asks in a centred question over the sheet; a tag in use cannot be deleted; Cancel returns to the sheet", async ({
  page,
}) => {
  await open(page, 390);
  await row(page, "Gift").click();
  await settled(sheet(page));
  await page
    .getByRole("dialog", { name: "Gift" })
    .getByRole("button", { name: "Delete", exact: true })
    .click();
  const ask = page.getByRole("dialog", { name: "Delete Gift?" });
  const q = await settled(page.locator(".ui-question"));
  expect(Math.abs(q.x + q.width / 2 - 195)).toBeLessThan(2);
  expect(Math.abs(q.y + q.height / 2 - 450)).toBeLessThan(2);
  await expect(ask).toContainText(
    "1 entry has this tag, so it can't be deleted.",
  );
  await expect(ask.getByRole("button", { name: "Delete tag" })).toBeDisabled();
  await ask.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("dialog", { name: "Delete Gift?" })).toHaveCount(
    0,
  );
  await expect(page.getByRole("dialog", { name: "Gift" })).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  // Focus comes back to the row that opened it.
  await expect(row(page, "Gift")).toBeFocused();
  // An unused tag can be deleted: the button is on.
  await row(page, "Spare").click();
  await page
    .getByRole("dialog", { name: "Spare" })
    .getByRole("button", { name: "Delete", exact: true })
    .click();
  await expect(page.getByRole("button", { name: "Delete tag" })).toBeEnabled();
});

test("an archived tag's sheet says Unarchive, not Archive", async ({
  page,
}) => {
  await open(page, 390);
  await page.locator(".tg-fold summary").click();
  await row(page, "Old trip").click();
  const dialog = page.getByRole("dialog", { name: "Old trip" });
  await expect(
    dialog.getByRole("button", { name: "Unarchive", exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Archive", exact: true }),
  ).toHaveCount(0);
});

test("an archive notice is a toast that does not cover the rows' targets or push the page", async ({
  page,
}) => {
  await open(page, 390);
  await page.route(/\/tags\/[^/]+\/archive$/, (route) =>
    route.fulfill({
      json: tag(11, "Gift", 1, { archivedAt: stamp, version: 2 }),
    }),
  );
  await row(page, "Gift").click();
  await page
    .getByRole("dialog", { name: "Gift" })
    .getByRole("button", { name: "Archive", exact: true })
    .click();
  await expect(
    page.getByText("Archived Gift. It stays on its entries."),
  ).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(await noSideways(page)).toBe(true);
});

for (const theme of ["light", "dark"] as const)
  test(`passes axe in ${theme}: the list, the actions sheet, the name sheet and the Delete question`, async ({
    page,
  }) => {
    await open(page, 390, theme);
    const scan = async () => {
      const result = await new AxeBuilder({ page }).analyze();
      expect(result.violations).toEqual([]);
    };
    await scan();
    await row(page, "Spare").click();
    await settled(sheet(page));
    await scan();
    await page.getByRole("button", { name: "Rename", exact: true }).click();
    await settled(sheet(page));
    await scan();
    await page.keyboard.press("Escape");
    await row(page, "Spare").click();
    await settled(sheet(page));
    await page.getByRole("button", { name: "Delete", exact: true }).click();
    await settled(page.locator(".ui-question"));
    await scan();
  });
