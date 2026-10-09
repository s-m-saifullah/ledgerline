import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { expect, type Page, test } from "@playwright/test";
import { createDatabase } from "../../apps/api/src/db/client";
import { newId } from "../../packages/shared/src/index";
import { chooseCategory } from "./category-picker";
import { signIn } from "./sign-in";
import { setTheme } from "./theme";

const env = parseEnv(readFileSync(".env", "utf8"));
const databaseUrl = env.DATABASE_URL;
if (
  !databaseUrl ||
  !["localhost", "127.0.0.1"].includes(new URL(databaseUrl).hostname) ||
  !["/ledgerline", "/ledgerline_test"].includes(new URL(databaseUrl).pathname)
)
  throw new Error("Home browser tests require the local development database.");
const { pool } = createDatabase(databaseUrl);
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
  const owner = (
    await pool.query(
      "SELECT id FROM users WHERE email = $1 AND deleted_at IS NULL",
      [env.OWNER_EMAIL],
    )
  ).rows[0];
  if (!owner) throw new Error("Missing browser test owner");
  await pool.query("INSERT INTO ledgers (id,name) VALUES ($1,$2)", [
    ledgerId,
    `E2E home ledger ${testInfo.project.name}`,
  ]);
  await pool.query(
    "INSERT INTO ledger_members (id,ledger_id,user_id,role) VALUES ($1,$2,$3,'owner')",
    [newId(), ledgerId, owner.id],
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
  await page.route("**/api/v1/ledgers", (route) =>
    route.fulfill({
      json: {
        items: [
          {
            id: ledgerId,
            name: "Synthetic home ledger",
            baseCurrency: "USD",
            role: "owner",
          },
        ],
      },
    }),
  );
  await page.setExtraHTTPHeaders({
    "x-forwarded-for": `203.0.113.${60 + (testInfo.workerIndex % 60)}`,
  });
  await page.emulateMedia({ colorScheme: "light" });
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
const hero = (page: Page) => page.locator(".home-hero .amount");
const card = (page: Page, label: string) =>
  page.locator(".stat-card", { hasText: label }).locator(".amount");

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
  await expect(page.locator(".home-hero")).toContainText("In hand");
  await expect(page.getByText("Net worth")).toHaveCount(0);
  await expect(page.getByText("Visa")).toHaveCount(0);
  await expect(card(page, "Money in")).toHaveText("$0.00");
  await expect(card(page, "Money out")).toHaveText("$0.00");
  await expect(card(page, "Owed to you")).toHaveText("$0.00");
  await expect(
    page.getByText("Use Add to record your first entry"),
  ).toBeVisible();
  await expect(page.getByText("Archived accounts")).toBeVisible();

  await addExpense(page, "42.15");
  await expect(hero(page)).toHaveText("$1,157.85");
  await expect(card(page, "Money out")).toHaveText("$42.15");
  await expect(page.locator(".home-list .transaction-row")).toHaveCount(1);

  await addTransfer(page, "12.34");
  await expect(hero(page)).toHaveText("$1,157.85");
  await expect(card(page, "Money out")).toHaveText("$42.15");
  await expect(card(page, "Money in")).toHaveText("$0.00");
  // One row for the transfer, not one per leg.
  await expect(page.locator(".home-list .transaction-row")).toHaveCount(2);
  await expect(
    page.getByText("Transfer · Checking → Cash", { exact: true }),
  ).toBeVisible();

  // Open the expense from Home, then delete and undo it.
  await page.locator(".transaction-row", { hasText: "Food" }).click();
  const editor = page.getByRole("dialog", { name: "Edit transaction" });
  await editor.getByRole("button", { name: "Delete transaction" }).click();
  await editor.getByRole("button", { name: "Confirm delete" }).click();
  await expect(card(page, "Money out")).toHaveText("$0.00");
  await expect(hero(page)).toHaveText("$1,200.00");
  await page
    .getByRole("button", { name: "Undo deletion", exact: true })
    .click();
  await expect(card(page, "Money out")).toHaveText("$42.15");
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
  // Net worth moved to More > Accounts, with the amount owed on cards and loans.
  await page.goto("/more/accounts");
  const netWorth = page.locator(".net-worth-card");
  await expect(netWorth).toContainText("Net worth");
  await expect(netWorth.locator(".amount")).toHaveText("$1,357.85");
  await expect(netWorth).toContainText("Owed on cards and loans");
  await expect(netWorth.locator(".net-worth-owed")).toContainText("$300.00");
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
  const row = page.locator(".home-list .transaction-row").first();
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
