import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { expect, type Page, test } from "@playwright/test";
import { createDatabase } from "../../apps/api/src/db/client";
import { newId } from "../../packages/shared/src/index";
import { chooseCategory } from "./category-picker";
import { signIn } from "./sign-in";

const env = parseEnv(readFileSync(".env", "utf8")),
  databaseUrl = env.DATABASE_URL;
if (
  !databaseUrl ||
  !["localhost", "127.0.0.1"].includes(new URL(databaseUrl).hostname) ||
  !["/ledgerline", "/ledgerline_test"].includes(new URL(databaseUrl).pathname)
)
  throw new Error("Loan browser tests require local database.");
const { pool } = createDatabase(databaseUrl);
let ledgerId = "",
  accountId = "";
const root = () => `/api/v1/ledgers/${ledgerId}`;
test.beforeEach(async ({ page }, info) => {
  ledgerId = newId();
  accountId = newId();
  const owner = (
    await pool.query(
      "select id from users where email=$1 and deleted_at is null",
      [env.OWNER_EMAIL],
    )
  ).rows[0];
  if (!owner) throw new Error("Missing local test owner");
  await pool.query("insert into ledgers(id,name) values($1,$2)", [
    ledgerId,
    `E2E loans ledger ${info.project.name}`,
  ]);
  await pool.query(
    "insert into ledger_members(id,ledger_id,user_id,role) values($1,$2,$3,'owner')",
    [newId(), ledgerId, owner.id],
  );
  await pool.query(
    "insert into accounts(id,ledger_id,name,type,opening_balance) values($1,$2,'Checking','bank',100000)",
    [accountId, ledgerId],
  );
  await pool.query(
    "insert into categories(id,ledger_id,name,kind) values($1,$2,'Bad debt','expense')",
    [newId(), ledgerId],
  );
  await page.route("**/api/v1/ledgers", (route) =>
    route.fulfill({
      json: {
        items: [
          {
            id: ledgerId,
            name: "Synthetic loans ledger",
            timeZone: null,
            version: 1,
            baseCurrency: "USD",
            role: "owner",
          },
        ],
      },
    }),
  );
  await page.setExtraHTTPHeaders({
    "x-forwarded-for": `203.0.113.${60 + (info.workerIndex % 70)}`,
  });
  await page.emulateMedia({ colorScheme: "light" });
});
test.afterEach(async () => {
  const c = await pool.connect();
  try {
    await c.query("begin");
    for (const table of [
      "transactions",
      "accounts",
      "contacts",
      "categories",
      "ledger_members",
    ])
      await c.query(`update ${table} set deleted_at=now() where ledger_id=$1`, [
        ledgerId,
      ]);
    await c.query(
      "update ledgers set deleted_at=now() where id=$1 and name like 'E2E loans ledger %'",
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

/** A loan action: an inline button on wide screens, an item in the section's menu on phones. */
async function loanAction(page: Page, name: string) {
  const inline = page
    .getByRole("button", { name, exact: true })
    .filter({ visible: true });
  const trigger = page.getByRole("button", {
    name: "Lend and borrow actions for Sam",
  });
  await inline.or(trigger).first().waitFor();
  if ((await inline.count()) > 0) return inline.first().click();
  await trigger.click();
  await page.getByRole("menuitem", { name, exact: true }).click();
}
async function balance(page: Page) {
  const response = await page.request.get(`${root()}/accounts/${accountId}`);
  expect(response.status()).toBe(200);
  return (await response.json()).balance.amount as number;
}
const dialog = (page: Page) => page.getByRole("dialog");
const section = (page: Page) =>
  page.getByRole("region", { name: "Lent and borrowed" });

test("lend, repay and forgive keep exact balances, and an existing loan moves no money", async ({
  page,
}) => {
  await signIn(page);
  await page.goto("/clients");
  await page.getByRole("button", { name: "Add client", exact: true }).click();
  await page.getByLabel("Name", { exact: true }).fill("Sam");
  await page.getByRole("button", { name: "Save client", exact: true }).click();
  await expect(page.getByText("Client saved.", { exact: true })).toBeVisible();
  await page.locator(".client-card").filter({ hasText: "Sam" }).click();
  await expect(section(page)).toContainText("Nothing lent or borrowed yet");

  // An existing loan: they already owe 50.00, and nothing changes in the account.
  await loanAction(page, "Add an existing loan");
  await dialog(page)
    .getByLabel(/^Amount/)
    .fill("50.00");
  await dialog(page)
    .getByRole("button", { name: "Save existing loan", exact: true })
    .click();
  await expect(section(page)).toContainText("Sam owes you");
  await expect(section(page)).toContainText("$50.00");
  await expect(section(page)).toContainText("Before Ledgerline");
  expect(await balance(page)).toBe(100000);

  // Lend 20.00 from Checking.
  await loanAction(page, "Lend money to Sam");
  await dialog(page)
    .getByLabel(/^Amount/)
    .fill("20.00");
  await dialog(page).getByRole("button", { name: "Lend", exact: true }).click();
  await expect(section(page)).toContainText("$70.00");
  expect(await balance(page)).toBe(98000);

  // Repay 30.00 back into Checking; a larger repayment is refused in the form.
  await loanAction(page, "Record repayment");
  await dialog(page)
    .getByLabel(/^Amount/)
    .fill("100.00");
  await dialog(page)
    .getByRole("button", { name: "Record repayment", exact: true })
    .click();
  await expect(dialog(page).getByRole("alert")).toContainText(
    "more than what is open",
  );
  await dialog(page)
    .getByLabel(/^Amount/)
    .fill("30.00");
  await dialog(page)
    .getByRole("button", { name: "Record repayment", exact: true })
    .click();
  await expect(section(page)).toContainText("$40.00");
  expect(await balance(page)).toBe(101000);

  // Home shows what is lent out; the Accounts list does not list the client's balance account.
  await page.goto("/");
  await expect(
    page.getByRole("link", { name: "Lent out. Open Clients" }),
  ).toContainText("$40.00");
  await page.goto("/accounts");
  await expect(page.getByText("Checking").first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Sam" })).toHaveCount(0);
  await expect(page.locator("main")).not.toContainText("Sam");

  // Forgive the rest: it becomes an expense and the balance settles.
  await page.goto("/clients");
  await page.locator(".client-card").filter({ hasText: "Sam" }).click();
  await loanAction(page, "Forgive what is left");
  await chooseCategory(dialog(page), "Expense category", "Bad debt");
  await dialog(page)
    .getByRole("button", { name: "Forgive", exact: true })
    .click();
  await expect(section(page)).toContainText("Settled");
  expect(await balance(page)).toBe(101000);
});

test("borrowing makes a negative balance that you repay, on a narrow phone", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await signIn(page);
  await page.goto("/clients");
  await page.getByRole("button", { name: "Add client", exact: true }).click();
  await page.getByLabel("Name", { exact: true }).fill("Sam");
  await page.getByRole("button", { name: "Save client", exact: true }).click();
  await expect(page.getByText("Client saved.", { exact: true })).toBeVisible();
  await page.locator(".client-card").filter({ hasText: "Sam" }).click();
  await loanAction(page, "Borrow money from Sam");
  await dialog(page)
    .getByLabel(/^Amount/)
    .fill("15.00");
  await dialog(page)
    .getByRole("button", { name: "Borrow", exact: true })
    .click();
  await expect(section(page)).toContainText("You owe Sam");
  await expect(section(page)).toContainText("$15.00");
  expect(await balance(page)).toBe(101500);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  await loanAction(page, "Record repayment");
  await expect(dialog(page)).toContainText("You pay Sam back");
  await dialog(page)
    .getByLabel(/^Amount/)
    .fill("15.00");
  await dialog(page)
    .getByRole("button", { name: "Record repayment", exact: true })
    .click();
  await expect(section(page)).toContainText("Settled");
  expect(await balance(page)).toBe(100000);
});
