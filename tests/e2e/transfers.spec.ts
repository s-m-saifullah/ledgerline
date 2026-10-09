import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseEnv } from "node:util";
import { expect, type Page, test } from "@playwright/test";
import { createDatabase } from "../../apps/api/src/db/client";
import { newId } from "../../packages/shared/src/index";
import { signIn } from "./sign-in";

const env = parseEnv(readFileSync(".env", "utf8"));
const databaseUrl = env.DATABASE_URL;
if (
  !databaseUrl ||
  !["localhost", "127.0.0.1"].includes(new URL(databaseUrl).hostname) ||
  !["/ledgerline", "/ledgerline_test"].includes(new URL(databaseUrl).pathname)
)
  throw new Error(
    "Quick-add browser tests require the local development database.",
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
    `E2E transfers ledger ${testInfo.project.name}`,
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
            name: "Synthetic transfers ledger",
            baseCurrency: "USD",
            role: "owner",
          },
        ],
      },
    }),
  );
  await page.setExtraHTTPHeaders({
    "x-forwarded-for": `203.0.113.${120 + (testInfo.workerIndex % 160)}`,
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
      "UPDATE ledgers SET deleted_at=now(), updated_at=now() WHERE id=$1 AND name LIKE 'E2E transfers ledger %'",
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
async function openAdd(page: Page) {
  await add(page).click();
  await expect(page.getByLabel("Amount (USD)")).toBeVisible();
  await page.getByRole("radio", { name: "Transfer", exact: true }).check();
  const note = page.getByLabel("Note", { exact: true });
  await expect(note).toBeVisible();
  const border = await note.evaluate((field) => {
    const style = getComputedStyle(field);
    return { style: style.borderTopStyle, width: style.borderTopWidth };
  });
  expect(border).toEqual({ style: "solid", width: "1px" });
  if (await page.getByLabel("Amount (USD)").isEnabled())
    await expect(page.getByLabel("Amount (USD)")).toBeFocused();
  else expect(await page.getByRole("dialog").locator(":focus").count()).toBe(1);
}
async function posted(page: Page, account = bankId) {
  const response = await page.request.get(
    `/api/v1/ledgers/${ledgerId}/accounts/${account}`,
  );
  expect(response.status()).toBe(200);
  return (await response.json()).balance.amount as number;
}
async function records() {
  return (
    await pool.query(
      "SELECT * FROM transactions WHERE ledger_id=$1 AND deleted_at IS NULL ORDER BY id",
      [ledgerId],
    )
  ).rows;
}

const transferEditor = (page: Page) =>
  page.getByRole("dialog", { name: "Edit transfer", exact: true });
async function history(page: Page) {
  await page
    .getByRole("link", { name: "Transactions", exact: true })
    .filter({ visible: true })
    .click();
  await expect(page.locator(".transaction-row")).toHaveCount(2);
  await page
    .getByRole("button", {
      name: "Open transaction: Transfer from Checking",
      exact: true,
    })
    .click();
  await expect(transferEditor(page)).toBeVisible();
}
async function saveTransfer(page: Page, amount = "12.34") {
  await openAdd(page);
  await page.getByLabel("Amount (USD)").fill(amount);
  await page.getByLabel("From account").selectOption(bankId);
  await page.getByLabel("To account").selectOption(cashId);
  await page.getByLabel("Time (optional)", { exact: true }).fill("09:05");
  await page.getByRole("button", { name: "Save transfer" }).click();
  await expect(
    page.getByText("Transfer saved.", { exact: true }),
  ).toBeVisible();
}
test("moves exact cents, edits both legs, deletes and restores with historical identity", async ({
  page,
}) => {
  await signIn(page);
  await saveTransfer(page);
  expect(await posted(page)).toBe(8766);
  expect(await posted(page, cashId)).toBe(6234);
  let rows = await records();
  expect(rows).toHaveLength(2);
  expect(
    rows.every(
      (row) =>
        row.kind === "transfer" &&
        row.category_id === null &&
        row.time === "09:05" &&
        row.status === "cleared",
    ),
  ).toBe(true);
  const ids = rows.map((row) => row.id).sort();
  await history(page);
  await transferEditor(page).getByLabel("Amount (USD)").fill("0.29");
  await transferEditor(page)
    .getByLabel("Time (optional)", { exact: true })
    .fill("");
  await transferEditor(page)
    .getByRole("button", { name: "Save changes" })
    .click();
  await expect(
    page.getByText("Transfer updated.", { exact: true }),
  ).toBeVisible();
  expect(await posted(page)).toBe(9971);
  expect(await posted(page, cashId)).toBe(5029);
  await page
    .getByRole("button", {
      name: "Open transaction: Transfer to Cash",
      exact: true,
    })
    .click();
  await transferEditor(page)
    .getByRole("button", { name: "Delete transfer" })
    .click();
  await transferEditor(page)
    .getByRole("button", { name: "Confirm delete" })
    .click();
  await expect(
    page.getByText("Transfer deleted.", { exact: true }),
  ).toBeVisible();
  expect(await posted(page)).toBe(10000);
  expect(await posted(page, cashId)).toBe(5000);
  await page
    .getByRole("button", { name: "Undo deletion", exact: true })
    .click();
  await expect(
    page.getByText("Deletion undone.", { exact: true }),
  ).toBeVisible();
  rows = await records();
  expect(rows.map((row) => row.id).sort()).toEqual(ids);
  expect(rows.every((row) => row.version === 4 && row.time === null)).toBe(
    true,
  );
  expect(await posted(page)).toBe(9971);
  expect(await posted(page, cashId)).toBe(5029);
  await page.locator("summary").filter({ hasText: "Filter entries" }).click();
  await page.getByLabel("Entry type", { exact: true }).selectOption("expense");
  await page.getByRole("button", { name: "Apply filters" }).click();
  await expect(page.locator(".transaction-row")).toHaveCount(0);
  await page.getByLabel("Entry type", { exact: true }).selectOption("transfer");
  await page.getByRole("button", { name: "Apply filters" }).click();
  await expect(page.locator(".transaction-row")).toHaveCount(2);
  await page.reload();
  await expect(page.locator(".transaction-row")).toHaveCount(2);
});
test("replays interrupted create and Add Undo after close/resume and navigation", async ({
  page,
}) => {
  await signIn(page);
  const seen: Record<
    string,
    { body: string | null; key: string | undefined }[]
  > = {};
  await page.route(
    new RegExp(`/api/v1/ledgers/${ledgerId}/transfers(?:/[0-9a-f-]+)?$`),
    async (route) => {
      const method = route.request().method();
      if (method === "GET") return route.continue();
      seen[method] ??= [];
      const requests = seen[method];
      requests.push({
        body: route.request().postData(),
        key: route.request().headers()["idempotency-key"],
      });
      const response = await route.fetch();
      if (requests.length === 1) await route.abort("failed");
      else await route.fulfill({ response });
    },
  );
  await openAdd(page);
  await page.getByLabel("Amount (USD)").fill("1.23");
  await page.getByRole("button", { name: "Save transfer" }).click();
  await expect(page.getByRole("button", { name: "Retry save" })).toBeVisible();
  await expect(
    page.getByRole("radio", { name: "Income / expense" }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Close for now" }).click();
  await page
    .getByRole("link", { name: "More", exact: true })
    .filter({ visible: true })
    .click();
  await openAdd(page);
  await page.getByRole("button", { name: "Retry save" }).click();
  await expect(
    page.getByText("Transfer saved.", { exact: true }),
  ).toBeVisible();
  expect(seen.POST?.[1]).toEqual(seen.POST?.[0]);
  expect(await records()).toHaveLength(2);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.getByRole("button", { name: "Retry Undo" })).toBeVisible();
  await openAdd(page);
  await expect(
    page.getByRole("button", { name: "Save transfer" }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Close transaction dialog" }).click();
  await page.getByRole("button", { name: "Retry Undo" }).click();
  await expect(
    page.getByText("Transfer saved.", { exact: true }),
  ).not.toBeVisible();
  expect(seen.DELETE?.[1]).toEqual(seen.DELETE?.[0]);
  expect(await posted(page)).toBe(10000);
  expect(await posted(page, cashId)).toBe(5000);
});
test("retains uncertain edits/deletes/restore across navigation and freezes conflicting writes", async ({
  page,
}) => {
  await signIn(page);
  await saveTransfer(page, "1.23");
  await history(page);
  const seen: Record<
    string,
    { body: string | null; key: string | undefined }[]
  > = {};
  await page.route(
    new RegExp(
      `/api/v1/ledgers/${ledgerId}/transfers/[0-9a-f-]+(?:/restore)?$`,
    ),
    async (route) => {
      const method = route.request().method();
      if (method === "GET") return route.continue();
      const op = route.request().url().endsWith("/restore")
        ? "restore"
        : method;
      seen[op] ??= [];
      const requests = seen[op];
      requests.push({
        body: route.request().postData(),
        key: route.request().headers()["idempotency-key"],
      });
      const response = await route.fetch();
      if (requests.length === 1) await route.abort("failed");
      else await route.fulfill({ response });
    },
  );
  await transferEditor(page)
    .getByLabel("Note", { exact: true })
    .fill("Immutable correction");
  await transferEditor(page)
    .getByRole("button", { name: "Save changes" })
    .click();
  await expect(
    transferEditor(page).getByRole("button", { name: "Retry save" }),
  ).toBeVisible();
  await transferEditor(page)
    .getByRole("button", { name: "Close for now" })
    .click();
  await page
    .getByRole("link", { name: "More", exact: true })
    .filter({ visible: true })
    .click();
  await add(page).click();
  await expect(
    page.getByText(/Confirm the earlier transaction action/),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close transaction dialog" }).click();
  await page.getByRole("button", { name: "Resume transaction" }).click();
  await transferEditor(page)
    .getByRole("button", { name: "Retry save" })
    .click();
  await expect(
    page.getByText("Transfer updated.", { exact: true }),
  ).toBeVisible();
  expect(seen.PATCH?.[1]).toEqual(seen.PATCH?.[0]);
  await history(page);
  await expect(
    transferEditor(page).getByLabel("Note", { exact: true }),
  ).toHaveValue("Immutable correction");
  await transferEditor(page)
    .getByRole("button", { name: "Delete transfer" })
    .click();
  await transferEditor(page)
    .getByRole("button", { name: "Confirm delete" })
    .click();
  await expect(
    transferEditor(page).getByRole("button", { name: "Retry delete" }),
  ).toBeVisible();
  await transferEditor(page)
    .getByRole("button", { name: "Close for now" })
    .click();
  await page.getByRole("button", { name: "Resume transaction" }).click();
  await transferEditor(page)
    .getByRole("button", { name: "Retry delete" })
    .click();
  await expect(
    page.getByText("Transfer deleted.", { exact: true }),
  ).toBeVisible();
  expect(seen.DELETE?.[1]).toEqual(seen.DELETE?.[0]);
  await page
    .getByRole("button", { name: "Undo deletion", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Retry deletion Undo" }),
  ).toBeVisible();
  await page
    .getByRole("link", { name: "More", exact: true })
    .filter({ visible: true })
    .click();
  await page.getByRole("button", { name: "Retry deletion Undo" }).click();
  await expect(
    page.getByText("Deletion undone.", { exact: true }),
  ).toBeVisible();
  expect(seen.restore?.[1]).toEqual(seen.restore?.[0]);
  expect(await posted(page)).toBe(9877);
  expect(await posted(page, cashId)).toBe(5123);
  expect((await records()).every((row) => row.version === 4)).toBe(true);
});
test("requires explicit stale reload, preserves archived corrections, and provides private viewer details at 320 px", async ({
  page,
}, info) => {
  await signIn(page);
  await saveTransfer(page, "1.23");
  await history(page);
  const rows = await records();
  const transferId = rows[0].transfer_id;
  const changed = await page.request.patch(
    `/api/v1/ledgers/${ledgerId}/transfers/${transferId}`,
    {
      headers: { origin: "http://localhost:5173", "idempotency-key": newId() },
      data: {
        fromAccountId: bankId,
        toAccountId: cashId,
        amount: { amount: 29, currency: "USD" },
        date: "2026-10-07",
        time: null,
        note: "Newer",
        expectedVersion: 1,
      },
    },
  );
  expect(changed.status()).toBe(200);
  await transferEditor(page)
    .getByRole("button", { name: "Save changes" })
    .click();
  await transferEditor(page)
    .getByRole("button", { name: "Reload latest details" })
    .click();
  await expect(transferEditor(page).getByLabel("Amount (USD)")).toHaveValue(
    "0.29",
  );
  await transferEditor(page)
    .getByLabel("Note", { exact: true })
    .fill("Corrected");
  await transferEditor(page)
    .getByRole("button", { name: "Save changes" })
    .click();
  await expect(
    page.getByText("Transfer updated.", { exact: true }),
  ).toBeVisible();
  await pool.query(
    "UPDATE accounts SET archived_at=now() WHERE ledger_id=$1 AND id=$2",
    [ledgerId, bankId],
  );
  await page.reload();
  await page
    .getByRole("button", {
      name: "Open transaction: Transfer from Checking (archived)",
      exact: true,
    })
    .click();
  await expect(transferEditor(page).getByLabel("From account")).toHaveValue(
    bankId,
  );
  await transferEditor(page)
    .getByLabel("Note", { exact: true })
    .fill("Historical correction");
  await transferEditor(page)
    .getByRole("button", { name: "Save changes" })
    .click();
  await expect(
    page.getByText("Transfer updated.", { exact: true }),
  ).toBeVisible();
  expect(await posted(page)).toBe(9971);
  await page.getByRole("button", { name: "Hide amounts" }).click();
  await expect(page.locator(".transaction-row").first()).not.toContainText(
    "0.29",
  );
  await page
    .getByRole("button", {
      name: "Open transaction: Transfer to Cash",
      exact: true,
    })
    .click();
  await expect(transferEditor(page).getByLabel("Amount (USD)")).toHaveAttribute(
    "type",
    "password",
  );
  if (info.project.name === "mobile")
    await page.setViewportSize({ width: 320, height: 740 });
  for (const theme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: theme });
    await expect(page.locator("body")).toHaveJSProperty(
      "scrollWidth",
      page.viewportSize()?.width,
    );
    await page.screenshot({
      path: join(
        tmpdir(),
        `ledgerline-transfer-${info.project.name}-${theme}.png`,
      ),
    });
  }
  await page.getByRole("button", { name: "Close transfer editor" }).click();
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
            name: "Synthetic transfers ledger",
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
      name: "Open transaction: Transfer to Cash",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Transfer details", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("From account")).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Delete transfer" }),
  ).toHaveCount(0);
});
