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
const { env, pool } = connectLocalDatabase("Loans layout browser tests");
const fixtures: string[] = [];
test.beforeEach(async ({ page }, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop",
    "one project is enough: these tests set their own widths",
  );
  const ledgerId = newId();
  fixtures.push(ledgerId);
  await createOwnerLedger(pool, env, ledgerId, "E2E loans layout ledger");
  await prepareBrowser(page, testInfo, {
    ledgerId,
    name: "Synthetic loans layout ledger",
    forwarded: [227, 23],
  });
});
test.afterEach(async () => {
  for (const id of fixtures) {
    await pool.query(
      "UPDATE ledger_members SET deleted_at=now(), updated_at=now() WHERE ledger_id=$1",
      [id],
    );
    await pool.query(
      "UPDATE ledgers SET deleted_at=now(), updated_at=now() WHERE id=$1 AND name LIKE 'E2E loans layout ledger%'",
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
const loan = (n: number, amount: number, currency = "USD", opening = 0) => ({
  accountId: uuid(500 + n),
  currency,
  openingBalance: { amount: opening, currency },
  balance: { amount, currency },
  version: 2,
});
const person = (
  n: number,
  name: string,
  balances: ReturnType<typeof loan>[],
  archived = false,
) => ({
  id: uuid(n),
  name,
  origin: "loan",
  archivedAt: archived ? stamp : null,
  version: 1,
  balances,
});
const SAM = uuid(10);
const AMY = uuid(11);
const OLD = uuid(13);
const LONG_NAME = `Neighbour ${"with a very long name ".repeat(4)}`.trim();
const people = [
  person(10, "Sam", [loan(1, 5000, "USD", 3000), loan(2, -1200, "EUR")]),
  person(11, "Amy", [loan(3, 0)]),
  person(12, LONG_NAME, [loan(4, 64000)]),
  person(13, "Old Friend", [loan(5, 900)], true),
];
const contactOf = (p: (typeof people)[number]) => ({
  id: p.id,
  ledgerId: uuid(1),
  name: p.name,
  phone: null,
  email: null,
  note: null,
  origin: "loan",
  archivedAt: p.archivedAt,
  version: 1,
  createdAt: stamp,
  updatedAt: stamp,
  openBalance: usd(0),
  openBalances: [],
  unconvertedCurrencies: [],
  oldestOpenServiceDate: null,
  paidThisMonth: { base: usd(0), amounts: [] },
});
const entry = (n: number, kind: string, amount: number, date: string) => ({
  id: uuid(600 + n),
  ledgerId: uuid(1),
  accountId: uuid(501),
  categoryId: null,
  kind,
  status: "cleared",
  amount: usd(amount),
  baseAmount: usd(amount),
  fxRate: "1.0000000000",
  date,
  time: null,
  payee: null,
  note: null,
  transferId: null,
  relatedTransferId: null,
  feeTransferId: null,
  tipPaymentId: null,
  splits: [],
  version: 1,
  createdAt: stamp,
  updatedAt: stamp,
});

/** People answered from memory; Home's own answer is kept and only its loans changed. */
async function withPeople(page: Page, list = people) {
  await page.route(/\/loans\?/, (route) =>
    route.fulfill({ json: { items: list, nextCursor: null } }),
  );
  await page.route(/\/contacts\/[^/?]+$/, (route) => {
    const id = route.request().url().split("/").pop();
    const found = list.find((p) => p.id === id);
    return route.fulfill(
      found ? { json: contactOf(found) } : { status: 404, json: {} },
    );
  });
  await page.route(/\/contacts\/[^/]+\/loans$/, (route) => {
    const id = route.request().url().split("/").slice(-2)[0];
    return route.fulfill({
      json: { items: list.find((p) => p.id === id)?.balances ?? [] },
    });
  });
  // Only Sam's dollar loan has entries, so only it cannot be removed.
  await page.route(/\/transactions\?/, (route) =>
    route.fulfill({
      json: {
        items: route.request().url().includes(uuid(501))
          ? [
              entry(1, "transfer", 3000, "2026-10-03"),
              entry(2, "transfer", -1000, "2026-10-09"),
            ]
          : [],
        nextCursor: null,
      },
    }),
  );
  await page.route(/\/home\?/, async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    body.loans = { lent: usd(5000), borrowed: usd(1300) };
    return route.fulfill({ response, json: body });
  });
}

async function open(
  page: Page,
  width: number,
  path = "/loans",
  theme?: "light" | "dark",
  reduce = true,
) {
  if (reduce) await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width, height: 900 });
  await signIn(page);
  await withPeople(page);
  await page.goto(path);
  await page.waitForFunction(
    () => getComputedStyle(document.body).containerType === "inline-size",
  );
  if (theme) await setTheme(page, theme);
  await expect(page.locator("#loans-title")).toBeAttached();
  // The list is hidden on a phone that opens a person, so wait for whichever pane the address shows.
  await expect(
    page
      .getByRole("region", { name: "Loan totals" })
      .or(page.locator(".ln-card"))
      .first(),
  ).toBeVisible();
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
const cut = (node: Locator) =>
  node.evaluate((n) => n.scrollWidth <= n.clientWidth + 1);
const links = (page: Page) => page.locator('a[id^="loan-person-"]');
/** The height of the folding part a field is in: clipped, a part still has a box, so "hidden" cannot be asked. */
const foldHeight = (field: Locator) =>
  field.evaluate(
    (node) => node.closest(".ln-fold")?.getBoundingClientRect().height ?? -1,
  );
const sheet = (page: Page) => page.locator(".ui-sheet");

for (const theme of ["light", "dark"] as const)
  for (const width of [320, 390, 1280])
    test(`fits ${width} px in ${theme}: the list and a person, nothing cut, each a real target`, async ({
      page,
    }) => {
      await open(page, width, "/loans", theme);
      expect(await noSideways(page)).toBe(true);
      // Active is the chip in use, so the three not archived are the rows; the long name wraps and is never cut.
      await expect(links(page)).toHaveCount(3);
      for (const row of await links(page).all()) {
        expect((await box(row)).height).toBeGreaterThanOrEqual(56);
        for (const part of [".ui-row-title", ".ui-row-hint"])
          expect(await cut(row.locator(part))).toBe(true);
        expect(await is44(page, row)).toBe(true);
      }
      for (const chip of await page.locator(".ln-chips button").all())
        expect(await is44(page, chip)).toBe(true);
      expect(
        await page
          .locator(".ln-total")
          .evaluate((node) => node.scrollWidth <= node.clientWidth),
      ).toBe(true);
      await page.goto(`/loans/${SAM}`);
      const card = page.getByRole("region", { name: "Sam", exact: true });
      await expect(card).toBeVisible();
      await expect(
        page.getByRole("region", { name: "Balance and activity" }),
      ).toContainText("Sam owes you");
      expect(await noSideways(page)).toBe(true);
      expect(
        await card.evaluate((node) => node.scrollWidth <= node.clientWidth),
      ).toBe(true);
      for (const name of ["Record repayment", /^More actions for/])
        expect(await is44(page, card.getByRole("button", { name }))).toBe(true);
      const region = page.getByRole("region", { name: "Balance and activity" });
      for (const button of await region
        .getByRole("button", { name: /^(Remove|Change)/ })
        .all())
        expect(await is44(page, button)).toBe(true);
      for (const part of await region
        .locator(".ui-row-title, .ui-row-hint")
        .all())
        expect(await cut(part)).toBe(true);
    });

test("one pane under 1100 px, two from it; the address, the back link and the Add buttons follow", async ({
  page,
}) => {
  // A phone: the list, then a person alone with the back arrow's page and "Lend money" as the one Add button.
  await open(page, 390);
  await expect(links(page).first()).toBeVisible();
  await expect(page.locator(".ln-card")).toHaveCount(0);
  await expect(page.locator("#add-loan")).toBeHidden();
  await expect(page.locator("#mobile-add-page")).toHaveAccessibleName(
    "Add loan",
  );
  await links(page).filter({ hasText: "Sam" }).click();
  await expect(page).toHaveURL(new RegExp(`/loans/${SAM}$`));
  await expect(page.locator(".ln-card")).toBeVisible();
  await expect(links(page).first()).toBeHidden();
  await expect(page.locator("#mobile-add-page")).toHaveAccessibleName(
    "Lend money",
  );
  await page.reload();
  await expect(page.locator(".ln-card")).toBeVisible();
  // A tablet: one pane, with its own Add loan button and an "All people" link beside a person.
  await page.setViewportSize({ width: 800, height: 900 });
  await expect(page.locator("#add-loan")).toBeVisible();
  await expect(page.getByRole("link", { name: "All people" })).toBeVisible();
  await expect(links(page).first()).toBeHidden();
  await page.getByRole("link", { name: "All people" }).click();
  await expect(page).toHaveURL(/\/loans$/);
  await expect(links(page).first()).toBeVisible();
  await expect(page.getByRole("link", { name: "All people" })).toBeHidden();
  // A desktop: the list beside the first person, and the address changes with the row chosen.
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(links(page).first()).toBeVisible();
  // People with something open come first, by name, so the long-named neighbour is the first.
  await expect(
    page.getByRole("region", { name: LONG_NAME, exact: true }),
  ).toBeVisible();
  const list = await box(page.locator(".ln-list"));
  const detail = await box(page.locator(".ln-detail"));
  expect(detail.x).toBeGreaterThan(list.x + list.width - 1);
  expect(Math.abs(detail.y - list.y)).toBeLessThan(2);
  await expect(page.getByRole("link", { name: "All people" })).toBeHidden();
  await links(page).filter({ hasText: "Amy" }).click();
  await expect(page).toHaveURL(new RegExp(`/loans/${AMY}$`));
  await expect(
    page.getByRole("region", { name: "Amy", exact: true }),
  ).toBeVisible();
  await expect(links(page).filter({ hasText: "Amy" })).toHaveAttribute(
    "data-selected",
    "true",
  );
  await expect(links(page).filter({ hasText: "Sam" })).not.toHaveAttribute(
    "data-selected",
    "true",
  );
});

test("the list: totals, search from eight people, chips while someone is archived, one hint per row", async ({
  page,
}) => {
  await open(page, 390);
  const totals = page.getByRole("region", { name: "Loan totals" });
  await expect(totals).toContainText("People owe");
  await expect(totals).toContainText("$50.00");
  await expect(totals).toContainText("You owe");
  await expect(totals).toContainText("$13.00");
  await expect(page.getByRole("searchbox")).toHaveCount(0);
  const sam = links(page).filter({ hasText: "Sam" });
  await expect(sam).toContainText("Owes you · +1 more");
  await expect(sam).toContainText("$50.00");
  await expect(links(page).filter({ hasText: "Amy" })).toContainText("Settled");
  await page.getByRole("button", { name: "Archived", exact: true }).click();
  await expect(links(page)).toHaveCount(1);
  await expect(links(page)).toContainText("Archived");
  await page.getByRole("button", { name: "All", exact: true }).click();
  await expect(links(page)).toHaveCount(4);
});

test("a long list has a search box that keeps its place while the list narrows", async ({
  page,
}) => {
  const many = Array.from({ length: 10 }, (_, i) =>
    person(20 + i, `Friend ${i}`, [loan(20 + i, 100 * (i + 1))]),
  );
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 390, height: 900 });
  await signIn(page);
  await withPeople(page, many);
  await page.goto("/loans");
  const search = page.getByRole("searchbox", { name: "Search people" });
  await expect(search).toBeVisible();
  const before = await box(search);
  await search.fill("Friend 3");
  await expect(links(page)).toHaveCount(1);
  expect(await box(search)).toEqual(before);
  await search.fill("nobody");
  await expect(page.getByText("No one here.")).toBeVisible();
  expect(await box(search)).toEqual(before);
});

test("the sheets: a bottom sheet on a phone, a drawer from 700 px, the foot pinned", async ({
  page,
}) => {
  await open(page, 390, `/loans/${SAM}`);
  await page.locator("#mobile-add-page").click();
  const phone = await settled(sheet(page));
  expect(Math.abs(phone.x)).toBeLessThan(1);
  expect(Math.abs(phone.width - 390)).toBeLessThan(1);
  expect(Math.abs(phone.y + phone.height - 900)).toBeLessThan(1);
  await expect(
    page.getByRole("dialog", { name: "Lend money to Sam" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(sheet(page)).toHaveCount(0);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByRole("button", { name: "Record repayment" }).click();
  const drawer = await settled(sheet(page));
  expect(drawer.width).toBeLessThanOrEqual(560);
  expect(drawer.x + drawer.width).toBeGreaterThan(1279);
  expect(drawer.height).toBeGreaterThan(890);
  // The foot belongs to the sheet and never scrolls away with the body.
  const foot = await box(sheet(page).locator(".ui-sheet-foot"));
  expect(foot.y + foot.height).toBeLessThanOrEqual(900.5);
  expect(foot.y).toBeGreaterThan(drawer.y + 100);
  await expect(
    sheet(page).getByRole("button", { name: "Record repayment" }),
  ).toBeVisible();
});

for (const width of [320, 390])
  test(`Add loan fits ${width} px in every choice: nothing runs past the sheet's edge`, async ({
    page,
  }) => {
    await open(page, width, "/loans");
    await page.locator("#mobile-add-page").click();
    const dialog = page.getByRole("dialog", { name: "Add loan" });
    await settled(sheet(page));
    for (const choice of [
      "I lent money",
      "I borrowed money",
      "A loan I already had",
    ]) {
      await dialog.getByRole("radio", { name: choice }).click();
      await settled(sheet(page));
      const edge = (await box(sheet(page))).x + (await box(sheet(page))).width;
      expect(
        await dialog
          .locator(".ui-sheet-body")
          .evaluate((node) => node.scrollWidth <= node.clientWidth),
        choice,
      ).toBe(true);
      for (const part of await dialog
        .locator(".ln-fields > *:visible, .ln-fold-in > *")
        .all()) {
        const found = await part.boundingBox();
        if (found && found.height > 0)
          expect(found.x + found.width, choice).toBeLessThanOrEqual(edge + 0.5);
      }
      // The three choices keep a real target even when their words wrap.
      for (const radio of await dialog.getByRole("radio").all())
        if (await radio.evaluate((node) => !node.closest("[inert]")))
          expect(await is44(page, radio), choice).toBe(true);
    }
  });

test("Add loan keeps its height when the choice changes, and eases it down and up when the choice needs fewer or more rows", async ({
  page,
}) => {
  // The motion is under test, so this one does not ask for reduced motion.
  await open(page, 390, "/loans", undefined, false);
  await page.locator("#mobile-add-page").click();
  const dialog = page.getByRole("dialog", { name: "Add loan" });
  await expect(dialog).toBeVisible();
  const start = (await settled(sheet(page))).height;
  /** The sheet's height on every frame for a while after a click. */
  const clickAndWatch = (name: string) =>
    page.evaluate(async (label) => {
      const node = document.querySelector(".ui-sheet") as HTMLElement;
      const radio = Array.from(
        document.querySelectorAll<HTMLElement>('[role="radio"]'),
      ).find((r) => r.textContent === label) as HTMLElement;
      const heights: number[] = [];
      const t0 = performance.now();
      radio.click();
      await new Promise<void>((done) => {
        const tick = () => {
          heights.push(node.getBoundingClientRect().height);
          if (performance.now() - t0 < 700) requestAnimationFrame(tick);
          else done();
        };
        tick();
      });
      return heights;
    }, name);
  // Lending and borrowing show the same rows: the sheet does not move at all.
  const same = await clickAndWatch("I borrowed money");
  expect(Math.max(...same) - Math.min(...same)).toBeLessThan(1);
  expect(Math.abs((same.at(-1) ?? 0) - start)).toBeLessThan(1);
  // A loan already had needs no account, date or note: the sheet gets shorter, by easing, never in one frame.
  const down = await clickAndWatch("A loan I already had");
  const total = start - (down.at(-1) ?? 0);
  expect(total).toBeGreaterThan(40);
  expect(Math.abs((down[0] ?? 0) - start)).toBeLessThan(total * 0.35);
  expect(new Set(down.map((h) => Math.round(h))).size).toBeGreaterThan(4);
  for (let i = 1; i < down.length; i++) {
    // Two parts move at once (rows fold away while a choice folds in), so a frame may wobble by a pixel or two.
    expect(down[i] ?? 0).toBeLessThanOrEqual((down[i - 1] ?? 0) + 3);
    expect((down[i - 1] ?? 0) - (down[i] ?? 0)).toBeLessThan(total * 0.35);
  }
  // And back to lending: it eases up to the first height.
  const up = await clickAndWatch("I lent money");
  expect(Math.abs((up.at(-1) ?? 0) - start)).toBeLessThan(1);
  expect(Math.abs((up[0] ?? 0) - (down.at(-1) ?? 0))).toBeLessThan(
    total * 0.35,
  );
  expect(new Set(up.map((h) => Math.round(h))).size).toBeGreaterThan(4);
  // Folded away, the rows cannot be reached by keyboard or screen reader.
  await dialog.getByRole("radio", { name: "A loan I already had" }).click();
  await page.waitForTimeout(400);
  expect(await foldHeight(dialog.locator("#loan-date"))).toBeLessThan(1);
  await dialog.getByRole("radio", { name: "A loan I already had" }).focus();
  await page.keyboard.press("Tab");
  await expect(dialog.locator("#loan-date")).not.toBeFocused();
});

test("Add loan with a choice of currencies slides the currency row in with the existing loan", async ({
  page,
}) => {
  await open(page, 390, "/loans", undefined, false);
  await page.route(/\/currencies$/, (route) =>
    route.fulfill({
      json: {
        baseCurrency: "USD",
        items: [
          {
            id: uuid(700),
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
  await page.locator("#mobile-add-page").click();
  const dialog = page.getByRole("dialog", { name: "Add loan" });
  await expect(dialog).toBeVisible();
  expect(await foldHeight(dialog.getByLabel("Currency"))).toBeLessThan(1);
  await dialog.getByRole("radio", { name: "A loan I already had" }).click();
  await expect
    .poll(() => foldHeight(dialog.getByLabel("Currency")))
    .toBeGreaterThan(40);
});

test("the person's menu, Rename, the Archive question and the Remove question", async ({
  page,
}) => {
  await open(page, 390, `/loans/${SAM}`);
  await page.getByRole("button", { name: "More actions for Sam" }).click();
  const menu = page.getByRole("dialog", { name: "Sam", exact: true });
  await settled(sheet(page));
  await expect(menu.getByRole("button")).toHaveText([
    "Cancel",
    "Lend money",
    "Borrow money",
    "Waive what is left",
    "Rename",
    "Archive",
  ]);
  for (const button of await menu.locator(".ui-row").all())
    expect((await box(button)).height).toBeGreaterThanOrEqual(56);
  await menu.getByRole("button", { name: "Rename" }).click();
  const rename = page.getByRole("dialog", { name: "Rename" });
  await expect(rename.getByLabel("Name")).toHaveValue("Sam");
  await expect(rename.getByLabel("Name")).toBeFocused();
  await expect(
    rename.getByText("The name also changes on their balance account."),
  ).toBeVisible();
  await expect(rename.getByRole("button", { name: "Save name" })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "More actions for Sam" }).click();
  await page
    .getByRole("dialog", { name: "Sam", exact: true })
    .getByRole("button", { name: "Archive" })
    .click();
  const ask = page.getByRole("dialog", { name: "Archive Sam?" });
  await expect(ask).toContainText(
    "Balances and history are kept. No new loans until you unarchive.",
  );
  const q = await settled(page.locator(".ui-question"));
  expect(Math.abs(q.x + q.width / 2 - 195)).toBeLessThan(2);
  expect(Math.abs(q.y + q.height / 2 - 450)).toBeLessThan(2);
  await expect(ask.getByRole("button", { name: "Archive" })).toBeVisible();
  await ask.getByRole("button", { name: "Cancel" }).click();
  await page
    .getByRole("region", { name: "Balance and activity" })
    .getByRole("button", { name: "Remove the EUR loan" })
    .click();
  const remove = page.getByRole("dialog", { name: "Remove the EUR loan?" });
  await expect(remove).toBeVisible();
  await expect(
    remove.getByRole("button", { name: "Remove loan" }),
  ).toBeVisible();
  await expect(remove.getByRole("button", { name: "Keep loan" })).toBeVisible();
  await remove.getByRole("button", { name: "Keep loan" }).click();
  await page
    .getByRole("region", { name: "Balance and activity" })
    .getByRole("button", { name: "Remove the USD loan" })
    .click();
  const blocked = page.getByRole("dialog", {
    name: "The USD loan cannot be removed yet",
  });
  await expect(blocked.getByRole("list")).toContainText("2026-10-03");
  await expect(
    blocked.getByRole("button", { name: "Remove loan" }),
  ).toHaveCount(0);
});

test("an archived person has only Rename and Unarchive, and no primary button", async ({
  page,
}) => {
  await open(page, 390, `/loans/${OLD}`);
  const card = page.getByRole("region", { name: "Old Friend" });
  await expect(card.getByRole("heading")).toHaveText("Old Friend (archived)");
  await expect(card.getByRole("button", { name: /^Record|^Lend/ })).toHaveCount(
    0,
  );
  await card.getByRole("button", { name: /^More actions/ }).click();
  await expect(page.getByRole("dialog").getByRole("button")).toHaveText([
    "Cancel",
    "Rename",
    "Unarchive",
  ]);
  await expect(page.locator("#mobile-add-page")).toBeDisabled();
});

for (const theme of ["light", "dark"] as const)
  test(`passes axe in ${theme}, the list, a person, and each sheet open`, async ({
    page,
  }) => {
    await open(page, 390, "/loans", theme);
    const scan = async () => {
      const result = await new AxeBuilder({ page }).analyze();
      expect(result.violations).toEqual([]);
    };
    await scan();
    await page.goto(`/loans/${SAM}`);
    await expect(page.locator(".ln-card")).toBeVisible();
    await scan();
    await page.locator("#mobile-add-page").click();
    await settled(sheet(page));
    await scan();
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "More actions for Sam" }).click();
    await settled(sheet(page));
    await scan();
  });
