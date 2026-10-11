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
    "Recurring fee browser tests require the local development database.",
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
    [ledgerId, `E2E recurring fee ledger ${testInfo.project.name}`],
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
    "INSERT INTO accounts (id,ledger_id,name,type,opening_balance) VALUES ($1,$2,'Savings','savings',0)",
    [newId(), ledgerId],
  );
  await pool.query(
    "INSERT INTO categories (id,ledger_id,name,kind) VALUES ($1,$2,'Transfer fees','expense')",
    [newId(), ledgerId],
  );
  await page.route("**/api/v1/ledgers", (route) =>
    route.fulfill({
      json: {
        items: [
          {
            id: ledgerId,
            name: "Synthetic recurring fee ledger",
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
      "UPDATE ledgers SET deleted_at=now(), updated_at=now() WHERE id=$1 AND name LIKE 'E2E recurring fee ledger %'",
      [id],
    );
  }
  fixtures.length = 0;
});
test.afterAll(async () => {
  await pool.end();
});

const rows = async () =>
  (
    await pool.query(
      "SELECT kind, amount::text AS amount, transfer_id, fee_transfer_id, date::text AS date FROM transactions WHERE ledger_id=$1 AND deleted_at IS NULL ORDER BY date, amount",
      [ledgerId],
    )
  ).rows;

test("a recurring transfer carries a fee that is worked out for each occurrence", async ({
  page,
}) => {
  await signIn(page);
  await page.goto("/more/recurring");
  const start = new Date(Date.now() - 45 * 86_400_000)
    .toISOString()
    .slice(0, 10);
  await page.getByRole("button", { name: "Add a recurring entry" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Name").fill("Savings plan");
  await dialog.getByRole("radio", { name: "Transfer" }).check();
  await dialog
    .getByLabel("To account")
    .selectOption({ label: "Savings (USD)" });
  await dialog.getByLabel("Amount (USD)").fill("100");
  await dialog.getByLabel("Starts").fill(start);
  // A plain hint, then a percentage with a preview, and its category under More.
  await expect(
    dialog.getByText(/Type 2 for a fixed fee, or 2% for a percentage/),
  ).toBeVisible();
  await dialog.getByLabel("Fee (optional)").fill("1.5%");
  await expect(dialog.locator("#rule-fee-preview")).toContainText(
    "Fee $1.50 · $101.50 leaves Checking",
  );
  // No category yet: More opens by itself and saving asks for one.
  await expect(dialog.locator("summary", { hasText: /^More/ })).toBeVisible();
  await dialog.getByRole("button", { name: "Save rule" }).click();
  await expect(
    dialog.getByText("Choose an expense category for the fee."),
  ).toBeVisible();
  await chooseCategory(page, "Fee category", "Transfer fees");
  await dialog.getByRole("button", { name: "Save rule" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();

  // Two occurrences were due: each made its transfer (two legs) and a 1.50 fee entry.
  const made = await rows();
  expect(made.filter((row) => row.kind === "transfer")).toHaveLength(4);
  const fees = made.filter((row) => row.fee_transfer_id);
  expect(fees.map((row) => [row.kind, row.amount])).toEqual([
    ["expense", "-150"],
    ["expense", "-150"],
  ]);
  const transferIds = new Set(
    made.filter((row) => row.transfer_id).map((row) => row.transfer_id),
  );
  expect(fees.every((row) => transferIds.has(row.fee_transfer_id))).toBe(true);

  // Opening the rule shows the fee the way it was typed.
  await page.getByRole("button", { name: /Savings plan/ }).click();
  await expect(page.getByLabel("Fee (optional)")).toHaveValue("1.5%");
});
