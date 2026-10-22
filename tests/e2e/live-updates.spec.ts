import { expect, test } from "@playwright/test";
import { newId } from "../../packages/shared/src/index";
import {
  connectLocalDatabase,
  createOwnerLedger,
  prepareBrowser,
} from "./ledger-setup";
import { signIn } from "./sign-in";

// ADR 0044: an open page follows changes made elsewhere (here written through the API, as the Android app does)
// without a reload, by polling the ledger's change marker.
const { env, pool } = connectLocalDatabase("Live update browser tests");
let ledgerId = "";
let account = "";
let category = "";

test.beforeEach(async ({ page }, testInfo) => {
  ledgerId = newId();
  account = newId();
  category = newId();
  await createOwnerLedger(
    pool,
    env,
    ledgerId,
    `E2E live ledger ${testInfo.project.name}`,
  );
  await pool.query(
    "INSERT INTO accounts (id,ledger_id,name,type,opening_balance) VALUES ($1,$2,'Checking','bank',10000)",
    [account, ledgerId],
  );
  await pool.query(
    "INSERT INTO categories (id,ledger_id,name,kind) VALUES ($1,$2,'Food','expense')",
    [category, ledgerId],
  );
  await prepareBrowser(page, testInfo, {
    ledgerId,
    name: "Synthetic live ledger",
    forwarded: [250, 4],
  });
  await signIn(page);
});
test.afterEach(async () => {
  for (const table of [
    "transactions",
    "accounts",
    "categories",
    "ledger_members",
  ])
    await pool.query(
      `UPDATE ${table} SET deleted_at=now(), updated_at=now() WHERE ledger_id=$1`,
      [ledgerId],
    );
  await pool.query(
    "UPDATE ledgers SET deleted_at=now(), updated_at=now() WHERE id=$1 AND name LIKE 'E2E live ledger %'",
    [ledgerId],
  );
});
test.afterAll(async () => {
  await pool.end();
});

test("an entry made elsewhere appears on an open page without a reload, and so does its edit", async ({
  page,
  baseURL,
}) => {
  test.setTimeout(90_000);
  await page.goto("/transactions");
  await expect(
    page.getByRole("heading", { name: "Transactions", level: 1 }),
  ).toBeVisible();
  // A mark on the window: a reload would remove it.
  await page.evaluate(() => {
    (window as unknown as { stillTheSamePage: boolean }).stillTheSamePage =
      true;
  });
  const write = (method: "post" | "patch", path: string, data: object) =>
    page.request[method](`/api/v1/ledgers/${ledgerId}${path}`, {
      headers: { origin: baseURL as string, "idempotency-key": newId() },
      data,
    });
  const made = await write("post", "/transactions", {
    accountId: account,
    categoryId: category,
    kind: "expense",
    date: "2026-10-05",
    amount: { amount: -1250, currency: "USD" },
    payee: "Made on the phone",
  });
  expect(made.status()).toBe(201);
  await expect(page.getByText("Made on the phone").first()).toBeVisible({
    timeout: 30_000,
  });

  const entry = await made.json();
  const edited = await write("patch", `/transactions/${entry.id}`, {
    expectedVersion: entry.version,
    payee: "Edited on the phone",
  });
  expect(edited.status()).toBe(200);
  await expect(page.getByText("Edited on the phone").first()).toBeVisible({
    timeout: 30_000,
  });
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { stillTheSamePage?: boolean }).stillTheSamePage,
    ),
  ).toBe(true);
});
