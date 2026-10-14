import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { expect, test } from "@playwright/test";
import { createDatabase } from "../../apps/api/src/db/client";
import { newId } from "../../packages/shared/src/index";
import { chooseCategory } from "./category-picker";
import { clickAction } from "./client-actions";
import { signIn } from "./sign-in";

const env = parseEnv(readFileSync(".env", "utf8"));
const databaseUrl = env.DATABASE_URL;
if (
  !databaseUrl ||
  !["localhost", "127.0.0.1"].includes(new URL(databaseUrl).hostname) ||
  !["/ledgerline", "/ledgerline_test"].includes(new URL(databaseUrl).pathname)
)
  throw new Error(
    "Owed currency browser tests require the local development database.",
  );
const { pool } = createDatabase(databaseUrl);
let ledgerId = "";

test.beforeEach(async ({ page }, testInfo) => {
  ledgerId = newId();
  const owner = (
    await pool.query(
      "SELECT id FROM users WHERE email = $1 AND deleted_at IS NULL",
      [env.OWNER_EMAIL],
    )
  ).rows[0];
  if (!owner) throw new Error("Missing browser test owner");
  await pool.query("INSERT INTO ledgers (id,name) VALUES ($1,$2)", [
    ledgerId,
    `E2E owed ledger ${testInfo.project.name}`,
  ]);
  await pool.query(
    "INSERT INTO ledger_members (id,ledger_id,user_id,role) VALUES ($1,$2,$3,'owner')",
    [newId(), ledgerId, owner.id],
  );
  // A dollar account, an income category, euros with a rate, and a client who owes EUR 800.00.
  const client = newId();
  await pool.query(
    "INSERT INTO accounts (id,ledger_id,name,type,opening_balance) VALUES ($1,$2,'Checking','bank',0)",
    [newId(), ledgerId],
  );
  await pool.query(
    "INSERT INTO categories (id,ledger_id,name,kind) VALUES ($1,$2,'Services','income')",
    [newId(), ledgerId],
  );
  await pool.query(
    "INSERT INTO currencies (id,ledger_id,code) VALUES ($1,$2,'EUR')",
    [newId(), ledgerId],
  );
  await pool.query(
    "INSERT INTO exchange_rates (id,ledger_id,code,date,rate,source) VALUES ($1,$2,'EUR','2026-01-01','0.8','manual')",
    [newId(), ledgerId],
  );
  await pool.query(
    "INSERT INTO contacts (id,ledger_id,name) VALUES ($1,$2,'Euro client')",
    [client, ledgerId],
  );
  await pool.query(
    "INSERT INTO receivables (id,ledger_id,contact_id,description,service_date,amount,currency) VALUES ($1,$2,$3,'Website in euros','2026-10-05',80000,'EUR')",
    [newId(), ledgerId, client],
  );
  await page.route("**/api/v1/ledgers", (route) =>
    route.fulfill({
      json: {
        items: [
          {
            id: ledgerId,
            name: "Synthetic owed ledger",
            timeZone: null,
            version: 1,
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
  const c = await pool.connect();
  try {
    await c.query("begin");
    // Linked income and its payment are deleted together, as the database requires.
    await c.query(
      "update receivable_payments set deleted_at=now(),version=version+1 where ledger_id=$1 and deleted_at is null",
      [ledgerId],
    );
    await c.query(
      "update transactions t set deleted_at=p.deleted_at,version=p.version from receivable_payments p where p.ledger_id=$1 and t.ledger_id=p.ledger_id and t.id=p.transaction_id",
      [ledgerId],
    );
    await c.query(
      "update receivables set deleted_at=now(),written_off_at=null,written_off_amount=null,write_off_reason=null where ledger_id=$1",
      [ledgerId],
    );
    for (const table of [
      "exchange_rates",
      "currencies",
      "contacts",
      "accounts",
      "categories",
      "ledger_members",
    ])
      await c.query(`update ${table} set deleted_at=now() where ledger_id=$1`, [
        ledgerId,
      ]);
    await c.query(
      "update ledgers set deleted_at=now() where id=$1 and name like 'E2E owed ledger %'",
      [ledgerId],
    );
    await c.query("commit");
  } catch (e) {
    await c.query("rollback");
    throw e;
  } finally {
    c.release();
  }
});
test.afterAll(async () => {
  await pool.end();
});

test("money owed in euros is shown in euros and settled into a dollar account with the dollars received", async ({
  page,
}) => {
  await signIn(page);
  await page.goto("/more/clients");
  await page.getByRole("button", { name: /Euro client/ }).click();

  // 1. The balance is in euros, with its dollar value at today's rate (1 EUR = 0.80 USD).
  await expect(page.getByText("€800.00").first()).toBeVisible();
  await expect(
    page.getByText(/About \$640\.00 at today's rates/),
  ).toBeVisible();

  // 2. Record a payment: the dollar account asks for the dollars that arrived.
  await clickAction(page, "Record payment from Euro client");
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Pay full balance" }).click();
  await expect(dialog.getByLabel("Payment amount (EUR)")).toHaveValue("800.00");
  await dialog
    .getByLabel("Receiving account")
    .selectOption({ label: "Checking" });
  await expect(dialog.getByLabel("Amount received (USD)")).toBeVisible();
  await dialog.getByLabel("Amount received (USD)").fill("1000");
  await expect(dialog.getByText("1 USD = 0.8 EUR")).toBeVisible();
  await chooseCategory(page, "Category for the payment", "Services");
  await dialog.getByRole("button", { name: "Save payment" }).click();
  await expect(
    page.getByText("Payment applied", { exact: false }),
  ).toBeVisible();

  // 3. The euro item is paid in full; the income entry is in dollars, exactly as received.
  const paid = (
    await pool.query(
      "SELECT amount::text AS amount, currency FROM receivable_payments WHERE ledger_id=$1 AND deleted_at IS NULL",
      [ledgerId],
    )
  ).rows;
  expect(paid).toEqual([{ amount: "80000", currency: "EUR" }]);
  const income = (
    await pool.query(
      "SELECT kind, amount::text AS amount, currency, base_amount::text AS base_amount FROM transactions WHERE ledger_id=$1 AND deleted_at IS NULL",
      [ledgerId],
    )
  ).rows;
  expect(income).toEqual([
    {
      kind: "income",
      amount: "100000",
      currency: "USD",
      base_amount: "100000",
    },
  ]);
  await expect(page.getByText("About $", { exact: false })).toHaveCount(0);
});
