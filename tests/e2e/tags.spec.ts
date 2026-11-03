import { expect, type Page, test } from "@playwright/test";
import { newId } from "../../packages/shared/src/index";
import { chooseCategory } from "./category-picker";
import { chooseFilter, closeFilters, openFilters, rows } from "./filters";
import {
  connectLocalDatabase,
  createOwnerLedger,
  prepareBrowser,
} from "./ledger-setup";
import { signIn } from "./sign-in";

const { env, pool } = connectLocalDatabase("Tag browser tests");
const fixtures: string[] = [];
let ledgerId = "";

test.beforeEach(async ({ page }, testInfo) => {
  ledgerId = newId();
  fixtures.push(ledgerId);
  await createOwnerLedger(
    pool,
    env,
    ledgerId,
    `E2E tag ledger ${testInfo.project.name}`,
  );
  await pool.query(
    "INSERT INTO accounts (id,ledger_id,name,type,opening_balance) VALUES ($1,$2,'Checking','bank',10000)",
    [newId(), ledgerId],
  );
  await pool.query(
    "INSERT INTO categories (id,ledger_id,name,kind) VALUES ($1,$2,'Food','expense')",
    [newId(), ledgerId],
  );
  await prepareBrowser(page, testInfo, {
    ledgerId,
    name: "Synthetic tag ledger",
    forwarded: [140, 60],
  });
  await signIn(page);
});
test.afterEach(async () => {
  for (const id of fixtures) {
    for (const table of ["transaction_tags", "tags"])
      await pool.query(`DELETE FROM ${table} WHERE ledger_id=$1`, [id]);
    for (const table of [
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
      "UPDATE ledgers SET deleted_at=now(), updated_at=now() WHERE id=$1 AND name LIKE 'E2E tag ledger %'",
      [id],
    );
  }
  fixtures.length = 0;
});
test.afterAll(async () => {
  await pool.end();
});

const addEntry = (page: Page) =>
  page
    .getByRole("button", { name: "Add transaction", exact: true })
    .filter({ visible: true });
const balance = async (page: Page) => {
  const rows = (
    await (
      await page.request.get(`/api/v1/ledgers/${ledgerId}/accounts`)
    ).json()
  ).items as { balance: { amount: number } }[];
  return rows[0]?.balance.amount;
};

test("tags an entry in Add, finds it by tag, edits the tags and keeps the balance", async ({
  page,
}) => {
  await addEntry(page).click();
  await page.getByLabel("Amount (USD)").fill("12.50");
  await chooseCategory(page, "Category", "Food");
  await expect(page.getByLabel("Tags", { exact: true })).toBeVisible();
  await page.getByLabel("Tags", { exact: true }).fill("Holiday");
  await page.getByLabel("Tags", { exact: true }).press("Enter");
  await expect(
    page.getByRole("button", { name: "Remove tag Holiday" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Save transaction" }).click();
  await expect(page.getByText("Transaction saved")).toBeVisible();
  expect(await balance(page)).toBe(10000 - 1250);

  await page.goto("/transactions");
  await expect(page.locator(".tag-chip", { hasText: "Holiday" })).toBeVisible();
  const filters = await openFilters(page);
  await chooseFilter(filters, "Tag", "Holiday");
  await closeFilters(filters);
  await expect(page).toHaveURL(/tagId=/);
  await expect(rows(page)).toHaveCount(1);

  // Edit: remove the tag again.
  await rows(page).first().click();
  await page.getByRole("button", { name: "Remove tag Holiday" }).click();
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.locator(".tag-chip")).toHaveCount(0);
  expect(await balance(page)).toBe(10000 - 1250);
});

const addTag = (page: Page) =>
  page.getByRole("button", { name: "Add tag", exact: true }).filter({
    visible: true,
  });
const tagRow = (page: Page, name: string) =>
  page.getByRole("button", { name: new RegExp(`^${name} \\d+ entr`) });

test("the Tags page adds, renames, archives and deletes tags, each from the tag's sheet", async ({
  page,
}) => {
  await page.goto("/tags");
  await expect(page.getByText("No tags yet.")).toBeVisible();
  await addTag(page).click();
  await page
    .getByRole("dialog", { name: "Add tag" })
    .getByLabel("Name")
    .fill("Trip");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Added the tag Trip.")).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  await tagRow(page, "Trip").click();
  await page.getByRole("button", { name: "Rename", exact: true }).click();
  await page.getByLabel("Name", { exact: true }).fill("Holiday");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Renamed to Holiday.")).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  await tagRow(page, "Holiday").click();
  await page.getByRole("button", { name: "Archive", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.locator(".tg-fold > summary").click();
  await expect(page.getByText("1 archived")).toBeVisible();
  await tagRow(page, "Holiday").click();
  await page.getByRole("button", { name: "Unarchive", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  await tagRow(page, "Holiday").click();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await page.getByRole("button", { name: "Delete tag" }).click();
  await expect(page.getByText("Deleted the tag Holiday.")).toBeVisible();
  await expect(page.getByText("No tags yet.")).toBeVisible();
});
