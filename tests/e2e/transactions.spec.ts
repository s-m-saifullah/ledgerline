import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { newId } from "../../packages/shared/src/index";
import {
  chooseFilter,
  chooseKind,
  closeFilters,
  openFilters,
  rows,
  searchFor,
} from "./filters";
import {
  connectLocalDatabase,
  createOwnerLedger,
  prepareBrowser,
} from "./ledger-setup";
import { leaveForAnotherPage } from "./more-nav";
import { signIn } from "./sign-in";
import { setTheme } from "./theme";

const { env, pool } = connectLocalDatabase("Transaction list browser tests");
let ledgerId = "",
  bankId = "",
  cashId = "",
  expenseId = "",
  incomeId = "",
  archivedAccountId = "",
  archivedCategoryId = "",
  coffeeId = "";
const fixtures: string[] = [];
test.beforeEach(async ({ page }, testInfo) => {
  ledgerId = newId();
  bankId = newId();
  cashId = newId();
  expenseId = newId();
  incomeId = newId();
  archivedAccountId = newId();
  archivedCategoryId = newId();
  fixtures.push(ledgerId);
  await createOwnerLedger(
    pool,
    env,
    ledgerId,
    `E2E transaction-list ledger ${testInfo.project.name}`,
  );
  for (const [id, name, amount, archived] of [
    [bankId, "Checking", 10000, false],
    [cashId, "Cash", 5000, false],
    [archivedAccountId, "Old account", 999, true],
  ] as const)
    await pool.query(
      "INSERT INTO accounts (id,ledger_id,name,type,opening_balance,archived_at) VALUES ($1,$2,$3,'bank',$4,$5)",
      [id, ledgerId, name, amount, archived ? new Date() : null],
    );
  for (const [id, name, kind, archived] of [
    [expenseId, "Food", "expense", false],
    [incomeId, "Salary", "income", false],
    [archivedCategoryId, "Old category", "expense", true],
  ] as const)
    await pool.query(
      "INSERT INTO categories (id,ledger_id,name,kind,archived_at) VALUES ($1,$2,$3,$4,$5)",
      [id, ledgerId, name, kind, archived ? new Date() : null],
    );
  coffeeId = await fixtureEntry(
    "Older coffee",
    "2026-10-06",
    -123,
    "cleared",
    "09:05",
  );
  for (let index = 0; index < 55; index++)
    await fixtureEntry(
      `Purchase ${String(index).padStart(2, "0")}`,
      "2026-10-07",
      -100,
    );
  await fixtureEntry("Pending gift", "2026-10-08", 500, "pending");
  await fixtureEntry(
    "Archive history",
    "2026-10-05",
    -200,
    "cleared",
    null,
    archivedAccountId,
    archivedCategoryId,
  );
  await prepareBrowser(page, testInfo, {
    ledgerId,
    name: "Synthetic transaction-list ledger",
    forwarded: [80, 160],
  });
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
      "UPDATE ledgers SET deleted_at=now(), updated_at=now() WHERE id=$1 AND name LIKE 'E2E transaction-list ledger %'",
      [id],
    );
  }
  fixtures.length = 0;
});
test.afterAll(async () => {
  await pool.end();
});
async function fixtureEntry(
  payee: string,
  date: string,
  amount: number,
  status = "cleared",
  time: string | null = null,
  account = bankId,
  category = amount < 0 ? expenseId : incomeId,
) {
  const id = newId();
  await pool.query(
    "INSERT INTO transactions (id,ledger_id,account_id,category_id,kind,date,time,amount,base_amount,payee,status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8,$9,$10)",
    [
      id,
      ledgerId,
      account,
      category,
      amount < 0 ? "expense" : "income",
      date,
      time,
      amount,
      payee,
      status,
    ],
  );
  return id;
}
async function openHistory(page: Page) {
  await signIn(page);
  await page
    .getByRole("link", { name: "Transactions", exact: true })
    .filter({ visible: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Transactions", exact: true }),
  ).toBeVisible();
  await expect(rows(page).first()).toBeEnabled();
}
async function search(page: Page, text: string) {
  await searchFor(page, text);
  await expect(page).toHaveURL(
    new RegExp(`text=${text.replaceAll(" ", "(?:%20|\\+)")}`),
  );
}
const coffee = (page: Page) =>
  page.getByRole("button", {
    name: "Open transaction: Older coffee",
    exact: true,
  });
const editor = (page: Page) =>
  page.getByRole("dialog", { name: "Edit transaction", exact: true });
async function balance(page: Page) {
  return (
    await (
      await page.request.get(`/api/v1/ledgers/${ledgerId}/accounts/${bankId}`)
    ).json()
  ).balance.amount;
}

test("groups days, loads stable cursor pages, retains URL filters and hides amounts", async ({
  page,
}, info) => {
  await openHistory(page);
  await expect(rows(page)).toHaveCount(50);
  await expect(page.locator(".tx-pending").first()).toBeVisible();
  await page.getByRole("button", { name: "Load more", exact: true }).click();
  await expect(rows(page)).toHaveCount(58);
  const ids = await rows(page).evaluateAll((nodes) =>
    nodes.map((node) => node.id),
  );
  expect(new Set(ids).size).toBe(58);
  // The category and the account are one hint on a phone and two columns on a desktop: the row has both.
  await expect(
    rows(page)
      .filter({ hasText: "Old category (archived)" })
      .filter({ hasText: "Old account (archived)" }),
  ).toBeVisible();
  await expect(
    rows(page).filter({ hasText: "Checking" }).filter({ hasText: "9:05 AM" }),
  ).toBeVisible();
  const filters = await openFilters(page);
  // Each choice applies at once; the account and the category are found by typing their names.
  await chooseFilter(filters, "Account", "Checking");
  await chooseFilter(filters, "Category", "Food");
  await filters.getByLabel("From date", { exact: true }).fill("2026-10-06");
  await filters.getByLabel("To date", { exact: true }).fill("2026-10-06");
  await filters.getByRole("radio", { name: "Cleared", exact: true }).click();
  await expect(page).toHaveURL(/status=cleared/);
  await expect(page).toHaveURL(new RegExp(`accountId=${bankId}`));
  await closeFilters(filters);
  await chooseKind(page, "Expenses");
  await search(page, "Older");
  await expect(rows(page)).toHaveCount(1);
  await page.reload();
  await expect(coffee(page)).toBeVisible();
  await expect(page.getByLabel("Search payer, payee or note")).toHaveValue(
    "Older",
  );
  await page.getByRole("button", { name: "Hide amounts" }).click();
  await expect(coffee(page)).not.toContainText("$1.23");
  await expect(coffee(page).getByText("Amount hidden")).toBeAttached();
  await page.setViewportSize({ width: 320, height: 800 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: join(
      tmpdir(),
      `ledgerline-history-${info.project.name}-light-320.png`,
    ),
  });
  await setTheme(page, "dark");
  await page.screenshot({
    path: join(
      tmpdir(),
      `ledgerline-history-${info.project.name}-dark-320.png`,
    ),
  });
  await page.getByRole("button", { name: "Clear filters" }).click();
  await expect(page).not.toHaveURL(/text=/);
  await expect(page.getByRole("button", { name: "Clear filters" })).toHaveCount(
    0,
  );
});

test("shows Clear filters only while a filter is applied", async ({ page }) => {
  await openHistory(page);
  const clear = page.getByRole("button", { name: "Clear filters" });
  await expect(clear).toHaveCount(0);
  await page.getByLabel("Search payer, payee or note").fill("a");
  // What is typed is not applied yet.
  await expect(clear).toHaveCount(0);
  await page.getByLabel("Search payer, payee or note").press("Enter");
  await expect(clear).toBeVisible();
});

test("reloads stale edits, corrects exact money/time/status and refreshes posted balances", async ({
  page,
}) => {
  await openHistory(page);
  await search(page, "Older");
  await coffee(page).click();
  await expect(editor(page).getByLabel("Amount (USD)")).toHaveValue("1.23");
  const response = await page.request.patch(
    `/api/v1/ledgers/${ledgerId}/transactions/${coffeeId}`,
    {
      headers: { Origin: "http://localhost:5173", "Idempotency-Key": newId() },
      data: { note: "External correction", expectedVersion: 1 },
    },
  );
  expect(response.status()).toBe(200);
  await editor(page).getByLabel("Amount (USD)").fill("4.32");
  await editor(page).getByRole("button", { name: "Save changes" }).click();
  await editor(page)
    .getByRole("button", { name: "Reload latest details" })
    .click();
  await expect(editor(page).getByLabel("Note", { exact: true })).toHaveValue(
    "External correction",
  );
  await editor(page).getByLabel("Amount (USD)").fill("4.32");
  await editor(page)
    .getByLabel("Time (optional)", { exact: true })
    .fill("21:25");
  await editor(page)
    .getByLabel("Status", { exact: true })
    .selectOption("pending");
  await editor(page).getByRole("button", { name: "Save changes" }).click();
  await expect(
    page.getByText("Transaction updated.", { exact: true }),
  ).toBeVisible();
  await expect(coffee(page)).toContainText("Pending");
  await expect(coffee(page)).toContainText("9:25 PM");
  expect(await balance(page)).toBe(4500);
  const current = (
    await pool.query(
      "SELECT amount,time,status,version FROM transactions WHERE id=$1 AND ledger_id=$2",
      [coffeeId, ledgerId],
    )
  ).rows[0];
  expect(current).toMatchObject({
    amount: "-432",
    time: "21:25",
    status: "pending",
    version: 3,
  });
});

test("replays interrupted edit/delete/restore across navigation and freezes conflicting writes", async ({
  page,
}) => {
  await openHistory(page);
  await search(page, "Older");
  await coffee(page).click();
  const seen: Record<
    string,
    { body: string | null; key: string | undefined }[]
  > = {};
  await page.route(
    new RegExp(
      `/api/v1/ledgers/${ledgerId}/transactions/${coffeeId}(?:/restore)?$`,
    ),
    async (route) => {
      const method = route.request().method();
      if (method === "GET") return route.continue();
      const operation = route.request().url().endsWith("/restore")
        ? "restore"
        : method;
      seen[operation] ??= [];
      const requests = seen[operation];
      requests.push({
        body: route.request().postData(),
        key: route.request().headers()["idempotency-key"],
      });
      const response = await route.fetch();
      if (requests.length === 1) await route.abort("failed");
      else await route.fulfill({ response });
    },
  );
  await editor(page)
    .getByLabel("Note", { exact: true })
    .fill("Immutable correction");
  await editor(page).getByRole("button", { name: "Save changes" }).click();
  await expect(
    editor(page).getByRole("button", { name: "Retry save" }),
  ).toBeVisible();
  await editor(page).getByRole("button", { name: "Close for now" }).click();
  await leaveForAnotherPage(page);
  await page
    .getByRole("button", { name: "Add transaction", exact: true })
    .filter({ visible: true })
    .click();
  await expect(
    page.getByText(/Confirm the earlier transaction action/),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Save transaction" }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Close transaction dialog" }).click();
  await page.getByRole("button", { name: "Resume transaction" }).click();
  await editor(page).getByRole("button", { name: "Retry save" }).click();
  await expect(
    page.getByText("Transaction updated.", { exact: true }),
  ).toBeVisible();
  expect(seen.PATCH?.[1]).toEqual(seen.PATCH?.[0]);
  await page
    .getByRole("link", { name: "Transactions", exact: true })
    .filter({ visible: true })
    .click();
  await search(page, "Older");
  await coffee(page).click();
  await editor(page)
    .getByRole("button", { name: "Delete transaction" })
    .click();
  await editor(page).getByRole("button", { name: "Confirm delete" }).click();
  await expect(
    editor(page).getByRole("button", { name: "Retry delete" }),
  ).toBeVisible();
  await editor(page).getByRole("button", { name: "Close for now" }).click();
  await page.getByRole("button", { name: "Resume transaction" }).click();
  await editor(page).getByRole("button", { name: "Retry delete" }).click();
  await expect(
    page.getByText("Transaction deleted.", { exact: true }),
  ).toBeVisible();
  expect(seen.DELETE?.[1]).toEqual(seen.DELETE?.[0]);
  expect(await balance(page)).toBe(4500);
  await page
    .getByRole("button", { name: "Undo deletion", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Retry deletion Undo" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Retry deletion Undo" }).click();
  await expect(
    page.getByText("Deletion undone.", { exact: true }),
  ).toBeVisible();
  expect(seen.restore?.[1]).toEqual(seen.restore?.[0]);
  await expect(coffee(page)).toBeVisible();
  expect(await balance(page)).toBe(4377);
  const restored = (
    await pool.query(
      "SELECT version,deleted_at FROM transactions WHERE id=$1 AND ledger_id=$2",
      [coffeeId, ledgerId],
    )
  ).rows[0];
  expect(restored).toMatchObject({ version: 4, deleted_at: null });
});

test("retains archived history for corrections and exposes read-only viewer details", async ({
  page,
}) => {
  await openHistory(page);
  await search(page, "Archive");
  await page
    .getByRole("button", { name: "Open transaction: Archive history" })
    .click();
  await expect(editor(page).getByLabel("Account", { exact: true })).toHaveValue(
    archivedAccountId,
  );
  await expect(
    editor(page).getByLabel("Category", { exact: true }),
  ).toHaveValue("Old category (archived)");
  await editor(page)
    .getByLabel("Note", { exact: true })
    .fill("Preserve archived links");
  await editor(page).getByRole("button", { name: "Save changes" }).click();
  await expect(
    page.getByText("Transaction updated.", { exact: true }),
  ).toBeVisible();
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
            name: "Synthetic read-only ledger",
            timeZone: null,
            version: 1,
            baseCurrency: "USD",
            role: "viewer",
          },
        ],
      },
    }),
  );
  await page.reload();
  await page
    .getByRole("button", { name: "Open transaction: Archive history" })
    .click();
  const details = page.getByRole("dialog", {
    name: "Transaction details",
    exact: true,
  });
  await expect(details.getByLabel("Amount (USD)")).toBeDisabled();
  await expect(
    details.getByRole("button", { name: "Save changes" }),
  ).toHaveCount(0);
  await expect(
    details.getByRole("button", { name: "Delete transaction" }),
  ).toHaveCount(0);
  await details.getByRole("button", { name: "Close", exact: true }).click();
  await expect(
    page
      .getByRole("button", { name: "Add transaction", exact: true })
      .filter({ visible: true }),
  ).toBeDisabled();
});
