import { expect, type Page, test } from "@playwright/test";
import { newId } from "../../packages/shared/src/index";
import { chooseCategory } from "./category-picker";
import {
  connectLocalDatabase,
  createOwnerLedger,
  prepareBrowser,
} from "./ledger-setup";
import { signIn } from "./sign-in";
import { setTheme } from "./theme";

const { env, pool } = connectLocalDatabase("Home browser tests");
let ledgerId = "";
let bankId = "";
let cashId = "";
let expenseId = "";
const fixtures: string[] = [];
test.beforeEach(async ({ page }, testInfo) => {
  ledgerId = newId();
  bankId = newId();
  cashId = newId();
  expenseId = newId();
  fixtures.push(ledgerId);
  await createOwnerLedger(
    pool,
    env,
    ledgerId,
    `E2E home ledger ${testInfo.project.name}`,
  );
  for (const [id, name, type, amount, archived] of [
    [bankId, "Checking", "bank", 100000, false],
    [cashId, "Cash", "cash", 20000, false],
    [newId(), "Visa", "card", -30000, false],
    [newId(), "Old savings", "savings", 50000, true],
  ] as const)
    await pool.query(
      "INSERT INTO accounts (id,ledger_id,name,type,opening_balance,archived_at) VALUES ($1,$2,$3,$4,$5,$6)",
      [id, ledgerId, name, type, amount, archived ? new Date() : null],
    );
  await pool.query(
    "INSERT INTO categories (id,ledger_id,name,kind) VALUES ($1,$2,'Food','expense')",
    [expenseId, ledgerId],
  );
  await prepareBrowser(page, testInfo, {
    ledgerId,
    name: "Synthetic home ledger",
    forwarded: [60, 60],
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
      "UPDATE ledgers SET deleted_at=now(), updated_at=now() WHERE id=$1 AND name LIKE 'E2E home ledger %'",
      [id],
    );
  }
  fixtures.length = 0;
});
test.afterAll(async () => {
  await pool.end();
});
const add = (page: Page) =>
  page
    .getByRole("button", { name: "Add transaction", exact: true })
    .filter({ visible: true });
const hero = (page: Page) => page.locator(".ui-hero-figure");
// "Money in" and "Money out" are the two columns of the This month card.
const month = (page: Page, label: "Money in" | "Money out") =>
  page.locator(".home-month-cols > span", { hasText: label }).locator("strong");
const latestRows = (page: Page) =>
  page.locator("section[aria-labelledby=home-latest] .ui-row");

async function addExpense(page: Page, amount: string) {
  await add(page).click();
  await page.getByLabel("Amount (USD)").fill(amount);
  await chooseCategory(page, "Category", "Food");
  await page.getByLabel("Account", { exact: true }).selectOption(bankId);
  await page.getByRole("button", { name: "Save transaction" }).click();
  await expect(page.getByText("Transaction saved.")).toBeVisible();
}
async function addTransfer(page: Page, amount: string) {
  await add(page).click();
  await page.getByRole("radio", { name: "Transfer", exact: true }).check();
  await page.getByLabel("Amount (USD)").fill(amount);
  await page.getByLabel("From account").selectOption(bankId);
  await page.getByLabel("To account").selectOption(cashId);
  await page.getByRole("button", { name: "Save transfer" }).click();
  await expect(
    page.getByText("Transfer saved.", { exact: true }),
  ).toBeVisible();
}

test("shows real totals, refreshes after every kind of change and hides amounts", async ({
  page,
}, testInfo) => {
  await signIn(page);
  // In hand: Checking 100000 + Cash 20000. The card and the archived savings are not in it.
  await expect(hero(page)).toHaveText("$1,200.00");
  await expect(page.locator(".ui-hero")).toContainText("In hand");
  await expect(page.getByText("Net worth")).toHaveCount(0);
  // Cards and loans are listed, apart from money to hand, and are not in In hand.
  await expect(
    page.getByText("Cards and loans", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Visa", { exact: true })).toBeVisible();
  await expect(month(page, "Money in")).toHaveText("$0.00");
  await expect(month(page, "Money out")).toHaveText("$0.00");
  // Nobody owes anything, so none of the small figures is there.
  await expect(page.getByRole("link", { name: /Clients owe/ })).toHaveCount(0);
  await expect(page.getByRole("link", { name: /People owe/ })).toHaveCount(0);
  await expect(
    page.getByText("Use Add to record your first entry"),
  ).toBeVisible();
  await expect(page.getByText("Archived accounts")).toBeVisible();

  await addExpense(page, "42.15");
  await expect(hero(page)).toHaveText("$1,157.85");
  await expect(month(page, "Money out")).toHaveText("$42.15");
  await expect(latestRows(page)).toHaveCount(1);

  await addTransfer(page, "12.34");
  await expect(hero(page)).toHaveText("$1,157.85");
  await expect(month(page, "Money out")).toHaveText("$42.15");
  await expect(month(page, "Money in")).toHaveText("$0.00");
  // One row for the transfer, not one per leg.
  await expect(latestRows(page)).toHaveCount(2);
  await expect(
    page.getByText("Checking → Cash", { exact: true }),
  ).toBeVisible();

  // Open the expense from Home, then delete and undo it.
  await latestRows(page).filter({ hasText: "Food" }).click();
  const editor = page.getByRole("dialog", { name: "Edit transaction" });
  await editor.getByRole("button", { name: "Delete transaction" }).click();
  await page.getByRole("button", { name: "Confirm delete" }).click();
  await expect(month(page, "Money out")).toHaveText("$0.00");
  await expect(hero(page)).toHaveText("$1,200.00");
  await page
    .getByRole("button", { name: "Undo deletion", exact: true })
    .click();
  await expect(month(page, "Money out")).toHaveText("$42.15");
  await expect(hero(page)).toHaveText("$1,157.85");

  // Privacy removes digits from the page and survives reload.
  await page.getByRole("button", { name: "Hide amounts", exact: true }).click();
  const main = page.locator("main");
  await expect(main.getByText("Amount hidden").first()).toBeAttached();
  expect(await main.innerText()).not.toMatch(/\$\s?\d/);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Home", exact: true }),
  ).toBeVisible();
  await expect(main.getByText("Amount hidden").first()).toBeAttached();
  expect(await main.innerText()).not.toMatch(/\$\s?\d/);
  await page.getByRole("button", { name: "Show amounts", exact: true }).click();
  await expect(hero(page)).toHaveText("$1,157.85");

  // Matches the Accounts screen and transaction list.
  const accounts = await (
    await page.request.get(`/api/v1/ledgers/${ledgerId}/accounts`)
  ).json();
  expect(
    accounts.items.reduce(
      (sum: number, row: { balance: { amount: number } }) =>
        sum + row.balance.amount,
      0,
    ),
  ).toBe(135785);
  // Net worth moved to Insights as Net worth now, with what is held and what is owed on cards and loans.
  await page.goto("/insights");
  const netWorth = page.getByRole("region", { name: "Net worth now" });
  await expect(netWorth).toContainText("$1,357.85");
  await expect(netWorth).toContainText("Liabilities-$300.00");
  await page.getByRole("button", { name: "Hide amounts", exact: true }).click();
  expect(await netWorth.innerText()).not.toMatch(/\$\s?\d/);
  await page.getByRole("button", { name: "Show amounts", exact: true }).click();
  await page.goto("/");
  await expect(hero(page)).toHaveText("$1,157.85");

  // Layout: no horizontal scroll at 320 px in both themes; screenshots for review.
  for (const theme of ["light", "dark"] as const) {
    await setTheme(page, theme);
    for (const width of [320, 390, 1200]) {
      await page.setViewportSize({ width, height: 900 });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
    }
    await page.setViewportSize({ width: 320, height: 900 });
    await page.screenshot({
      path: testInfo.outputPath(`home-${theme}-320.png`),
      fullPage: true,
    });
  }
});

test("is reachable and operable with the keyboard", async ({ page }) => {
  await signIn(page);
  await addExpense(page, "5.00");
  const row = latestRows(page).first();
  await row.focus();
  await expect(row).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("dialog", { name: "Edit transaction" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  const view = page.getByRole("link", { name: "View all" });
  await view.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/transactions/);
});
