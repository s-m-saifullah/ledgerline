import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { expect, type Page, test } from "@playwright/test";
import { createDatabase } from "../../apps/api/src/db/client";
import {
  type Category,
  newId,
  type Transaction,
} from "../../packages/shared/src/index";
import { clickCategoryAction, expectCategoryAction } from "./category-actions";
import { chooseCategory } from "./category-picker";
import { signIn } from "./sign-in";
import { setTheme } from "./theme";

const env = parseEnv(readFileSync(".env", "utf8")),
  url = env.DATABASE_URL;
if (
  !url ||
  !["localhost", "127.0.0.1"].includes(new URL(url).hostname) ||
  !["/ledgerline", "/ledgerline_test"].includes(new URL(url).pathname)
)
  throw new Error(
    "Merge browser tests require the local development database.",
  );
const { pool } = createDatabase(url);
let ledgerId = "",
  accountId = "",
  role = "owner";
const path = (suffix: string) => `/api/v1/ledgers/${ledgerId}${suffix}`;
const money = (amount: number) => ({ amount, currency: "USD" });
test.beforeEach(async ({ page }, info) => {
  ledgerId = newId();
  role = "owner";
  const owner = (
    await pool.query(
      "SELECT id FROM users WHERE email=$1 AND deleted_at IS NULL",
      [env.OWNER_EMAIL],
    )
  ).rows[0];
  if (!owner) throw new Error("Missing synthetic fixture owner");
  await pool.query(
    "INSERT INTO ledgers(id,name) VALUES($1,'E2E category merge ledger')",
    [ledgerId],
  );
  await pool.query(
    "INSERT INTO ledger_members(id,ledger_id,user_id,role) VALUES($1,$2,$3,'owner')",
    [newId(), ledgerId, owner.id],
  );
  await page.route("**/api/v1/ledgers", (route) =>
    route.fulfill({
      json: {
        items: [
          {
            id: ledgerId,
            name: "Synthetic merge ledger",
            role,
            baseCurrency: "USD",
          },
        ],
      },
    }),
  );
  await page.setExtraHTTPHeaders({
    "x-forwarded-for": `198.51.100.${90 + (info.workerIndex % 120)}`,
  });
  await signIn(page);
  const account = await saved<{ id: string }>(page, "/accounts", {
    name: "Synthetic account",
    type: "cash",
    openingBalance: money(10000),
  });
  accountId = account.id;
});
test.afterEach(async () => {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    for (const table of [
      "receivable_events",
      "receivable_payments",
      "transaction_splits",
      "transactions",
      "receivables",
      "contacts",
      "categories",
      "accounts",
      "write_receipts",
      "ledger_members",
    ])
      await c.query(`DELETE FROM ${table} WHERE ledger_id=$1`, [ledgerId]);
    await c.query(
      "DELETE FROM ledgers WHERE id=$1 AND name='E2E category merge ledger'",
      [ledgerId],
    );
    await c.query("COMMIT");
  } catch (error) {
    await c.query("ROLLBACK");
    throw error;
  } finally {
    c.release();
  }
});
test.afterAll(async () => pool.end());
async function saved<T>(
  page: Page,
  suffix: string,
  data: unknown,
  method = "POST",
): Promise<T> {
  const response = await page.request.fetch(path(suffix), {
    method,
    headers: { Origin: "http://localhost:5173", "Idempotency-Key": newId() },
    data,
  });
  expect(response.ok(), await response.text()).toBe(true);
  return response.status() === 204 ? (undefined as T) : response.json();
}
const category = (
  page: Page,
  name: string,
  kind = "expense",
  parentId: string | null = null,
) => saved<Category>(page, "/categories", { name, kind, parentId });
const entry = (page: Page, categoryId: string) =>
  saved<Transaction>(page, "/transactions", {
    accountId,
    categoryId,
    kind: "expense",
    amount: money(-125),
    status: "cleared",
    date: "2026-10-08",
    note: "Synthetic expense",
  });
async function categories(page: Page) {
  await page.goto("/more/categories");
  await expect(
    page.getByRole("heading", { name: "Categories", exact: true }),
  ).toBeVisible();
}
async function begin(page: Page, source: Category, destination: Category) {
  await clickCategoryAction(page, "merge", source.name);
  const dialog = page.getByRole("dialog", { name: "Merge categories" });
  await chooseCategory(dialog, "Destination category", destination.name);
  await expect(
    dialog.getByRole("region", { name: "Merge preview" }),
  ).toBeVisible();
  return dialog;
}
test("merges ordinary and split references and children, refreshes choices, and preserves exact balances", async ({
  page,
}) => {
  const source = await category(page, "Source"),
    destination = await category(page, "Destination"),
    child = await category(page, "Child", "expense", source.id);
  const ordinary = await entry(page, source.id);
  const split = await saved<Transaction>(page, "/transactions", {
    accountId,
    categoryId: null,
    kind: "expense",
    status: "cleared",
    amount: money(-500),
    date: "2026-10-08",
    splits: [
      { categoryId: source.id, amount: money(-200) },
      { categoryId: child.id, amount: money(-300) },
    ],
  });
  await categories(page);
  const dialog = await begin(page, source, destination);
  await expect(dialog).toContainText("1 cleared and 0 pending");
  await expect(dialog).toContainText("1 split lines across 1 entries");
  await expect(dialog).toContainText("1 child categories to move");
  await dialog.getByRole("button", { name: "Confirm merge" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(
    page.getByText("Categories merged. The source is archived."),
  ).toBeVisible();
  // Focus returns to where the merge started: the page on wide screens, where the archived source's
  // merge button is gone, or the source row's menu button on phones.
  if ((page.viewportSize()?.width ?? 1280) <= 700)
    await expect(
      page.getByRole("button", {
        name: `Actions for ${source.name}`,
        exact: true,
      }),
    ).toBeFocused();
  else await expect(page.getByRole("main")).toBeFocused();
  const changed = await (
    await page.request.get(path(`/transactions/${ordinary.id}`))
  ).json();
  expect(changed).toMatchObject({
    categoryId: destination.id,
    version: ordinary.version + 1,
  });
  const currentSplit = await (
    await page.request.get(path(`/transactions/${split.id}`))
  ).json();
  expect(
    currentSplit.splits.map((line: { categoryId: string }) => line.categoryId),
  ).toEqual([destination.id, child.id]);
  for (const line of currentSplit.splits)
    expect([line.version, line.updatedAt]).toEqual([
      currentSplit.version,
      currentSplit.updatedAt,
    ]);
  const all = (await (await page.request.get(path("/categories"))).json())
    .items;
  expect(all.find((row: Category) => row.id === child.id).parentId).toBe(
    destination.id,
  );
  expect(
    (await (await page.request.get(path(`/accounts/${accountId}`))).json())
      .balance.amount,
  ).toBe(9375);
});
test("requires fresh confirmation for stale references and blocks archived child-name collisions", async ({
  page,
}) => {
  const source = await category(page, "Source"),
    destination = await category(page, "Destination");
  await categories(page);
  let dialog = await begin(page, source, destination);
  await entry(page, source.id);
  await dialog.getByRole("button", { name: "Confirm merge" }).click();
  await expect(dialog.getByRole("alert")).toContainText("preview changed");
  await expect(
    dialog.getByRole("button", { name: "Confirm merge" }),
  ).toBeDisabled();
  await dialog.getByRole("button", { name: "Reload preview" }).click();
  await expect(dialog).toContainText("1 cleared and 0 pending");
  await dialog.getByRole("button", { name: "Confirm merge" }).click();
  await expect(dialog).toHaveCount(0);
  const root = await category(page, "Second source"),
    target = await category(page, "Second destination");
  await category(page, "Collision", "expense", root.id);
  const conflicting = await category(page, "COLLISION", "expense", target.id);
  await saved(page, `/categories/${conflicting.id}/archive`, {
    expectedVersion: conflicting.version,
  });
  await page.reload();
  dialog = await begin(page, root, target);
  await expect(dialog.getByRole("alert")).toContainText(
    "Resolve the child name",
  );
  await expect(
    dialog.getByRole("button", { name: "Confirm merge" }),
  ).toBeDisabled();
});
test("replays an interrupted committed merge across navigation and blocks competing workspaces", async ({
  page,
}) => {
  const source = await category(page, "Source"),
    destination = await category(page, "Destination");
  await entry(page, source.id);
  await categories(page);
  const requests: { body: string | null; key: string | undefined }[] = [];
  await page.route(`**/categories/${source.id}/merge`, async (route) => {
    requests.push({
      body: route.request().postData(),
      key: route.request().headers()["idempotency-key"],
    });
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    if (requests.length === 1) await route.abort("failed");
    else await route.fulfill({ response });
  });
  const dialog = await begin(page, source, destination);
  await dialog.getByRole("button", { name: "Confirm merge" }).click();
  await expect(dialog.getByRole("alert")).toContainText(
    "Retry the same action",
  );
  await dialog.getByRole("button", { name: "Close for now" }).click();
  await expectCategoryAction(page, "edit", "Destination", "disabled");
  await page
    .getByRole("link", { name: "Transactions", exact: true })
    .filter({ visible: true })
    .click();
  await page
    .getByRole("button", { name: "Add transaction", exact: true })
    .filter({ visible: true })
    .click();
  const quick = page.getByRole("dialog", { name: "Add transaction" });
  await expect(quick.getByRole("button", { name: /Save/ })).toBeDisabled();
  await quick.getByRole("button", { name: "Close transaction dialog" }).click();
  await page
    .getByRole("link", { name: "More", exact: true })
    .filter({ visible: true })
    .click();
  await page.getByRole("link", { name: /^People/ }).click();
  await expect(
    page.getByRole("button", { name: "Add person", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Resume category merge" }).click();
  await expect(
    dialog.getByRole("button", { name: "Retry same merge" }),
  ).toBeFocused();
  await dialog.getByRole("button", { name: "Retry same merge" }).click();
  await expect(dialog).toHaveCount(0);
  expect(requests).toHaveLength(2);
  expect(requests[1]).toEqual(requests[0]);
  expect(
    Number(
      (
        await pool.query(
          "SELECT count(*) FROM write_receipts WHERE ledger_id=$1 AND key=$2",
          [ledgerId, requests[0]?.key],
        )
      ).rows[0].count,
    ),
  ).toBe(1);
});
test("corrects written-off linked income privately, fits 320px light/dark layouts, and respects viewers", async ({
  page,
}, info) => {
  const source = await category(page, "Original income", "income"),
    destination = await category(page, "Consolidated income", "income");
  const person = await saved<{ id: string }>(page, "/contacts", {
    name: "Synthetic person",
  });
  const service = await saved<{ id: string; version: number }>(
    page,
    "/receivables",
    {
      contactId: person.id,
      description: "Synthetic service",
      amount: money(1000),
      serviceDate: "2026-10-08",
    },
  );
  const payment = await saved<{ receivable: { id: string; version: number } }>(
    page,
    `/receivables/${service.id}/payments`,
    {
      accountId,
      categoryId: source.id,
      amount: money(400),
      date: "2026-10-08",
      expectedReceivableVersion: service.version,
    },
  );
  await saved(page, `/receivables/${service.id}/write-off`, {
    expectedVersion: payment.receivable.version,
  });
  await categories(page);
  await page.getByRole("button", { name: "Income", exact: true }).click();
  await page.getByRole("button", { name: "Hide amounts", exact: true }).click();
  await page.setViewportSize({ width: 320, height: 740 });
  for (const theme of ["light", "dark"] as const) {
    await setTheme(page, theme);
    const dialog = await begin(page, source, destination);
    await expect(dialog).toContainText("1 linked payments across 1 services");
    await expect(dialog).not.toContainText("$4.00");
    const bounds = await dialog.boundingBox();
    expect(bounds?.x).toBeGreaterThanOrEqual(0);
    expect((bounds?.x ?? 0) + (bounds?.width ?? 0)).toBeLessThanOrEqual(320);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(320);
    await dialog.screenshot({
      path: info.outputPath(`merge-${theme}-320.png`),
    });
    await dialog.getByRole("button", { name: "Cancel" }).click();
  }
  const dialog = await begin(page, source, destination);
  await dialog.getByRole("button", { name: "Confirm merge" }).click();
  await expect(dialog).toHaveCount(0);
  const current = await (
    await page.request.get(path(`/receivables/${service.id}`))
  ).json();
  expect(current).toMatchObject({
    status: "writtenOff",
    received: money(400),
    writtenOffAmount: money(600),
    outstanding: money(0),
  });
  role = "viewer";
  await pool.query(
    "UPDATE ledger_members SET role='viewer' WHERE ledger_id=$1",
    [ledgerId],
  );
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Categories", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /^Merge / })).toHaveCount(0);
});
