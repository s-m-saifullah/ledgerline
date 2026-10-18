import { expect, test } from "@playwright/test";
import { newId } from "../../packages/shared/src/index";
import {
  connectLocalDatabase,
  createOwnerLedger,
  prepareBrowser,
} from "./ledger-setup";
import { signIn } from "./sign-in";

const { env, pool } = connectLocalDatabase("Insights browser tests");
const fixtures: string[] = [];
const now = new Date();
const pad = (n: number) => String(n).padStart(2, "0");
const month = `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;
const earlier = new Date(now.getFullYear(), now.getMonth() - 1, 1);
const previous = `${earlier.getFullYear()}-${pad(earlier.getMonth() + 1)}`;
const monthName = (value: string) =>
  new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" }).format(
    new Date(Number(value.slice(0, 4)), Number(value.slice(5)) - 1, 1, 12),
  );

test.beforeEach(async ({ page }, testInfo) => {
  const ledgerId = newId();
  fixtures.push(ledgerId);
  await createOwnerLedger(
    pool,
    env,
    ledgerId,
    `E2E insights ledger ${testInfo.project.name}`,
  );
  const account = newId();
  await pool.query(
    "INSERT INTO accounts (id,ledger_id,name,type,opening_balance) VALUES ($1,$2,'Checking','bank',0)",
    [account, ledgerId],
  );
  const category = async (
    name: string,
    kind: "expense" | "income",
    parent: string | null = null,
  ) => {
    const id = newId();
    await pool.query(
      "INSERT INTO categories (id,ledger_id,name,kind,parent_id) VALUES ($1,$2,$3,$4,$5)",
      [id, ledgerId, name, kind, parent],
    );
    return id;
  };
  const food = await category("Food", "expense");
  const groceries = await category("Groceries", "expense", food);
  const fun = await category("Fun", "expense");
  const salary = await category("Salary", "income");
  const entry = (
    categoryId: string,
    payee: string,
    date: string,
    amount: number,
  ) =>
    pool.query(
      "INSERT INTO transactions (id,ledger_id,account_id,category_id,kind,date,amount,base_amount,payee,status) VALUES ($1,$2,$3,$4,$5,$6,$7,$7,$8,'cleared')",
      [
        newId(),
        ledgerId,
        account,
        categoryId,
        amount < 0 ? "expense" : "income",
        date,
        amount,
        payee,
      ],
    );
  await entry(salary, "Pay", `${month}-01`, 250000);
  await entry(food, "Lunch", `${month}-02`, -1000);
  await entry(groceries, "Market", `${month}-03`, -9000);
  await entry(fun, "Cinema", `${month}-04`, -5500);
  await entry(fun, "Last month", `${previous}-10`, -700);
  await prepareBrowser(page, testInfo, {
    ledgerId,
    name: "Synthetic insights ledger",
    forwarded: [110, 20],
  });
  await signIn(page);
});
test.afterEach(async () => {
  for (const id of fixtures) {
    for (const table of ["transactions", "accounts", "categories"])
      await pool.query(
        `UPDATE ${table} SET deleted_at=now(), updated_at=now() WHERE ledger_id=$1`,
        [id],
      );
    await pool.query(
      "UPDATE ledger_members SET deleted_at=now(), updated_at=now() WHERE ledger_id=$1",
      [id],
    );
    await pool.query(
      "UPDATE ledgers SET deleted_at=now(), updated_at=now() WHERE id=$1 AND name LIKE 'E2E insights ledger %'",
      [id],
    );
  }
  fixtures.length = 0;
});
test.afterAll(async () => {
  await pool.end();
});

test("insights shows spending by category and opens the entries", async ({
  page,
}) => {
  await page.goto("/insights");
  await expect(page.getByText(`Spent in ${monthName(month)}`)).toBeVisible();
  await expect(page.locator(".stat-card .amount")).toHaveText("$155.00");
  const food = page.getByRole("button", { name: /Food/ });
  await expect(food).toContainText("$100.00");
  await food.click();
  await expect(page.getByRole("link", { name: /Groceries/ })).toContainText(
    "$90.00",
  );
  await page.getByRole("link", { name: /Directly in Food/ }).click();
  await expect(page).toHaveURL(/\/transactions\?.*categoryId=/);
  await expect(page.getByText("Lunch")).toBeVisible();
  await expect(page.getByText("Market")).toHaveCount(0);
});

test("insights moves between months and lists the figures", async ({
  page,
}) => {
  await page.goto("/insights");
  await page.getByRole("button", { name: "Previous month" }).click();
  await expect(page.getByText(`Spent in ${monthName(previous)}`)).toBeVisible();
  await expect(page.locator(".stat-card .amount")).toHaveText("$7.00");
  await expect(page.getByRole("link", { name: /Fun/ })).toContainText("100.0%");
  await page.getByText("Show the figures").click();
  await expect(page.getByRole("table")).toContainText("-$7.00");
});
