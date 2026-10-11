import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { expect, test } from "@playwright/test";
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
    "Recurring browser tests require the local development database.",
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
  await pool.query(
    "INSERT INTO ledgers (id,name,time_zone) VALUES ($1,$2,'America/Chicago')",
    [ledgerId, `E2E recurring ledger ${testInfo.project.name}`],
  );
  await pool.query(
    "INSERT INTO ledger_members (id,ledger_id,user_id,role) VALUES ($1,$2,$3,'owner')",
    [newId(), ledgerId, owner.id],
  );
  await pool.query(
    "INSERT INTO accounts (id,ledger_id,name,type,opening_balance) VALUES ($1,$2,'Checking','bank',1000000)",
    [newId(), ledgerId],
  );
  await pool.query(
    "INSERT INTO categories (id,ledger_id,name,kind) VALUES ($1,$2,'Housing','expense')",
    [newId(), ledgerId],
  );
  await page.route("**/api/v1/ledgers", (route) =>
    route.fulfill({
      json: {
        items: [
          {
            id: ledgerId,
            name: "Synthetic recurring ledger",
            baseCurrency: "USD",
            timeZone: "America/Chicago",
            version: 1,
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
      "recurring_runs",
      "recurring_rules",
      "transactions",
      "accounts",
      "categories",
      "ledger_members",
    ])
      await pool.query(
        `UPDATE ${table} SET deleted_at=now(), updated_at=now() WHERE ledger_id=$1`,
        [id],
      );
    await pool.query(
      "UPDATE ledgers SET deleted_at=now(), updated_at=now() WHERE id=$1 AND name LIKE 'E2E recurring ledger %'",
      [id],
    );
  }
  fixtures.length = 0;
});
test.afterAll(async () => {
  await pool.end();
});

const entries = async () =>
  (
    await pool.query(
      "SELECT kind, amount::text AS amount, status, date::text AS date FROM transactions WHERE ledger_id=$1 AND deleted_at IS NULL ORDER BY date",
      [ledgerId],
    )
  ).rows;

test("a recurring rule catches up, then can be paused and deleted", async ({
  page,
}) => {
  await signIn(page);
  await page.goto("/more/recurring");
  await expect(
    page.getByRole("heading", { name: "Recurring", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".topbar-page")).toHaveText("Recurring");
  await expect(page.getByText(/Nothing recurring yet/)).toBeVisible();

  // A monthly rent that started about six weeks ago: two occurrences are already due.
  const start = new Date(Date.now() - 45 * 86_400_000)
    .toISOString()
    .slice(0, 10);
  await page.getByRole("button", { name: "Add a recurring entry" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Name").fill("Rent");
  await dialog.getByLabel("Amount (USD)").fill("100");
  await chooseCategory(page, "Category", "Housing");
  await dialog.getByLabel("Starts").fill(start);
  await expect(dialog.getByText(/2 entries are already due/)).toBeVisible();
  await dialog.getByRole("button", { name: "Save rule" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  const row = page.getByRole("button", { name: /Rent/ });
  await expect(row).toContainText("Expense · Every month · Next");

  // The two entries exist, cleared, dated in the past, and show up in Transactions.
  const made = await entries();
  expect(made).toHaveLength(2);
  expect(made.map((item) => [item.kind, item.amount, item.status])).toEqual([
    ["expense", "-10000", "cleared"],
    ["expense", "-10000", "cleared"],
  ]);
  expect(
    made.every((item) => item.date <= new Date().toISOString().slice(0, 10)),
  ).toBe(true);
  await page.goto("/transactions");
  await expect(page.locator(".transaction-row")).toHaveCount(2);

  // Its history lists both, then it can be paused and deleted; the entries stay.
  await page.goto("/more/recurring");
  await page.getByRole("button", { name: /Rent/ }).click();
  await expect(page.getByText("What it has done")).toBeVisible();
  const history = page.getByRole("dialog").locator(".recurring-runs li");
  await expect(history).toHaveCount(2);
  await expect(history.filter({ hasText: "Created" })).toHaveCount(2);
  await page.getByRole("button", { name: "Pause" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(page.getByRole("button", { name: /Rent/ })).toContainText(
    "Paused",
  );
  await page.getByRole("button", { name: /Rent/ }).click();
  await page.getByRole("button", { name: "Delete rule" }).click();
  await page.getByRole("button", { name: "Yes, delete it" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(page.getByText(/Nothing recurring yet/)).toBeVisible();
  expect(await entries()).toHaveLength(2);
});
