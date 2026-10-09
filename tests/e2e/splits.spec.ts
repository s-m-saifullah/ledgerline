import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
    "Split browser tests require the local development database.",
  );
const { pool } = createDatabase(databaseUrl);
let ledgerId = "",
  bankId = "",
  cashId = "",
  expenseId = "",
  incomeId = "",
  otherExpenseId = "";
const fixtures: string[] = [];
test.beforeEach(async ({ page }, testInfo) => {
  ledgerId = newId();
  bankId = newId();
  cashId = newId();
  expenseId = newId();
  incomeId = newId();
  otherExpenseId = newId();
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
    `E2E splits ledger ${testInfo.project.name}`,
  ]);
  await pool.query(
    "INSERT INTO ledger_members (id,ledger_id,user_id,role) VALUES ($1,$2,$3,'owner')",
    [newId(), ledgerId, owner.id],
  );
  for (const [id, name, amount, archived] of [
    [bankId, "Checking", 10000, false],
    [cashId, "Cash", 5000, false],
    [newId(), "Old account", 999, true],
  ] as const)
    await pool.query(
      "INSERT INTO accounts (id,ledger_id,name,type,opening_balance,archived_at) VALUES ($1,$2,$3,'bank',$4,$5)",
      [id, ledgerId, name, amount, archived ? new Date() : null],
    );
  for (const [id, name, kind, archived] of [
    [expenseId, "Food", "expense", false],
    [otherExpenseId, "Household", "expense", false],
    [incomeId, "Salary", "income", false],
    [newId(), "Old category", "expense", true],
  ] as const)
    await pool.query(
      "INSERT INTO categories (id,ledger_id,name,kind,archived_at) VALUES ($1,$2,$3,$4,$5)",
      [id, ledgerId, name, kind, archived ? new Date() : null],
    );
  await page.route("**/api/v1/ledgers", (route) =>
    route.fulfill({
      json: {
        items: [
          {
            id: ledgerId,
            name: "Synthetic splits ledger",
            baseCurrency: "USD",
            role: "owner",
          },
        ],
      },
    }),
  );
  await page.setExtraHTTPHeaders({
    "x-forwarded-for": `203.0.113.${80 + (testInfo.workerIndex % 160)}`,
  });
  await page.emulateMedia({ colorScheme: "light" });
});
test.afterEach(async () => {
  for (const id of fixtures) {
    await pool.query(
      "WITH removed AS (UPDATE transactions SET deleted_at=now(),updated_at=now(),version=version+1 WHERE ledger_id=$1 AND deleted_at IS NULL RETURNING id,deleted_at,updated_at,version) UPDATE transaction_splits s SET deleted_at=r.deleted_at,updated_at=r.updated_at,version=r.version FROM removed r WHERE s.ledger_id=$1 AND s.transaction_id=r.id AND s.deleted_at IS NULL",
      [id],
    );
    await pool.query(
      "UPDATE accounts SET deleted_at=now(), updated_at=now() WHERE ledger_id=$1",
      [id],
    );
    await pool.query(
      "UPDATE categories SET deleted_at=now(), updated_at=now() WHERE ledger_id=$1",
      [id],
    );
    await pool.query(
      "UPDATE ledger_members SET deleted_at=now(), updated_at=now() WHERE ledger_id=$1",
      [id],
    );
    await pool.query(
      "UPDATE ledgers SET deleted_at=now(), updated_at=now() WHERE id=$1 AND name LIKE 'E2E splits ledger %'",
      [id],
    );
  }
  fixtures.length = 0;
});
test.afterAll(async () => {
  await pool.end();
});

async function openAdd(page: Page) {
  await page
    .getByRole("button", { name: "Add transaction", exact: true })
    .filter({ visible: true })
    .click();
  await expect(page.getByLabel("Amount (USD)", { exact: true })).toBeVisible();
}
async function fillSplits(page: Page) {
  await openAdd(page);
  await page.getByLabel("Amount (USD)", { exact: true }).fill("12.34");
  await page.getByLabel("Split across categories").check();
  await chooseCategory(page, "Split 1 category", "Food");
  await page.getByLabel("Split 1 amount (USD)").fill("2.34");
  await chooseCategory(page, "Split 2 category", "Household");
  await page.getByLabel("Split 2 amount (USD)").fill("10.00");
}
const headers = () => ({
  origin: "http://localhost:5173",
  "idempotency-key": newId(),
});
async function balance(page: Page) {
  const result = await page.request.get(
    `/api/v1/ledgers/${ledgerId}/accounts/${bankId}`,
  );
  expect(result.status()).toBe(200);
  return (await result.json()).balance.amount;
}
async function openHistory(page: Page) {
  await page
    .getByRole("link", { name: "Transactions", exact: true })
    .filter({ visible: true })
    .click();
  await expect(page.locator(".transaction-row")).toHaveCount(1);
  await page
    .getByRole("button", {
      name: "Open transaction: Split transaction",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Edit transaction", exact: true }),
  ).toBeVisible();
}
test("allocates exact cents, edits stable lines, deletes/Undo and converts to ordinary entries", async ({
  page,
}) => {
  await signIn(page);
  await fillSplits(page);
  await page.getByLabel("Split 2 amount (USD)").fill("9.99");
  await page
    .getByRole("button", { name: "Save transaction", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "total the transaction exactly",
  );
  await page.getByLabel("Split 2 amount (USD)").fill("10.00");
  await page
    .getByRole("button", { name: "Save transaction", exact: true })
    .click();
  await expect(
    page.getByText("Transaction saved.", { exact: true }),
  ).toBeVisible();
  expect(await balance(page)).toBe(8766);
  await openHistory(page);
  const original = (
    await pool.query(
      "SELECT id FROM transaction_splits WHERE ledger_id=$1 AND deleted_at IS NULL ORDER BY position",
      [ledgerId],
    )
  ).rows.map((r) => r.id);
  await page.getByLabel("Split 1 amount (USD)").fill("0.29");
  await page.getByLabel("Split 2 amount (USD)").fill("12.05");
  await page.getByLabel("Time (optional)", { exact: true }).fill("09:05");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(
    page.getByText("Transaction updated.", { exact: true }),
  ).toBeVisible();
  expect(await balance(page)).toBe(8766);
  await openHistory(page);
  await expect(page.getByLabel("Split 1 amount (USD)")).toHaveValue("0.29");
  await page
    .getByRole("button", { name: "Delete transaction", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Confirm delete", exact: true })
    .click();
  await expect(
    page.getByText("Transaction deleted.", { exact: true }),
  ).toBeVisible();
  expect(await balance(page)).toBe(10000);
  await page
    .getByRole("button", { name: "Undo deletion", exact: true })
    .click();
  await expect(
    page.getByText("Deletion undone.", { exact: true }),
  ).toBeVisible();
  expect(await balance(page)).toBe(8766);
  expect(
    (
      await pool.query(
        "SELECT id FROM transaction_splits WHERE ledger_id=$1 AND deleted_at IS NULL ORDER BY position",
        [ledgerId],
      )
    ).rows.map((r) => r.id),
  ).toEqual(original);
  await openHistory(page);
  await page.getByLabel("Split across categories").uncheck();
  await chooseCategory(page.getByRole("dialog"), "Category", "Food");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(
    page.getByText("Transaction updated.", { exact: true }),
  ).toBeVisible();
  expect(
    (
      await pool.query(
        "SELECT id FROM transaction_splits WHERE ledger_id=$1 AND deleted_at IS NULL",
        [ledgerId],
      )
    ).rows,
  ).toHaveLength(0);
  expect(await balance(page)).toBe(8766);
});
test("retains immutable split create/edit/delete/restore across interrupted requests and navigation", async ({
  page,
}) => {
  await signIn(page);
  const seen: Record<
    string,
    { body: string | null; key: string | undefined }[]
  > = {};
  await page.route(
    new RegExp(
      `/api/v1/ledgers/${ledgerId}/transactions(?:/[0-9a-f-]+)?(?:/restore)?$`,
    ),
    async (route) => {
      const method = route.request().method();
      if (method === "GET") return route.continue();
      const op = route.request().url().endsWith("/restore")
        ? "restore"
        : method;
      seen[op] ??= [];
      seen[op].push({
        body: route.request().postData(),
        key: route.request().headers()["idempotency-key"],
      });
      const result = await route.fetch();
      if (seen[op].length === 1) await route.abort("failed");
      else await route.fulfill({ response: result });
    },
  );
  await fillSplits(page);
  await page
    .getByRole("button", { name: "Save transaction", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Retry save", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Split 1 amount (USD)")).toBeDisabled();
  await page
    .getByRole("button", { name: "Close for now", exact: true })
    .click();
  await page
    .getByRole("link", { name: "More", exact: true })
    .filter({ visible: true })
    .click();
  await openAdd(page);
  await page.getByRole("button", { name: "Retry save", exact: true }).click();
  await expect(
    page.getByText("Transaction saved.", { exact: true }),
  ).toBeVisible();
  expect(seen.POST?.[1]).toEqual(seen.POST?.[0]);
  await openHistory(page);
  await page.getByLabel("Split 1 note").fill("Retained correction");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Retry save", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Close for now", exact: true })
    .click();
  await page
    .getByRole("link", { name: "More", exact: true })
    .filter({ visible: true })
    .click();
  await page
    .getByRole("button", { name: "Resume transaction", exact: true })
    .click();
  await page.getByRole("button", { name: "Retry save", exact: true }).click();
  await expect(
    page.getByText("Transaction updated.", { exact: true }),
  ).toBeVisible();
  expect(seen.PATCH?.[1]).toEqual(seen.PATCH?.[0]);
  await openHistory(page);
  await page
    .getByRole("button", { name: "Delete transaction", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Confirm delete", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Retry delete", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Close for now", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Resume transaction", exact: true })
    .click();
  await page.getByRole("button", { name: "Retry delete", exact: true }).click();
  await expect(
    page.getByText("Transaction deleted.", { exact: true }),
  ).toBeVisible();
  expect(seen.DELETE?.[1]).toEqual(seen.DELETE?.[0]);
  await page
    .getByRole("button", { name: "Undo deletion", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Retry deletion Undo", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("link", { name: "More", exact: true })
    .filter({ visible: true })
    .click();
  await page
    .getByRole("button", { name: "Retry deletion Undo", exact: true })
    .click();
  await expect(
    page.getByText("Deletion undone.", { exact: true }),
  ).toBeVisible();
  expect(seen.restore?.[1]).toEqual(seen.restore?.[0]);
  expect(await balance(page)).toBe(8766);
});
test("reloads stale splits, preserves archived corrections and private viewer details on narrow phones", async ({
  page,
}, info) => {
  await signIn(page);
  await fillSplits(page);
  await page
    .getByRole("button", { name: "Save transaction", exact: true })
    .click();
  await expect(
    page.getByText("Transaction saved.", { exact: true }),
  ).toBeVisible();
  await openHistory(page);
  const row = (
    await pool.query(
      "SELECT id FROM transactions WHERE ledger_id=$1 AND deleted_at IS NULL",
      [ledgerId],
    )
  ).rows[0];
  expect(
    (
      await page.request.patch(
        `/api/v1/ledgers/${ledgerId}/transactions/${row.id}`,
        { headers: headers(), data: { note: "Newer", expectedVersion: 1 } },
      )
    ).status(),
  ).toBe(200);
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await page
    .getByRole("button", { name: "Reload latest details", exact: true })
    .click();
  await expect(page.getByLabel("Note", { exact: true })).toHaveValue("Newer");
  await pool.query(
    "UPDATE categories SET archived_at=now() WHERE ledger_id=$1 AND id=$2",
    [ledgerId, expenseId],
  );
  await page.getByLabel("Split 1 note").fill("Historical correction");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(
    page.getByText("Transaction updated.", { exact: true }),
  ).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "Hide amounts", exact: true }).click();
  await openHistory(page);
  await expect(page.getByLabel("Split 1 amount (USD)")).toHaveAttribute(
    "type",
    "password",
  );
  await expect(page.getByLabel("Split 2 amount (USD)")).toHaveAttribute(
    "type",
    "password",
  );
  if (info.project.name === "mobile")
    await page.setViewportSize({ width: 320, height: 740 });
  for (const theme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: theme });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: join(
        tmpdir(),
        `ledgerline-split-${info.project.name}-${theme}.png`,
      ),
    });
  }
  await page
    .getByRole("button", { name: "Close transaction editor", exact: true })
    .click();
  await pool.query(
    "UPDATE ledger_members SET role='viewer' WHERE ledger_id=$1",
    [ledgerId],
  );
  await page.route("**/api/v1/ledgers", (route) =>
    route.fulfill({
      json: {
        items: [
          {
            id: ledgerId,
            name: "Synthetic splits ledger",
            baseCurrency: "USD",
            role: "viewer",
          },
        ],
      },
    }),
  );
  await page.reload();
  await page
    .getByRole("button", {
      name: "Open transaction: Split transaction",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Transaction details", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Split 1 amount (USD)")).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Save changes", exact: true }),
  ).toHaveCount(0);
});
