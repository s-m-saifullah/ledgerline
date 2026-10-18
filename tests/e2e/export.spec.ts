import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { newId } from "../../packages/shared/src/index";
import {
  connectLocalDatabase,
  createOwnerLedger,
  prepareBrowser,
} from "./ledger-setup";
import { signIn } from "./sign-in";

const { env, pool } = connectLocalDatabase("Export browser tests");
const fixtures: string[] = [];

test.beforeEach(async ({ page }, testInfo) => {
  const ledgerId = newId();
  fixtures.push(ledgerId);
  await createOwnerLedger(
    pool,
    env,
    ledgerId,
    `E2E export ledger ${testInfo.project.name}`,
  );
  const account = newId();
  await pool.query(
    "INSERT INTO accounts (id,ledger_id,name,type,opening_balance) VALUES ($1,$2,'Checking','bank',0)",
    [account, ledgerId],
  );
  const category = newId();
  await pool.query(
    "INSERT INTO categories (id,ledger_id,name,kind) VALUES ($1,$2,'Food','expense')",
    [category, ledgerId],
  );
  for (const [payee, date, amount] of [
    ["Lunch", "2026-09-10", -1250],
    ["Dinner, out", "2026-10-02", -4000],
  ] as const)
    await pool.query(
      "INSERT INTO transactions (id,ledger_id,account_id,category_id,kind,date,amount,base_amount,payee,status) VALUES ($1,$2,$3,$4,'expense',$5,$6,$6,$7,'cleared')",
      [newId(), ledgerId, account, category, date, amount, payee],
    );
  await prepareBrowser(page, testInfo, {
    ledgerId,
    name: "Synthetic export ledger",
    forwarded: [130, 20],
  });
  await signIn(page);
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
      "UPDATE ledgers SET deleted_at=now(), updated_at=now() WHERE id=$1 AND name LIKE 'E2E export ledger %'",
      [id],
    );
  }
  fixtures.length = 0;
});
test.afterAll(async () => {
  await pool.end();
});

async function savedText(
  page: import("@playwright/test").Page,
  click: () => Promise<void>,
) {
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    click(),
  ]);
  const path = await download.path();
  return {
    name: download.suggestedFilename(),
    text: await readFile(path, "utf8"),
  };
}

test("Transactions exports what its filters show", async ({ page }) => {
  await page.goto("/transactions?from=2026-10-01&to=2026-10-31");
  await expect(page.getByText("Dinner, out").first()).toBeVisible();
  const file = await savedText(page, () =>
    page.getByRole("button", { name: "Export as CSV" }).click(),
  );
  expect(file.name).toMatch(/^ledgerline-transactions-\d{4}-\d{2}-\d{2}\.csv$/);
  expect(file.text.startsWith("﻿id,date,time,type,amount,")).toBe(true);
  expect(file.text).toContain('"Dinner, out"');
  expect(file.text).toContain(",40.00,USD,Checking,");
  expect(file.text).not.toContain("Lunch");
  await expect(page.getByText("Your file is ready.")).toBeVisible();
});

test("Settings downloads all three files", async ({ page }) => {
  await page.goto("/settings");
  const all = await savedText(page, () =>
    page.getByRole("button", { name: "Download transactions" }).click(),
  );
  expect(all.text).toContain("Lunch");
  expect(all.text).toContain("Dinner");
  await page.getByLabel("From date", { exact: true }).fill("2026-10-01");
  const october = await savedText(page, () =>
    page.getByRole("button", { name: "Download transactions" }).click(),
  );
  expect(october.text).not.toContain("Lunch");
  const accounts = await savedText(page, () =>
    page.getByRole("button", { name: "Download accounts" }).click(),
  );
  expect(accounts.text).toContain("Checking,bank,USD,0.00,false");
  const categories = await savedText(page, () =>
    page.getByRole("button", { name: "Download categories" }).click(),
  );
  expect(categories.text).toContain("Food,,expense,,false");
});
