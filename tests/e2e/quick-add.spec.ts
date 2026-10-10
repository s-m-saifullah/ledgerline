import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseEnv } from "node:util";
import { expect, type Page, test } from "@playwright/test";
import { createDatabase } from "../../apps/api/src/db/client";
import { newId } from "../../packages/shared/src/index";
import { categoryOptionLabels, chooseCategory } from "./category-picker";
import { signIn } from "./sign-in";
import { setTheme } from "./theme";

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
    `E2E quick-add ledger ${testInfo.project.name}`,
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
            name: "Synthetic quick-add ledger",
            baseCurrency: "USD",
            role: "owner",
          },
        ],
      },
    }),
  );
  await page.setExtraHTTPHeaders({
    "x-forwarded-for": `203.0.113.${20 + (testInfo.workerIndex % 160)}`,
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
      "UPDATE ledgers SET deleted_at=now(), updated_at=now() WHERE id=$1 AND name LIKE 'E2E quick-add ledger %'",
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
  if (await page.getByLabel("Amount (USD)").isEnabled())
    await expect(page.getByLabel("Amount (USD)")).toBeFocused();
  else expect(await page.getByRole("dialog").locator(":focus").count()).toBe(1);
}
async function fill(page: Page, amount = "42.15", category = "Food") {
  await page.getByLabel("Amount (USD)").fill(amount);
  await chooseCategory(page, "Category", category);
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

test("records exact expenses quickly, reuses the last account and undoes with focus/privacy", async ({
  page,
}, info) => {
  await signIn(page);
  await openAdd(page);
  expect(
    await page.getByLabel("Account").locator("option").allTextContents(),
  ).not.toContain("Old account");
  expect(await categoryOptionLabels(page, "Category")).not.toContain(
    "Old category",
  );
  await page.getByLabel("Account").selectOption(cashId);
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  const start = Date.now();
  await openAdd(page);
  const saveBounds = await page
    .getByRole("button", { name: "Save transaction" })
    .boundingBox();
  expect(
    saveBounds &&
      saveBounds.y + saveBounds.height <= (page.viewportSize()?.height ?? 0),
  ).toBe(true);
  await fill(page);
  await page.getByLabel("Account").selectOption(cashId);
  await page.getByRole("button", { name: "Save transaction" }).click();
  await expect(
    page.getByText("Transaction saved.", { exact: true }),
  ).toBeVisible();
  expect(Date.now() - start).toBeLessThan(5000);
  expect(await posted(page, cashId)).toBe(785);
  const rows = await records();
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    amount: "-4215",
    base_amount: "-4215",
    // The column is an exact decimal, read back as text by the raw query.
    fx_rate: "1.0000000000",
    account_id: cashId,
    status: "cleared",
  });
  await expect(add(page)).toBeFocused();
  await page.reload();
  await openAdd(page);
  await expect(page.getByLabel("Account")).toHaveValue(cashId);
  await page.getByLabel("Amount (USD)").fill("19.29");
  // Toggle privacy through the saved preference while the modal owns keyboard focus.
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("button", { name: "Hide amounts" }).click();
  await openAdd(page);
  await page.getByLabel("Amount (USD)").fill("19.29");
  await expect(page.getByLabel("Amount (USD)")).toHaveAttribute(
    "type",
    "password",
  );
  await page.screenshot({
    path: join(tmpdir(), `ledgerline-quick-add-${info.project.name}-light.png`),
  });
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("button", { name: "Show amounts" }).click();
  await openAdd(page);
  await fill(page, "1.00");
  await page.getByRole("button", { name: "Save transaction" }).click();
  await expect(
    page.getByText("Transaction saved.", { exact: true }),
  ).toBeVisible();
  const before = await posted(page, cashId);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(
    page.getByText("Transaction saved.", { exact: true }),
  ).not.toBeVisible();
  expect(await posted(page, cashId)).toBe(before + 100);
});

test("category combobox filters in place, selects by keyboard and keeps Escape local", async ({
  page,
}) => {
  await signIn(page);
  await openAdd(page);
  await expect(
    page.getByRole("button", { name: "Search", exact: true }),
  ).toHaveCount(0);
  const box = page.getByLabel("Category", { exact: true });
  await box.click();
  const list = page.getByRole("listbox", {
    name: "Category options",
    exact: true,
  });
  await expect(list.getByRole("option")).toHaveText(["Food"]);
  const optionHeight =
    (await list.getByRole("option").first().boundingBox())?.height ?? 0;
  expect(optionHeight).toBeGreaterThanOrEqual(44);
  await box.fill("zzz");
  await expect(page.getByText("No matching active categories.")).toBeVisible();
  await box.fill("foo");
  await box.press("Enter");
  await expect(box).toHaveValue("Food");
  await expect(list).toHaveCount(0);
  // Enter must not have submitted the form.
  await expect(page.getByRole("dialog")).toBeVisible();
  await box.click();
  await box.press("Escape");
  await expect(list).toHaveCount(0);
  await expect(page.getByRole("dialog")).toBeVisible();
  await box.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("confirms interrupted create and Undo with the same immutable request", async ({
  page,
}) => {
  await signIn(page);
  await openAdd(page);
  await fill(page);
  const createRequests: { key: string | undefined; body: string | null }[] = [];
  await page.route(
    `**/api/v1/ledgers/${ledgerId}/transactions`,
    async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      createRequests.push({
        key: route.request().headers()["idempotency-key"],
        body: route.request().postData(),
      });
      const response = await route.fetch();
      if (createRequests.length === 1) await route.abort("failed");
      else await route.fulfill({ response });
    },
  );
  await page.getByRole("button", { name: "Save transaction" }).click();
  await expect(page.getByText(/couldn't confirm the save/)).toBeVisible();
  await page.getByRole("button", { name: "Close for now" }).click();
  await page
    .getByRole("link", { name: "More", exact: true })
    .filter({ visible: true })
    .click();
  await openAdd(page);
  await page.getByRole("button", { name: "Retry save" }).click();
  await expect(
    page.getByText("Transaction saved.", { exact: true }),
  ).toBeVisible();
  expect(createRequests).toHaveLength(2);
  expect(createRequests[1]).toEqual(createRequests[0]);
  expect(await records()).toHaveLength(1);
  expect(await posted(page)).toBe(5785);
  const id = (await records())[0].id;
  const undoRequests: { key: string | undefined; body: string | null }[] = [];
  await page.route(
    `**/api/v1/ledgers/${ledgerId}/transactions/${id}`,
    async (route) => {
      undoRequests.push({
        key: route.request().headers()["idempotency-key"],
        body: route.request().postData(),
      });
      const response = await route.fetch();
      if (undoRequests.length === 1) await route.abort("failed");
      else await route.fulfill({ response });
    },
  );
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.getByText(/couldn't confirm Undo/)).toBeVisible();
  await openAdd(page);
  await expect(
    page.getByRole("button", { name: "Save transaction" }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("button", { name: "Retry Undo" }).click();
  await expect(
    page.getByText("Transaction saved.", { exact: true }),
  ).not.toBeVisible();
  expect(undoRequests[1]).toEqual(undoRequests[0]);
  expect(await records()).toHaveLength(0);
  expect(await posted(page)).toBe(10000);
});

test("adds an inline category, records pending income and opens through the palette", async ({
  page,
}, info) => {
  await signIn(page);
  await page.keyboard.press("ControlOrMeta+k");
  const palette = page.getByRole("dialog", { name: "Go to", exact: true });
  await palette
    .getByRole("button", { name: "Add transaction", exact: true })
    .click();
  await expect(page.getByLabel("Amount (USD)")).toBeFocused();
  await page.getByRole("radio", { name: "Income", exact: true }).check();
  await page.getByRole("button", { name: "New category" }).click();
  await page.getByLabel("New category name").fill("Gift");
  const requests: { key: string | undefined; body: string | null }[] = [];
  await page.route(
    `**/api/v1/ledgers/${ledgerId}/categories`,
    async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      requests.push({
        key: route.request().headers()["idempotency-key"],
        body: route.request().postData(),
      });
      const response = await route.fetch();
      if (requests.length === 1) await route.abort("failed");
      else await route.fulfill({ response });
    },
  );
  await page.getByRole("button", { name: "Add category", exact: true }).click();
  await expect(page.getByText(/couldn't confirm the category/)).toBeVisible();
  await page.getByRole("button", { name: "Close for now" }).click();
  await openAdd(page);
  await page.getByRole("button", { name: "Retry category" }).click();
  await expect(page.getByLabel("Category", { exact: true })).not.toHaveValue(
    "",
  );
  expect(requests[1]).toEqual(requests[0]);
  const gift = (
    await pool.query(
      "SELECT id,kind FROM categories WHERE ledger_id=$1 AND name='Gift'",
      [ledgerId],
    )
  ).rows;
  expect(gift).toHaveLength(1);
  expect(gift[0].kind).toBe("income");
  await page.getByLabel("Amount (USD)").fill("15.29");
  await page.locator("summary").filter({ hasText: "More details" }).click();
  await page.getByLabel("Status", { exact: true }).selectOption("pending");
  await page.getByLabel("Time (optional)", { exact: true }).fill("23:59");
  await page.getByLabel("Payer", { exact: true }).fill("Synthetic giver");
  await page.getByLabel("Note", { exact: true }).fill("Synthetic pending gift");
  await page.getByRole("button", { name: "Save transaction" }).click();
  await expect(
    page.getByText("Transaction saved as pending.", { exact: true }),
  ).toBeVisible();
  expect(await posted(page)).toBe(10000);
  expect((await records())[0]).toMatchObject({
    amount: "1529",
    category_id: gift[0].id,
    time: "23:59",
    status: "pending",
  });
  await setTheme(page, "dark");
  await page.setViewportSize({ width: 320, height: 800 });
  await openAdd(page);
  await page.locator("summary").filter({ hasText: "More details" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: join(
      tmpdir(),
      `ledgerline-quick-add-${info.project.name}-dark-320.png`,
    ),
  });
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).not.toBeVisible();
});

test("payer labels and themed date/time pickers save exact local values with nested focus", async ({
  page,
}, info) => {
  if (info.project.name === "mobile")
    await page.setViewportSize({ width: 320, height: 740 });
  await signIn(page);
  await openAdd(page);
  await page.locator("summary").filter({ hasText: "More details" }).click();
  await page.getByLabel("Payee", { exact: true }).fill("Synthetic giver");
  await page.getByRole("radio", { name: "Income", exact: true }).check();
  await expect(page.getByLabel("Payer", { exact: true })).toHaveValue(
    "Synthetic giver",
  );
  await expect(page.getByLabel("Payee", { exact: true })).toHaveCount(0);
  await page.getByLabel("Amount (USD)").fill("1.25");
  await chooseCategory(page, "Category", "Salary");
  await page.getByRole("button", { name: "Choose date", exact: true }).click();
  let picker = page.getByRole("dialog", { name: "Date", exact: true });
  await picker.getByLabel("Calendar year").selectOption("2024");
  await picker.getByLabel("Calendar month").selectOption("1");
  await picker.getByRole("button", { name: "2024-02-28", exact: true }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(
    picker.getByRole("button", { name: "2024-02-29", exact: true }),
  ).toBeFocused();
  for (const theme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: theme });
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    const bounds = await picker.boundingBox();
    expect(bounds?.x).toBeGreaterThanOrEqual(0);
    expect((bounds?.x ?? 0) + (bounds?.width ?? 0)).toBeLessThanOrEqual(
      page.viewportSize()?.width ?? 0,
    );
    await picker.screenshot({ path: info.outputPath(`calendar-${theme}.png`) });
  }
  await page.keyboard.press("Enter");
  await expect(picker).toHaveCount(0);
  await expect(page.getByLabel("Date", { exact: true })).toHaveValue(
    "2024-02-29",
  );
  await expect(
    page.getByRole("button", { name: "Choose date", exact: true }),
  ).toBeFocused();
  await page.getByRole("button", { name: "Choose date", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "Date", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "2024-02-29", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("dialog", { name: "Add transaction", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Choose time (optional)", exact: true })
    .click();
  picker = page.getByRole("dialog", { name: "Time (optional)", exact: true });
  await picker.getByLabel("Hour", { exact: true }).fill("11");
  await picker.getByLabel("Minute", { exact: true }).fill("59");
  await picker.getByRole("button", { name: "PM", exact: true }).click();
  await picker.screenshot({ path: info.outputPath("time-dark.png") });
  await picker.getByRole("button", { name: "Set time", exact: true }).click();
  await expect(page.getByLabel("Time (optional)", { exact: true })).toHaveValue(
    "23:59",
  );
  await page
    .getByRole("button", { name: "Save transaction", exact: true })
    .click();
  await expect(
    page.getByText("Transaction saved.", { exact: true }),
  ).toBeVisible();
  const row = (await records())[0];
  expect(row).toMatchObject({
    amount: "125",
    time: "23:59",
    payee: "Synthetic giver",
  });
  const saved = await page.request.get(
    `/api/v1/ledgers/${ledgerId}/transactions/${row.id}`,
  );
  expect(saved.status()).toBe(200);
  expect(await saved.json()).toMatchObject({
    date: "2024-02-29",
    time: "23:59",
  });
});

test("handles missing setup, archived preferences and read-only roles", async ({
  page,
}) => {
  await pool.query("UPDATE accounts SET archived_at=now() WHERE ledger_id=$1", [
    ledgerId,
  ]);
  await signIn(page);
  await add(page).click();
  await expect(
    page.getByText("Create an active account before recording entries."),
  ).toBeVisible();
  await page
    .getByRole("link", { name: "Set up accounts", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Accounts", exact: true }),
  ).toBeVisible();
  await page.route("**/api/v1/ledgers", (route) =>
    route.fulfill({
      json: {
        items: [
          {
            id: ledgerId,
            name: "Synthetic viewer ledger",
            baseCurrency: "USD",
            role: "viewer",
          },
        ],
      },
    }),
  );
  await page.reload();
  await expect(add(page)).toBeDisabled();
});

test("date picker keeps month and year apart, and focus never overlaps the neighbour", async ({
  page,
}) => {
  await signIn(page);
  for (const width of [320, 390, 1280]) {
    await page.setViewportSize({ width, height: 800 });
    for (const theme of ["light", "dark"] as const) {
      await setTheme(page, theme);
      await openAdd(page);
      await page
        .getByRole("button", { name: "Choose date", exact: true })
        .click();
      const picker = page.getByRole("dialog", { name: "Date", exact: true });
      const month = picker.getByLabel("Calendar month");
      const year = picker.getByLabel("Calendar year");
      await month.focus();
      const monthBox = await month.boundingBox();
      const yearBox = await year.boundingBox();
      expect(
        (yearBox?.x ?? 0) - ((monthBox?.x ?? 0) + (monthBox?.width ?? 0)),
      ).toBeGreaterThanOrEqual(8);
      // The focus ring (outline plus offset) must end before the year select starts.
      const reach = await month.evaluate((el) => {
        const style = getComputedStyle(el);
        return (
          Number.parseFloat(style.outlineWidth) +
          Number.parseFloat(style.outlineOffset)
        );
      });
      expect(
        (yearBox?.x ?? 0) - ((monthBox?.x ?? 0) + (monthBox?.width ?? 0)),
      ).toBeGreaterThan(reach);
      await page.keyboard.press("Escape");
      await expect(picker).toHaveCount(0);
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog")).toHaveCount(0);
    }
  }
});
