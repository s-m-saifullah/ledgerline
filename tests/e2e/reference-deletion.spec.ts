import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseEnv } from "node:util";
import { expect, type Page, test } from "@playwright/test";
import { createDatabase } from "../../apps/api/src/db/client";
import { newId } from "../../packages/shared/src/index";
import { clickCategoryAction } from "./category-actions";
import { signIn } from "./sign-in";

const env = parseEnv(readFileSync(".env", "utf8"));
const databaseUrl = env.DATABASE_URL;
if (
  !databaseUrl ||
  !["localhost", "127.0.0.1"].includes(new URL(databaseUrl).hostname) ||
  !["/ledgerline", "/ledgerline_test"].includes(new URL(databaseUrl).pathname)
)
  throw new Error(
    "Reference deletion browser tests require the local development database.",
  );
const { pool } = createDatabase(databaseUrl);
let ledgerId = "",
  bankId = "",
  cashId = "",
  expenseId = "",
  incomeId = "";
const fixtures: string[] = [];
test.beforeEach(async ({ page }, testInfo) => {
  ledgerId = newId();
  bankId = newId();
  cashId = newId();
  expenseId = newId();
  incomeId = newId();
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
    `E2E deletion ledger ${testInfo.project.name}`,
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
            name: "Synthetic deletion ledger",
            baseCurrency: "USD",
            role: "owner",
          },
        ],
      },
    }),
  );
  await page.setExtraHTTPHeaders({
    "x-forwarded-for": `203.0.113.${180 + (testInfo.workerIndex % 160)}`,
  });
  await page.emulateMedia({ colorScheme: "light" });
});
test.afterEach(async () => {
  for (const id of fixtures) {
    await pool.query(
      "UPDATE transactions SET deleted_at=now(), updated_at=now() WHERE ledger_id=$1",
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
      "UPDATE ledgers SET deleted_at=now(), updated_at=now() WHERE id=$1 AND name LIKE 'E2E deletion ledger %'",
      [id],
    );
  }
  fixtures.length = 0;
});
test.afterAll(async () => {
  await pool.end();
});

async function openPage(page: Page, name: "Accounts" | "Categories") {
  await page
    .getByRole("link", { name: "More", exact: true })
    .filter({ visible: true })
    .click();
  await page.getByRole("link", { name: new RegExp(`^${name}`) }).click();
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
}
const headers = () => ({
  origin: "http://localhost:5173",
  "idempotency-key": newId(),
});
test("replays account deletion after interruption and close/resume, removes opening balance privately", async ({
  page,
}, info) => {
  await signIn(page);
  await openPage(page, "Accounts");
  if (info.project.name === "mobile")
    await page.setViewportSize({ width: 320, height: 740 });
  await page.getByRole("button", { name: "Hide amounts" }).click();
  const seen: { body: string | null; key: string | undefined }[] = [];
  await page.route(
    `**/api/v1/ledgers/${ledgerId}/accounts/${bankId}`,
    async (route) => {
      if (route.request().method() !== "DELETE") return route.continue();
      seen.push({
        body: route.request().postData(),
        key: route.request().headers()["idempotency-key"],
      });
      const response = await route.fetch();
      expect(response.status()).toBe(204);
      if (seen.length === 1) await route.abort("failed");
      else await route.fulfill({ response });
    },
  );
  const button = page.getByRole("button", {
    name: "Delete Checking",
    exact: true,
  });
  const bounds = await button.boundingBox();
  expect(bounds?.height).toBeGreaterThanOrEqual(44);
  await button.click();
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
        `ledgerline-delete-account-${info.project.name}-${theme}.png`,
      ),
    });
  }
  await expect(page.getByRole("dialog")).not.toContainText("100.00");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Delete account", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Retry delete" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close for now" }).click();
  await page.getByRole("button", { name: "Resume action" }).click();
  await page.getByRole("button", { name: "Retry delete" }).click();
  await expect(
    page.getByText("Account deleted.", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("article", { name: "Checking", exact: true }),
  ).toHaveCount(0);
  expect(seen[1]).toEqual(seen[0]);
  expect(
    (
      await page.request.get(`/api/v1/ledgers/${ledgerId}/accounts/${bankId}`)
    ).status(),
  ).toBe(404);
  for (const theme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: theme });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  }
  await page
    .getByRole("button", { name: "Delete Old account", exact: true })
    .click();
  const deleted = page.waitForResponse(
    (response) =>
      response.request().method() === "DELETE" &&
      /\/accounts\//.test(response.url()),
  );
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Delete account", exact: true })
    .click();
  expect((await deleted).status()).toBe(204);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByRole("article", { name: "Old account", exact: true }),
  ).toHaveCount(0);
  const rows = (
    await pool.query(
      "SELECT opening_balance FROM accounts WHERE ledger_id=$1 AND deleted_at IS NULL",
      [ledgerId],
    )
  ).rows;
  expect(rows.map((row) => Number(row.opening_balance))).toEqual([5000]);
});
test("blocks connected categories/accounts until transaction deletion, then rejects Undo atomically", async ({
  page,
}) => {
  await signIn(page);
  const response = await page.request.post(
    `/api/v1/ledgers/${ledgerId}/transactions`,
    {
      headers: headers(),
      data: {
        kind: "expense",
        accountId: bankId,
        categoryId: expenseId,
        amount: { amount: -123, currency: "USD" },
        date: "2026-10-07",
        payee: "Synthetic entry",
        status: "pending",
      },
    },
  );
  expect(response.status()).toBe(201);
  const transaction = await response.json();
  await openPage(page, "Categories");
  await clickCategoryAction(page, "delete", "Food");
  await page
    .getByRole("button", { name: "Delete category", exact: true })
    .click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "Delete the connected transactions first",
  );
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await openPage(page, "Accounts");
  await page
    .getByRole("button", { name: "Delete Checking", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Delete account", exact: true })
    .click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "Delete the connected transactions first",
  );
  await page.getByRole("button", { name: "Keep account", exact: true }).click();
  await page
    .getByRole("link", { name: "Transactions", exact: true })
    .filter({ visible: true })
    .click();
  await page
    .getByRole("button", {
      name: "Open transaction: Synthetic entry",
      exact: true,
    })
    .click();
  await page
    .getByRole("button", { name: "Delete transaction", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Confirm delete", exact: true })
    .click();
  await expect(
    page.getByText("Transaction deleted.", { exact: true }),
  ).toBeVisible();
  await openPage(page, "Categories");
  await clickCategoryAction(page, "delete", "Food");
  await page
    .getByRole("button", { name: "Delete category", exact: true })
    .click();
  await expect(
    page.getByText("Category deleted.", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Undo deletion", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("Category not found");
  await openPage(page, "Accounts");
  await page
    .getByRole("button", { name: "Delete Checking", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Delete account", exact: true })
    .click();
  await expect(
    page.getByText("Account deleted.", { exact: true }),
  ).toBeVisible();
  const row = (
    await pool.query(
      "SELECT deleted_at,version,account_id,category_id FROM transactions WHERE ledger_id=$1 AND id=$2",
      [ledgerId, transaction.id],
    )
  ).rows[0];
  expect(row.deleted_at).not.toBeNull();
  expect(row.version).toBe(2);
  expect(row.account_id).toBe(bankId);
  expect(row.category_id).toBe(expenseId);
});
test("requires child deletion and stale reload, replays category deletion and hides viewer actions", async ({
  page,
}, info) => {
  await pool.query(
    "UPDATE categories SET parent_id=$1,archived_at=now() WHERE ledger_id=$2 AND name='Old category'",
    [expenseId, ledgerId],
  );
  await signIn(page);
  await openPage(page, "Categories");
  if (info.project.name === "mobile")
    await page.setViewportSize({ width: 320, height: 740 });
  await clickCategoryAction(page, "delete", "Food");
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
        `ledgerline-delete-category-${info.project.name}-${theme}.png`,
      ),
    });
  }
  await page
    .getByRole("button", { name: "Delete category", exact: true })
    .click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "child categories first",
  );
  await page
    .getByRole("button", { name: "Reload categories", exact: true })
    .click();
  await clickCategoryAction(page, "delete", "Old category");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Delete category", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByRole("button", {
      name: /^(Delete|Actions for) Old category$/,
    }),
  ).toHaveCount(0);
  await clickCategoryAction(page, "delete", "Food");
  expect(
    (
      await page.request.patch(
        `/api/v1/ledgers/${ledgerId}/categories/${expenseId}`,
        {
          headers: headers(),
          data: { name: "Food latest", expectedVersion: 1 },
        },
      )
    ).status(),
  ).toBe(200);
  await page
    .getByRole("button", { name: "Delete category", exact: true })
    .click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "changed",
  );
  await page
    .getByRole("button", { name: "Reload categories", exact: true })
    .click();
  const seen: { body: string | null; key: string | undefined }[] = [];
  await page.route(
    `**/api/v1/ledgers/${ledgerId}/categories/${expenseId}`,
    async (route) => {
      if (route.request().method() !== "DELETE") return route.continue();
      seen.push({
        body: route.request().postData(),
        key: route.request().headers()["idempotency-key"],
      });
      const response = await route.fetch();
      expect(response.status()).toBe(204);
      if (seen.length === 1) await route.abort("failed");
      else await route.fulfill({ response });
    },
  );
  await clickCategoryAction(page, "delete", "Food latest");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Delete category", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Retry action" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close for now" }).click();
  await page.getByRole("button", { name: "Resume action" }).click();
  await page.getByRole("button", { name: "Retry action" }).click();
  await expect(
    page.getByText("Category deleted.", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByRole("button", {
      name: /^(Delete|Actions for) Food latest$/,
    }),
  ).toHaveCount(0);
  expect(seen[1]).toEqual(seen[0]);
  expect(JSON.parse(seen[0]?.body ?? "{}")).toEqual({ expectedVersion: 2 });
  for (const theme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: theme });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  }
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
            name: "Synthetic deletion ledger",
            baseCurrency: "USD",
            role: "viewer",
          },
        ],
      },
    }),
  );
  await page.reload();
  await expect(page.getByRole("button", { name: /^Delete / })).toHaveCount(0);
  expect(
    (
      await page.request.delete(
        `/api/v1/ledgers/${ledgerId}/categories/${incomeId}`,
        { headers: headers(), data: { expectedVersion: 1 } },
      )
    ).status(),
  ).toBe(403);
  await openPage(page, "Accounts");
  await expect(page.getByRole("button", { name: /^Delete / })).toHaveCount(0);
  expect(
    (
      await page.request.delete(
        `/api/v1/ledgers/${ledgerId}/accounts/${cashId}`,
        { headers: headers(), data: { expectedVersion: 1 } },
      )
    ).status(),
  ).toBe(403);
});
