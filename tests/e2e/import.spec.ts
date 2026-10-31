import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { newId } from "../../packages/shared/src/index";
import {
  connectLocalDatabase,
  createOwnerLedger,
  prepareBrowser,
} from "./ledger-setup";
import { signIn } from "./sign-in";

const { env, pool } = connectLocalDatabase("Import browser tests");
const fixtures: string[] = [];
let ledgerId = "";
let accountId = "";

test.beforeEach(async ({ page }, testInfo) => {
  ledgerId = newId();
  fixtures.push(ledgerId);
  await createOwnerLedger(
    pool,
    env,
    ledgerId,
    `E2E import ledger ${testInfo.project.name}`,
  );
  accountId = newId();
  await pool.query(
    "INSERT INTO accounts (id,ledger_id,name,type,opening_balance) VALUES ($1,$2,'Checking','bank',0)",
    [accountId, ledgerId],
  );
  const category = async (name: string, kind: string) => {
    const id = newId();
    await pool.query(
      "INSERT INTO categories (id,ledger_id,name,kind) VALUES ($1,$2,$3,$4)",
      [id, ledgerId, name, kind],
    );
    return id;
  };
  const food = await category("Food", "expense");
  await category("Fun", "expense");
  await category("Salary", "income");
  // The coffee is already in the ledger, so the file's copy is a possible duplicate.
  await pool.query(
    "INSERT INTO transactions (id,ledger_id,account_id,category_id,kind,date,amount,base_amount,payee,status) VALUES ($1,$2,$3,$4,'expense','2026-10-02',-450,-450,'Existing coffee','cleared')",
    [newId(), ledgerId, accountId, food],
  );
  await prepareBrowser(page, testInfo, {
    ledgerId,
    name: "Synthetic import ledger",
    forwarded: [150, 20],
  });
  await signIn(page);
});
test.afterEach(async () => {
  for (const id of fixtures) {
    for (const table of [
      "transactions",
      "import_batches",
      "accounts",
      "categories",
    ])
      await pool.query(
        `UPDATE ${table} SET deleted_at=now(), updated_at=now() WHERE ledger_id=$1`,
        [id],
      );
    await pool.query(
      "UPDATE ledger_members SET deleted_at=now(), updated_at=now() WHERE ledger_id=$1",
      [id],
    );
    await pool.query(
      "UPDATE ledgers SET deleted_at=now(), updated_at=now() WHERE id=$1 AND name LIKE 'E2E import ledger %'",
      [id],
    );
  }
  fixtures.length = 0;
});
test.afterAll(async () => {
  await pool.end();
});

const STATEMENT =
  "Date,Description,Amount,Category\n" +
  "2026-10-02,Corner shop,-4.50,Food\n" +
  "2026-10-03,Cinema,-12.00,Travel\n" +
  "2026-10-04,Pay,2500.00,Salary\n";

test("imports a statement, leaves out the duplicate, and undoes it", async ({
  page,
}) => {
  await page.goto("/import");
  await page.getByLabel("CSV file").setInputFiles({
    name: "statement.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(STATEMENT),
  });
  await expect(page.getByText("Match your columns")).toBeVisible();
  await expect(page.getByText(/We can read/)).toContainText("3 rows");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByText("Choose categories")).toBeVisible();
  await page.getByLabel(/“Travel”/).selectOption({ label: "Fun" });
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByText("Possible duplicates")).toBeVisible();
  await page.getByRole("button", { name: "Import 2 entries" }).click();
  await expect(page.getByText("Imported 2 entries")).toBeVisible();
  await page.getByRole("link", { name: "View in Transactions" }).click();
  await expect(page.getByText("Cinema").first()).toBeVisible();
  await expect(page.getByText("Pay", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Corner shop")).toHaveCount(0);
  const count = async () =>
    Number(
      (
        await pool.query(
          "select count(*) from transactions where ledger_id=$1 and deleted_at is null",
          [ledgerId],
        )
      ).rows[0].count,
    );
  expect(await count()).toBe(3);
  // Undo from the recent imports list.
  await page.goto("/import");
  await expect(page.getByText("Recent imports")).toBeVisible();
  await page.getByRole("button", { name: "Undo this import" }).click();
  await page.getByRole("button", { name: "Delete these entries" }).click();
  await expect(
    page.getByText("Removed 2 entries from statement.csv."),
  ).toBeVisible();
  expect(await count()).toBe(1);
});

test("Settings leads to Import and export, where the template sits by the file chooser", async ({
  page,
}) => {
  // Settings keeps one row for the data; Transactions has no import or export controls but Export CSV.
  await page.goto("/settings");
  await expect(
    page.getByRole("button", { name: "Download CSV template" }),
  ).toHaveCount(0);
  // The desktop sidebar lists the page too, so the link in question is the one in Settings itself.
  await page
    .getByRole("main")
    .getByRole("link", { name: "Import and export" })
    .click();
  await expect(page).toHaveURL(/\/import$/);
  await expect(page.getByLabel("CSV file")).toBeVisible();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Download CSV template" }).click(),
  ]);
  expect(download.suggestedFilename()).toBe("ledgerline-import-template.csv");
  const text = await readFile(await download.path(), "utf8");
  expect(text).toContain(
    "date,time,type,amount,category,subcategory,payee,note,status",
  );
});
