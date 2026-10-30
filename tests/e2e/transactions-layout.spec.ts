import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { newId } from "../../packages/shared/src/index";
import { openFilters } from "./filters";
import {
  connectLocalDatabase,
  createOwnerLedger,
  prepareBrowser,
} from "./ledger-setup";
import { signIn } from "./sign-in";
import { setTheme } from "./theme";

// The Transactions list in a real browser (ADR 0047, PR 5): jsdom cannot run container queries, so the widths,
// the sheet against the drawer and the desktop columns are measured here.
const { env, pool } = connectLocalDatabase("Transactions layout browser tests");
const fixtures: string[] = [];
let checking = "";
let cash = "";
test.beforeEach(async ({ page }, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop",
    "one project is enough: these tests set their own widths",
  );
  const ledgerId = newId();
  fixtures.push(ledgerId);
  checking = newId();
  cash = newId();
  const food = newId();
  const pay = newId();
  await createOwnerLedger(
    pool,
    env,
    ledgerId,
    "E2E transactions layout ledger",
  );
  await pool.query(
    "INSERT INTO accounts (id,ledger_id,name,type,opening_balance) VALUES ($1,$3,'Checking','bank',100000),($2,$3,'Cash','cash',5000)",
    [checking, cash, ledgerId],
  );
  await pool.query(
    "INSERT INTO categories (id,ledger_id,name,kind) VALUES ($1,$3,'Food','expense'),($2,$3,'Pay','income')",
    [food, pay, ledgerId],
  );
  const entry = (
    account: string,
    category: string | null,
    kind: string,
    date: string,
    amount: number,
    payee: string | null,
    status = "cleared",
    transferId: string | null = null,
  ) =>
    pool.query(
      "INSERT INTO transactions (id,ledger_id,account_id,category_id,kind,date,amount,base_amount,payee,status,transfer_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$7,$8,$9,$10)",
      [
        newId(),
        ledgerId,
        account,
        category,
        kind,
        date,
        amount,
        payee,
        status,
        transferId,
      ],
    );
  await entry(checking, food, "expense", "2026-10-06", -2500, "Lunch place");
  await entry(checking, pay, "income", "2026-10-06", 125000, "Acme Studio");
  await entry(
    checking,
    food,
    "expense",
    "2026-10-06",
    -900,
    "Waiting on this",
    "pending",
  );
  // The two legs of a transfer must arrive together, or the database refuses the first.
  const transfer = newId();
  await pool.query(
    "INSERT INTO transactions (id,ledger_id,account_id,category_id,kind,date,amount,base_amount,payee,status,transfer_id) VALUES ($1,$3,$4,NULL,'transfer','2026-10-05',-5000,-5000,NULL,'cleared',$6),($2,$3,$5,NULL,'transfer','2026-10-05',5000,5000,NULL,'cleared',$6)",
    [newId(), newId(), ledgerId, checking, cash, transfer],
  );
  await entry(
    checking,
    food,
    "expense",
    "2026-10-05",
    -4000,
    "A rather long payee name that has to be cut off before it pushes the amount out",
  );
  await prepareBrowser(page, testInfo, {
    ledgerId,
    name: "Synthetic transactions layout ledger",
    forwarded: [62, 62],
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
      "UPDATE ledgers SET deleted_at=now(), updated_at=now() WHERE id=$1 AND name LIKE 'E2E transactions layout ledger%'",
      [id],
    );
  }
  fixtures.length = 0;
});
test.afterAll(async () => {
  await pool.end();
});

async function openList(page: Page, width: number) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width, height: 900 });
  await signIn(page);
  await page.goto("/transactions");
  await page.waitForFunction(
    () => getComputedStyle(document.body).containerType === "inline-size",
  );
  await expect(page.locator(".tx-row").first()).toBeEnabled();
}
/** Axe's findings as short lines (the rule and where), so a failure is readable. */
async function violations(page: Page) {
  const { violations } = await new AxeBuilder({ page }).analyze();
  return (
    violations
      // Known gap (docs/PROGRESS.md, as in a11y.spec): a row's name is a short summary, not all of its text.
      .map((item) =>
        item.id === "label-content-name-mismatch"
          ? {
              ...item,
              nodes: item.nodes.filter(
                (node) => !node.target.join(" ").startsWith("#transaction-"),
              ),
            }
          : item,
      )
      .filter((item) => item.nodes.length > 0)
      .map(
        (item) =>
          `${item.id}: ${item.nodes.map((node) => node.target.join(" ")).join(" | ")}`,
      )
  );
}
const box = (page: Page, selector: string, nth = 0) =>
  page
    .locator(selector)
    .nth(nth)
    .evaluate((node) => {
      const rect = node.getBoundingClientRect();
      return {
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
      };
    });

for (const theme of ["light", "dark"] as const)
  for (const width of [320, 390, 1280]) {
    test(`fits ${width} px in ${theme}: nothing scrolls sideways and rows keep their shape`, async ({
      page,
    }) => {
      await openList(page, width);
      await setTheme(page, theme);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
      // The seeded entries: three on one day, the transfer as one row, and one more.
      await expect(page.locator(".tx-row")).toHaveCount(5);
      for (const row of await page.locator(".tx-row").all()) {
        expect((await row.boundingBox())?.height).toBeGreaterThanOrEqual(44);
        expect(
          await row.evaluate(
            (node) => node.scrollWidth <= node.clientWidth + 1,
          ),
        ).toBe(true);
      }
      // The long payee is cut off inside its row rather than pushing the amount out.
      const long = page.locator(".tx-row", { hasText: "A rather long payee" });
      const rowBox = await long.boundingBox();
      const amount = await long.locator(".ui-row-end").boundingBox();
      expect((amount?.x ?? 0) + (amount?.width ?? 0)).toBeLessThanOrEqual(
        (rowBox?.x ?? 0) + (rowBox?.width ?? 0) + 1,
      );
    });
  }

test("a transfer is one row with an arrow between its accounts and no sign", async ({
  page,
}) => {
  await openList(page, 390);
  const row = page.getByRole("button", {
    name: "Open transaction: Transfer from Checking to Cash",
  });
  await expect(row).toBeVisible();
  await expect(row).toContainText("Checking → Cash");
  await expect(row.locator(".ui-row-end")).toHaveText("$50.00");
});

test("a day shows its net, and a pending entry is marked and left out of it", async ({
  page,
}) => {
  await openList(page, 390);
  const day = page.getByRole("region", { name: "Tue, Oct 6, 2026" });
  // 1250.00 in, 25.00 out; the pending 9.00 is not counted.
  await expect(day.locator(".tx-net")).toHaveText("+$1,225.00");
  await expect(
    day
      .locator(".tx-row", { hasText: "Waiting on this" })
      .locator(".tx-pending"),
  ).toHaveText("Pending");
  await expect(
    day.locator(".tx-row", { hasText: "Acme Studio" }).locator(".ui-row-end"),
  ).toContainText("+$1,250.00");
});

test("the account and the tags are columns from 1100 px and part of the hint below it", async ({
  page,
}) => {
  await openList(page, 1099);
  await expect(page.locator(".tx-account").first()).toBeHidden();
  await expect(page.locator(".tx-inline-account").first()).toBeVisible();
  await page.setViewportSize({ width: 1100, height: 900 });
  await expect(page.locator(".tx-account").first()).toBeVisible();
  await expect(page.locator(".tx-inline-account").first()).toBeHidden();
  // The column starts at the same place in every row that has one.
  const lefts = [];
  for (const cell of await page.locator(".tx-account:visible").all())
    if ((await cell.textContent())?.trim())
      lefts.push(Math.round((await cell.boundingBox())?.x ?? 0));
  expect(lefts.length).toBeGreaterThan(2);
  expect(new Set(lefts).size).toBe(1);
});

test("the note shows from 700 px", async ({ page }) => {
  await pool.query(
    "UPDATE transactions SET note='Remember the receipt' WHERE payee='Lunch place'",
  );
  await openList(page, 699);
  await expect(page.getByText("Remember the receipt")).toBeHidden();
  await page.setViewportSize({ width: 700, height: 900 });
  await expect(page.getByText("Remember the receipt")).toBeVisible();
});

test("Filters is a bottom sheet under 700 px and a 440 px drawer from it", async ({
  page,
}) => {
  await openList(page, 699);
  let dialog = await openFilters(page);
  let sheet = await dialog.boundingBox();
  expect(sheet?.width).toBeCloseTo(699, 0);
  expect((sheet?.y ?? 0) + (sheet?.height ?? 0)).toBeCloseTo(900, 0);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await page.setViewportSize({ width: 700, height: 900 });
  dialog = await openFilters(page);
  sheet = await dialog.boundingBox();
  expect(sheet?.width).toBeCloseTo(440, 0);
  expect((sheet?.x ?? 0) + (sheet?.width ?? 0)).toBeCloseTo(700, 0);
});

test("the search, the Filters button and the chips are 44 px targets and keep one line each at 320 px", async ({
  page,
}) => {
  await openList(page, 320);
  const filters = await box(page, "#open-filters");
  const search = await box(page, "#transaction-search");
  expect(filters.height).toBeGreaterThanOrEqual(44);
  expect(search.height).toBeGreaterThanOrEqual(44);
  expect(Math.abs(filters.top - search.top)).toBeLessThanOrEqual(1);
  for (const chip of await page.locator(".tx-kinds button").all()) {
    const reach = await chip.evaluate((node) => {
      node.scrollIntoView({ block: "center" });
      const rect = node.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      return [-21, 21].map((offset) => {
        const found = document.elementFromPoint(
          x,
          rect.top + rect.height / 2 + offset,
        );
        return found === node || node.contains(found);
      });
    });
    expect(reach).toEqual([true, true]);
  }
});

test("applies a filter from the sheet and shows it on the button", async ({
  page,
}) => {
  await openList(page, 1280);
  const dialog = await openFilters(page);
  await dialog.getByLabel("Account", { exact: true }).selectOption(cash);
  await dialog.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`accountId=${cash}`));
  await expect(page.getByRole("button", { name: /^Filters.*1/ })).toBeVisible();
  // Only the cash leg is loaded now, so the transfer shows as the one leg.
  await expect(page.locator(".tx-row")).toHaveCount(1);
  await expect(
    page.getByRole("button", { name: "Open transaction: Transfer to Cash" }),
  ).toBeVisible();
});

for (const theme of ["light", "dark"] as const)
  test(`has no accessibility violations in ${theme}, with the sheet shut and open`, async ({
    page,
  }) => {
    await openList(page, 1280);
    await setTheme(page, theme);
    expect(await violations(page)).toEqual([]);
    await openFilters(page);
    expect(await violations(page)).toEqual([]);
  });
