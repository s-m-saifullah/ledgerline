import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { expect, type Page, test } from "@playwright/test";
import { createDatabase } from "../../apps/api/src/db/client";
import { newId } from "../../packages/shared/src/index";
import { chooseCategory } from "./category-picker";
import { signIn } from "./sign-in";

const env = parseEnv(readFileSync(".env", "utf8"));
const databaseUrl = env.DATABASE_URL;
if (
  !databaseUrl ||
  !["localhost", "127.0.0.1"].includes(new URL(databaseUrl).hostname) ||
  !["/ledgerline", "/ledgerline_test"].includes(new URL(databaseUrl).pathname)
)
  throw new Error(
    "Currency browser tests require the local development database.",
  );
const { pool } = createDatabase(databaseUrl);
let ledgerId = "";
const fixtures: string[] = [];

test.beforeEach(async ({ page }, testInfo) => {
  ledgerId = newId();
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
    `E2E currencies ledger ${testInfo.project.name}`,
  ]);
  await pool.query(
    "INSERT INTO ledger_members (id,ledger_id,user_id,role) VALUES ($1,$2,$3,'owner')",
    [newId(), ledgerId, owner.id],
  );
  // One dollar account with $10,000.00, a Food category, and EUR added as a currency (no rate yet).
  await pool.query(
    "INSERT INTO accounts (id,ledger_id,name,type,opening_balance) VALUES ($1,$2,'Checking','bank',1000000)",
    [newId(), ledgerId],
  );
  await pool.query(
    "INSERT INTO categories (id,ledger_id,name,kind) VALUES ($1,$2,'Food','expense')",
    [newId(), ledgerId],
  );
  await pool.query(
    "INSERT INTO currencies (id,ledger_id,code) VALUES ($1,$2,'EUR')",
    [newId(), ledgerId],
  );
  await page.route("**/api/v1/ledgers", (route) =>
    route.fulfill({
      json: {
        items: [
          {
            id: ledgerId,
            name: "Synthetic currencies ledger",
            baseCurrency: "USD",
            role: "owner",
          },
        ],
      },
    }),
  );
  await page.setExtraHTTPHeaders({
    "x-forwarded-for": `203.0.113.${40 + (testInfo.workerIndex % 160)}`,
  });
  await page.emulateMedia({ colorScheme: "light" });
});
test.afterEach(async () => {
  for (const id of fixtures) {
    for (const table of [
      "transactions",
      "exchange_rates",
      "currencies",
      "accounts",
      "categories",
      "ledger_members",
    ])
      await pool.query(
        `UPDATE ${table} SET deleted_at=now(), updated_at=now() WHERE ledger_id=$1`,
        [id],
      );
    await pool.query(
      "UPDATE ledgers SET deleted_at=now(), updated_at=now() WHERE id=$1 AND name LIKE 'E2E currencies ledger %'",
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
const rows = async () =>
  (
    await pool.query(
      "SELECT kind, amount::text AS amount, currency, fx_rate::text AS fx_rate, base_amount::text AS base_amount FROM transactions WHERE ledger_id=$1 AND deleted_at IS NULL",
      [ledgerId],
    )
  ).rows.sort((a, b) => Number(a.amount) - Number(b.amount));

test("currencies work end to end: a rate, an account, an entry, a transfer and Home", async ({
  page,
}) => {
  await signIn(page);

  // 1. Set the euro rate by hand on the Currencies screen: 1 USD = 1.25 EUR, so 1 EUR = 0.80 USD.
  await page.goto("/more/currencies");
  await expect(
    page.getByRole("heading", { name: "Currencies", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: /Euro/ }).click();
  await page.getByLabel("1 USD is worth (EUR)").fill("1.25");
  await page.getByRole("button", { name: "Save rate" }).click();
  await expect(page.getByText(/1 USD = 1\.25 EUR/)).toBeVisible();

  // 2. Add a euro account; its card shows euros and today's value in dollars.
  await page.goto("/more/accounts");
  await page
    .getByRole("button", { name: /Add (your first )?account/, exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Account name").fill("Euro bank");
  await dialog.getByLabel("Currency").selectOption("EUR");
  await dialog.getByLabel("Opening balance (EUR)").fill("1000");
  await dialog.getByRole("button", { name: "Add account" }).click();
  await expect(page.getByText("€1,000.00")).toBeVisible();
  await expect(
    page.getByText("About $800.00 in USD at today's rate"),
  ).toBeVisible();

  // 3. Record a 100.00 EUR expense: the form is in euros and previews its dollar value.
  await page.goto("/");
  await add(page).click();
  await page
    .getByLabel("Account", { exact: true })
    .selectOption({ label: "Euro bank" });
  await expect(page.getByLabel("Amount (EUR)")).toBeVisible();
  await page.getByLabel("Amount (EUR)").fill("100");
  await chooseCategory(page, "Category", "Food");
  await expect(page.getByText(/About \$80\.00/)).toBeVisible();
  await page.getByRole("button", { name: "Save transaction" }).click();
  await expect(
    page.getByText("Transaction saved.", { exact: true }),
  ).toBeVisible();
  expect(await rows()).toEqual([
    {
      kind: "expense",
      amount: "-10000",
      currency: "EUR",
      fx_rate: "0.8000000000",
      base_amount: "-8000",
    },
  ]);

  // 4. Move 50.00 USD into the euro account as 40.00 EUR; the form shows the rate that implies.
  await add(page).click();
  await page.getByRole("radio", { name: "Transfer", exact: true }).check();
  await page.getByLabel("From account").selectOption({ label: "Checking" });
  await page.getByLabel("To account").selectOption({ label: "Euro bank" });
  await page.getByLabel("Amount sent (USD)").fill("50");
  await page.getByLabel("Amount received (EUR)").fill("40");
  await expect(page.getByText("1 USD = 0.8 EUR")).toBeVisible();
  await page.getByRole("button", { name: "Save transfer" }).click();
  await expect(
    page.getByText("Transfer saved.", { exact: true }),
  ).toBeVisible();
  const saved = await rows();
  const legs = saved.filter((row) => row.kind === "transfer");
  expect(
    legs.map((row) => [row.amount, row.currency, row.base_amount]),
  ).toEqual([
    ["-5000", "USD", "-5000"],
    ["4000", "EUR", "5000"],
  ]);

  // 5. Home: euros stay euros with their value beside them, and the totals are in dollars.
  await page.goto("/");
  await expect(page.getByText("€940.00")).toBeVisible();
  await expect(page.getByText("About $752.00").first()).toBeVisible();
  // $9,950.00 in the dollar account + €940.00 at 0.80.
  await expect(page.getByText("$10,702.00").first()).toBeVisible();
});
