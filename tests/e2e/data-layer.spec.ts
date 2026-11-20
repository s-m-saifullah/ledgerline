import { expect, type Page, test } from "@playwright/test";
import { newId } from "../../packages/shared/src/index";
import { chooseCategory } from "./category-picker";
import {
  connectLocalDatabase,
  createOwnerLedger,
  prepareBrowser,
} from "./ledger-setup";
import { signIn } from "./sign-in";

// WP-12: one cache entry per request, one refresh after every write. These watch what the person sees: the Add sheet
// opens ready, Budgets follows a save at once, and a save is not followed by a second reload.
const { env, pool } = connectLocalDatabase("Data layer browser tests");
let ledgerId = "";
const fixtures: string[] = [];

test.beforeEach(async ({ page }, testInfo) => {
  ledgerId = newId();
  fixtures.push(ledgerId);
  await createOwnerLedger(
    pool,
    env,
    ledgerId,
    `E2E data layer ledger ${testInfo.project.name}`,
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
    name: "Synthetic data layer ledger",
    forwarded: [200, 40],
  });
});
test.afterEach(async () => {
  for (const id of fixtures) {
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
      "UPDATE ledgers SET deleted_at=now(), updated_at=now() WHERE id=$1 AND name LIKE 'E2E data layer ledger %'",
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

/** Saves a 42.15 expense in Food through the Add sheet. */
async function save(page: Page) {
  await add(page).click();
  await page.getByLabel("Amount (USD)").fill("42.15");
  await chooseCategory(page, "Category", "Food");
  await page.getByRole("button", { name: "Save transaction" }).click();
  await expect(
    page.getByText("Transaction saved.", { exact: true }),
  ).toBeVisible();
}

test("the Add sheet opens from what is already loaded, with no loading state", async ({
  page,
}) => {
  const accounts = page.waitForResponse(
    (response) =>
      /\/accounts\?status=active/.test(response.url()) && response.ok(),
  );
  const categories = page.waitForResponse(
    (response) => /\/categories\?/.test(response.url()) && response.ok(),
  );
  await signIn(page);
  await expect(page.getByText("Checking").first()).toBeVisible();
  await Promise.all([accounts, categories]);
  // From here nothing answers the sheet's own requests: it must open from the cache, as a person's first Add does.
  await page.route(/\/ledgers\/[^/]+\/(accounts|categories)\?/, (route) =>
    route.abort(),
  );
  await add(page).click();
  await expect(page.getByLabel("Amount (USD)")).toBeVisible({ timeout: 1500 });
  await expect(page.getByText("Opening transaction…")).toHaveCount(0);
  await expect(
    page.getByText("Couldn't load accounts and categories."),
  ).toHaveCount(0);
});

test("Budgets follows a saved expense at once, without waiting for the next check", async ({
  page,
}, info) => {
  test.skip(
    info.project.name === "mobile",
    "Budgets has no Add transaction button on a phone",
  );
  await signIn(page);
  await page.goto("/budgets");
  await expect(
    page.getByRole("heading", { name: "Budgets", level: 1 }),
  ).toBeVisible();
  const row = page.locator(".bud-fold").getByText("Food");
  await expect(row).toBeVisible();
  await expect(page.locator(".bud-fold").getByText("$42.15")).toHaveCount(0);
  await save(page);
  // The live check asks every 15 seconds; this must not need it.
  await expect(page.locator(".bud-fold").getByText("$42.15")).toBeVisible({
    timeout: 5000,
  });
});

test("a saved expense is not followed by a second reload of the screen", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await signIn(page);
  await expect(page.getByText("Checking").first()).toBeVisible();
  let homeLoads = 0;
  page.on("response", (response) => {
    if (/\/ledgers\/[^/]+\/home\?/.test(response.url())) homeLoads += 1;
  });
  await save(page);
  await expect.poll(() => homeLoads, { timeout: 5000 }).toBeGreaterThan(0);
  // Let the save's own reload finish, then wait out a whole check (every 15 seconds): it must find nothing new to load.
  await page.waitForTimeout(1500);
  const afterSave = homeLoads;
  await page.waitForTimeout(17_000);
  expect(homeLoads).toBe(afterSave);
});
