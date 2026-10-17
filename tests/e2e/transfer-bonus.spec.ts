import { expect, type Page, test } from "@playwright/test";
import { newId } from "../../packages/shared/src/index";
import {
  connectLocalDatabase,
  createOwnerLedger,
  prepareBrowser,
} from "./ledger-setup";
import { signIn } from "./sign-in";

const { env, pool } = connectLocalDatabase("Transfer bonus browser tests");
let ledgerId = "";
const fixtures: string[] = [];

test.beforeEach(async ({ page }, testInfo) => {
  ledgerId = newId();
  fixtures.push(ledgerId);
  await createOwnerLedger(
    pool,
    env,
    ledgerId,
    `E2E bonus ledger ${testInfo.project.name}`,
  );
  // A dollar account, and a euro account that gets a 2.5% bonus recorded under an income category.
  const bonusCategory = newId();
  await pool.query(
    "INSERT INTO accounts (id,ledger_id,name,type,opening_balance) VALUES ($1,$2,'Checking','bank',1000000)",
    [newId(), ledgerId],
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
    name: "Synthetic bonus ledger",
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
      "UPDATE ledgers SET deleted_at=now(), updated_at=now() WHERE id=$1 AND name LIKE 'E2E bonus ledger %'",
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
      "SELECT kind, amount::text AS amount, currency, base_amount::text AS base_amount, transfer_id, related_transfer_id FROM transactions WHERE ledger_id=$1 AND deleted_at IS NULL ORDER BY amount",
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

test("a transfer's bonus is suggested, saved with it, left out when switched off, and Undo removes both", async ({
  page,
}) => {
  await signIn(page);
  await page.goto("/");

  // 1. The destination's rate suggests 2.5% of the 80.00 EUR that arrives, in its category.
  await fillTransfer(page);
  await expect(page.getByLabel(/Add a bonus/)).toBeChecked();
  await expect(page.getByLabel("Bonus (EUR)")).toHaveValue("2.00");
  await expect(page.getByLabel("Bonus category", { exact: true })).toHaveValue(
    /Remittance bonus/,
  );
  await page.getByRole("button", { name: "Save transfer" }).click();
  await expect(
    page.getByText("Transfer saved.", { exact: true }),
  ).toBeVisible();
  const saved = await live();
  const bonus = saved.find((row) => row.related_transfer_id);
  const legs = saved.filter((row) => row.transfer_id);
  expect(saved).toHaveLength(3);
  expect(legs.map((row) => [row.amount, row.currency])).toEqual([
    ["-10000", "USD"],
    ["8000", "EUR"],
  ]);
  expect(bonus).toMatchObject({
    kind: "income",
    amount: "200",
    currency: "EUR",
    base_amount: "160",
    related_transfer_id: legs[0]?.transfer_id,
  });

  // 2. Undo removes the transfer and its bonus together.
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect.poll(async () => (await live()).length).toBe(0);

  // 3. Switched off, the transfer is saved alone.
  await page.goto("/");
  await fillTransfer(page);
  await page.getByLabel(/Add a bonus/).uncheck();
  await page.getByRole("button", { name: "Save transfer" }).click();
  await expect(
    page.getByText("Transfer saved.", { exact: true }),
  ).toBeVisible();
  expect((await live()).map((row) => row.kind)).toEqual([
    "transfer",
    "transfer",
  ]);
});
