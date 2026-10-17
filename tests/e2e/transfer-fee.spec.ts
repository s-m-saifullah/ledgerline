import { expect, type Page, test } from "@playwright/test";
import { newId } from "../../packages/shared/src/index";
import {
  connectLocalDatabase,
  createOwnerLedger,
  prepareBrowser,
} from "./ledger-setup";
import { signIn } from "./sign-in";

const { env, pool } = connectLocalDatabase("Transfer fee browser tests");
let ledgerId = "";
const fixtures: string[] = [];

test.beforeEach(async ({ page }, testInfo) => {
  ledgerId = newId();
  fixtures.push(ledgerId);
  await createOwnerLedger(
    pool,
    env,
    ledgerId,
    `E2E fee ledger ${testInfo.project.name}`,
  );
  // A dollar account, and a euro account that gets a 2.5% bonus recorded under an income category.
  const bonusCategory = newId();
  // The dollar account remembers a 1% fee and its category.
  const feeCategory = newId();
  await pool.query(
    "INSERT INTO categories (id,ledger_id,name,kind) VALUES ($1,$2,'Transfer fees','expense')",
    [feeCategory, ledgerId],
  );
  await pool.query(
    "INSERT INTO accounts (id,ledger_id,name,type,opening_balance,fee_category_id,default_fee_bps) VALUES ($1,$2,'Checking','bank',1000000,$3,100)",
    [newId(), ledgerId, feeCategory],
  );
  await pool.query(
    "INSERT INTO categories (id,ledger_id,name,kind) VALUES ($1,$2,'Remittance bonus','income')",
    [bonusCategory, ledgerId],
  );
  await pool.query(
    "INSERT INTO accounts (id,ledger_id,name,type,currency,opening_balance,inbound_bonus_bps,bonus_category_id) VALUES ($1,$2,'Euro wallet','wallet','EUR',0,250,$3)",
    [newId(), ledgerId, bonusCategory],
  );
  await pool.query(
    "INSERT INTO currencies (id,ledger_id,code) VALUES ($1,$2,'EUR')",
    [newId(), ledgerId],
  );
  await pool.query(
    "INSERT INTO exchange_rates (id,ledger_id,code,date,rate,source) VALUES ($1,$2,'EUR','2026-01-01','0.8','manual')",
    [newId(), ledgerId],
  );
  await prepareBrowser(page, testInfo, {
    ledgerId,
    name: "Synthetic fee ledger",
    forwarded: [40, 160],
  });
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
      "UPDATE ledgers SET deleted_at=now(), updated_at=now() WHERE id=$1 AND name LIKE 'E2E fee ledger %'",
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
const live = async () =>
  (
    await pool.query(
      "SELECT kind, amount::text AS amount, currency, base_amount::text AS base_amount, transfer_id, related_transfer_id, fee_transfer_id FROM transactions WHERE ledger_id=$1 AND deleted_at IS NULL ORDER BY amount",
      [ledgerId],
    )
  ).rows;
async function fillTransfer(page: Page) {
  await add(page).click();
  await page.getByRole("radio", { name: "Transfer", exact: true }).check();
  await page.getByLabel("From account").selectOption({ label: "Checking" });
  await page.getByLabel("To account").selectOption({ label: "Euro wallet" });
  await page.getByLabel("Amount sent (USD)").fill("100");
  await page.getByLabel("Amount received (EUR)").fill("80");
}

test("a transfer's fee starts from the account's remembered fee, is saved with it, and Undo removes everything", async ({
  page,
}) => {
  await signIn(page);
  await page.goto("/");

  // 1. The sending account's 1% fee and category are filled in, with a plain hint and a preview.
  await fillTransfer(page);
  const fee = page.getByLabel("Fee (optional)");
  await expect(fee).toHaveValue("1%");
  await expect(
    page.getByText(/Type 2 for a fixed fee, or 2% for a percentage/),
  ).toBeVisible();
  await expect(page.locator("#transfer-fee-preview")).toContainText(
    "Fee $1.00 · $101.00 leaves Checking",
  );
  await expect(page.getByLabel("Fee category", { exact: true })).toHaveValue(
    /Transfer fees/,
  );

  // 2. A plain number is a fixed fee. It is saved with the transfer (and the 2.5% bonus).
  await fee.fill("2");
  await expect(page.locator("#transfer-fee-preview")).toContainText(
    "Fee $2.00 · $102.00 leaves Checking",
  );
  await page.getByRole("button", { name: "Save transfer" }).click();
  await expect(
    page.getByText("Transfer saved.", { exact: true }),
  ).toBeVisible();
  const saved = await live();
  const legs = saved.filter((row) => row.transfer_id);
  const feeRow = saved.find((row) => row.fee_transfer_id);
  expect(saved).toHaveLength(4);
  expect(legs.map((row) => [row.amount, row.currency])).toEqual([
    ["-10000", "USD"],
    ["8000", "EUR"],
  ]);
  expect(feeRow).toMatchObject({
    kind: "expense",
    amount: "-200",
    currency: "USD",
    base_amount: "-200",
    fee_transfer_id: legs[0]?.transfer_id,
  });
  expect(saved.find((row) => row.related_transfer_id)).toMatchObject({
    kind: "income",
    amount: "200",
  });

  // 3. Undo removes the transfer, its bonus and its fee together.
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect.poll(async () => (await live()).length).toBe(0);
});

test("a percentage fee is worked out from the amount sent, and a fee can be left out", async ({
  page,
}) => {
  await signIn(page);
  await page.goto("/");
  await fillTransfer(page);
  await page.getByLabel(/Add a bonus/).uncheck();
  await page.getByLabel("Fee (optional)").fill("2.5%");
  await expect(page.locator("#transfer-fee-preview")).toContainText(
    "Fee $2.50 · $102.50 leaves Checking",
  );
  await page.getByRole("button", { name: "Save transfer" }).click();
  await expect(
    page.getByText("Transfer saved.", { exact: true }),
  ).toBeVisible();
  expect((await live()).find((row) => row.fee_transfer_id)?.amount).toBe(
    "-250",
  );
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect.poll(async () => (await live()).length).toBe(0);

  // Cleared, the box leaves the transfer alone.
  await page.goto("/");
  await fillTransfer(page);
  await page.getByLabel(/Add a bonus/).uncheck();
  await page.getByLabel("Fee (optional)").fill("");
  await page.getByRole("button", { name: "Save transfer" }).click();
  await expect(
    page.getByText("Transfer saved.", { exact: true }),
  ).toBeVisible();
  expect((await live()).map((row) => row.kind)).toEqual([
    "transfer",
    "transfer",
  ]);
});

test("deleting a transfer offers to delete its fee, and the form fits a narrow phone", async ({
  page,
}) => {
  await signIn(page);
  await page.goto("/");
  await fillTransfer(page);
  await page.getByLabel(/Add a bonus/).uncheck();
  await page.getByRole("button", { name: "Save transfer" }).click();
  await expect(
    page.getByText("Transfer saved.", { exact: true }),
  ).toBeVisible();
  expect(await live()).toHaveLength(3);

  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto("/transactions");
  await page
    .getByRole("button", { name: /Open transaction: Transfer from Checking/ })
    .click();
  await page.getByRole("button", { name: "Delete transfer" }).click();
  await expect(page.getByLabel("Also delete its fee entry")).toBeChecked();
  const fits = await page.evaluate(
    () => document.documentElement.scrollWidth <= window.innerWidth,
  );
  expect(fits).toBe(true);
  await page.getByRole("button", { name: "Confirm delete" }).click();
  await expect.poll(async () => (await live()).length).toBe(0);
});
