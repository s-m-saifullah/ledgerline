import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { expect, type Page, test } from "@playwright/test";
import { createDatabase } from "../../apps/api/src/db/client";
import { newId } from "../../packages/shared/src/index";
import { signIn } from "./sign-in";

const env = parseEnv(readFileSync(".env", "utf8")),
  databaseUrl = env.DATABASE_URL;
if (
  !databaseUrl ||
  !["localhost", "127.0.0.1"].includes(new URL(databaseUrl).hostname) ||
  !["/ledgerline", "/ledgerline_test"].includes(new URL(databaseUrl).pathname)
)
  throw new Error("People browser tests require local database.");
const { pool } = createDatabase(databaseUrl);
let ledgerId = "",
  accountId = "",
  incomeId = "";
const root = () => `/api/v1/ledgers/${ledgerId}`;
const headers = () => ({
  origin: "http://localhost:5173",
  "idempotency-key": newId(),
});
test.beforeEach(async ({ page }, info) => {
  ledgerId = newId();
  accountId = newId();
  incomeId = newId();
  const owner = (
    await pool.query(
      "select id from users where email=$1 and deleted_at is null",
      [env.OWNER_EMAIL],
    )
  ).rows[0];
  if (!owner) throw new Error("Missing local test owner");
  await pool.query("insert into ledgers(id,name) values($1,$2)", [
    ledgerId,
    `E2E receipts ledger ${info.project.name}`,
  ]);
  await pool.query(
    "insert into ledger_members(id,ledger_id,user_id,role) values($1,$2,$3,'owner')",
    [newId(), ledgerId, owner.id],
  );
  await pool.query(
    "insert into accounts(id,ledger_id,name,type,opening_balance) values($1,$2,'Checking','bank',1000)",
    [accountId, ledgerId],
  );
  await pool.query(
    "insert into categories(id,ledger_id,name,kind) values($1,$2,'Services','income')",
    [incomeId, ledgerId],
  );
  await page.route("**/api/v1/ledgers", (route) =>
    route.fulfill({
      json: {
        items: [
          {
            id: ledgerId,
            name: "Synthetic receipts ledger",
            baseCurrency: "USD",
            role: "owner",
          },
        ],
      },
    }),
  );
  await page.setExtraHTTPHeaders({
    "x-forwarded-for": `203.0.113.${20 + (info.workerIndex % 30)}`,
  });
  await page.emulateMedia({ colorScheme: "light" });
});
test.afterEach(async () => {
  const c = await pool.connect();
  try {
    await c.query("begin");
    await c.query(
      "update receivable_payments set deleted_at=now(),version=version+1 where ledger_id=$1 and deleted_at is null",
      [ledgerId],
    );
    await c.query(
      "update transactions t set deleted_at=p.deleted_at,version=p.version from receivable_payments p where p.ledger_id=$1 and t.ledger_id=p.ledger_id and t.id=p.transaction_id",
      [ledgerId],
    );
    await c.query(
      "update receivables set deleted_at=now(),written_off_at=null,written_off_amount=null,write_off_reason=null where ledger_id=$1",
      [ledgerId],
    );
    for (const table of [
      "contacts",
      "accounts",
      "categories",
      "ledger_members",
    ])
      await c.query(`update ${table} set deleted_at=now() where ledger_id=$1`, [
        ledgerId,
      ]);
    await c.query(
      "update ledgers set deleted_at=now() where id=$1 and name like 'E2E receipts ledger %'",
      [ledgerId],
    );
    await c.query("commit");
  } catch (e) {
    await c.query("rollback");
    throw e;
  } finally {
    c.release();
  }
});
test.afterAll(async () => pool.end());
async function people(page: Page) {
  await page.goto("/more/people");
  await expect(
    page.getByRole("heading", { name: "People", exact: true }),
  ).toBeVisible();
}
async function balance(page: Page) {
  const r = await page.request.get(`${root()}/accounts/${accountId}`);
  expect(r.status()).toBe(200);
  return (await r.json()).balance.amount as number;
}
async function createPerson(page: Page) {
  await page.getByRole("button", { name: "Add person", exact: true }).click();
  await page.getByLabel("Name", { exact: true }).fill("Sam");
  await page.getByRole("button", { name: "Save person", exact: true }).click();
  await expect(page.getByText("Person saved.", { exact: true })).toBeVisible();
  const contact = (await (await page.request.get(`${root()}/contacts`)).json())
    .items[0];
  for (const [date, description, amount] of [
    ["2026-10-01", "App", 30000],
    ["2026-09-01", "Logo", 20000],
    ["2026-09-15", "Site", 20000],
  ] as const) {
    const r = await page.request.post(`${root()}/receivables`, {
      headers: headers(),
      data: {
        contactId: contact.id,
        description,
        serviceDate: date,
        dueDate: null,
        amount: { amount, currency: "USD" },
      },
    });
    expect(r.status()).toBe(201);
  }
  await page.reload();
  await page.locator(".person-card").filter({ hasText: "Sam" }).click();
  await expect(
    page.getByRole("heading", { name: "Sam", exact: true }),
  ).toBeVisible();
}
const confirm = async (page: Page, title: string) => {
  await expect(page.getByRole("dialog", { name: title })).toBeVisible();
  await page.getByRole("button", { name: "Confirm", exact: true }).click();
};

test("one payment from a person pays older services first and can be undone as a whole", async ({
  page,
}) => {
  await signIn(page);
  await people(page);
  await createPerson(page);
  await expect(page.locator(".people-detail")).toContainText("$700.00");
  const start = await balance(page);

  await page
    .getByRole("button", { name: "Record payment from Sam", exact: true })
    .click();
  const amount = page.getByLabel("Payment amount (USD)", { exact: true });
  await amount.fill("800");
  await expect(page.getByRole("alert")).toContainText(
    "more than the open balance",
  );
  await amount.fill("500");
  await expect(
    page.getByText("Pays 2 services in full and part of one more."),
  ).toBeVisible();
  const preview = page.locator(".receipt-preview .service-row");
  await expect(preview).toHaveCount(3);
  await expect(preview.nth(0)).toContainText("Logo");
  await expect(preview.nth(1)).toContainText("Site");
  await expect(preview.nth(2)).toContainText("App");
  await expect(preview.nth(2)).toContainText("$200.00 left");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.locator("summary").filter({ hasText: "More details" }).click();
  await page.getByLabel("Payment note", { exact: true }).fill("Bank transfer");
  await page.getByRole("button", { name: "Save payment", exact: true }).click();
  await expect(
    page.getByText("Payment applied to the person's services.", {
      exact: true,
    }),
  ).toBeVisible();
  expect(await balance(page)).toBe(start + 50000);
  await expect(page.locator(".people-detail")).toContainText("$200.00");
  await expect(page.locator(".service-row", { hasText: "Logo" })).toContainText(
    "Paid",
  );
  await expect(page.locator(".service-row", { hasText: "App" })).toContainText(
    "Partly paid",
  );

  // Member payments are changed through the receipt, never one by one.
  const logo = page.locator(".service-row", { hasText: "Logo" });
  await logo
    .getByRole("button", { name: "Show payments", exact: true })
    .click();
  await expect(logo.getByRole("button", { name: "Edit payment" })).toHaveCount(
    0,
  );
  await expect(
    logo.getByRole("button", { name: "Edit receipt" }),
  ).toBeVisible();

  // Undo the whole receipt, then undo the deletion.
  await page.getByRole("button", { name: "Undo People action" }).click();
  await confirm(page, "Delete receipt");
  await expect(page.getByText("Action completed.")).toBeVisible();
  expect(await balance(page)).toBe(start);
  await expect(page.locator(".people-detail")).toContainText("$700.00");
  await page.getByRole("button", { name: "Undo People action" }).click();
  await confirm(page, "Undo receipt deletion");
  await expect(page.getByText("Action completed.")).toBeVisible();
  expect(await balance(page)).toBe(start + 50000);
  await expect(page.locator(".people-detail")).toContainText("$200.00");
});

test("receipt details are editable, amounts are not, and privacy hides allocations", async ({
  page,
}) => {
  await signIn(page);
  await people(page);
  await createPerson(page);
  await page
    .getByRole("button", { name: "Record payment from Sam", exact: true })
    .click();
  await page.getByRole("button", { name: "Pay full balance" }).click();
  await expect(
    page.getByLabel("Payment amount (USD)", { exact: true }),
  ).toHaveValue("700.00");
  await expect(page.getByText("Pays 3 services in full.")).toBeVisible();
  await page.getByRole("button", { name: "Save payment", exact: true }).click();
  await expect(
    page.getByText("Payment applied to the person's services.", {
      exact: true,
    }),
  ).toBeVisible();
  const logo = page.locator(".service-row", { hasText: "Logo" });
  await logo
    .getByRole("button", { name: "Show payments", exact: true })
    .click();
  await logo.getByRole("button", { name: "Edit receipt" }).click();
  const dialog = page.getByRole("dialog", { name: "Edit receipt" });
  await expect(dialog).toContainText("split across 3 services");
  await expect(
    dialog.getByLabel("Payment note", { exact: true }),
  ).toBeVisible();
  await expect(dialog.getByLabel("Payment amount (USD)")).toHaveCount(0);
  await dialog
    .getByLabel("Payment note", { exact: true })
    .fill("Corrected note");
  await dialog.getByRole("button", { name: "Save receipt" }).click();
  await expect(page.getByText("Receipt saved.", { exact: true })).toBeVisible();
  const income = (
    await pool.query(
      "select note from transactions where ledger_id=$1 and kind='income' and deleted_at is null",
      [ledgerId],
    )
  ).rows;
  expect(income).toHaveLength(3);
  expect(income.every((row) => row.note === "Corrected note")).toBe(true);

  await page.getByRole("button", { name: "Hide amounts", exact: true }).click();
  await expect(page.locator(".people-detail")).not.toContainText("$");
});
