import { expect, type Locator, type Page, test } from "@playwright/test";
import { newId } from "../../packages/shared/src/index";
import {
  connectLocalDatabase,
  createOwnerLedger,
  prepareBrowser,
} from "./ledger-setup";
import { signIn } from "./sign-in";

// The Add and Edit entry sheet in a real browser (ADR 0047, PR 5b): jsdom cannot run container queries, so
// the sheet against the drawer, the pinned Save, the date and time columns and the delete question are
// measured here.
const { env, pool } = connectLocalDatabase("Entry sheet browser tests");
const fixtures: string[] = [];
test.beforeEach(async ({ page }, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop",
    "one project is enough: these tests set their own widths",
  );
  const ledgerId = newId();
  fixtures.push(ledgerId);
  const checking = newId();
  const food = newId();
  await createOwnerLedger(pool, env, ledgerId, "E2E entry sheet ledger");
  await pool.query(
    "INSERT INTO accounts (id,ledger_id,name,type,opening_balance) VALUES ($1,$3,'Checking','bank',100000),($2,$3,'Cash','cash',5000)",
    [checking, newId(), ledgerId],
  );
  await pool.query(
    "INSERT INTO categories (id,ledger_id,name,kind) VALUES ($1,$2,'Food','expense')",
    [food, ledgerId],
  );
  await pool.query(
    "INSERT INTO transactions (id,ledger_id,account_id,category_id,kind,date,amount,base_amount,payee,status) VALUES ($1,$2,$3,$4,'expense','2026-10-06',-2500,-2500,'Lunch place','cleared')",
    [newId(), ledgerId, checking, food],
  );
  await prepareBrowser(page, testInfo, {
    ledgerId,
    name: "Synthetic entry sheet ledger",
    forwarded: [200, 20],
  });
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
      "UPDATE ledgers SET deleted_at=now(), updated_at=now() WHERE id=$1 AND name LIKE 'E2E entry sheet ledger%'",
      [id],
    );
  }
  fixtures.length = 0;
});
test.afterAll(async () => {
  await pool.end();
});

async function open(page: Page, width: number, what: "add" | "edit") {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width, height: 900 });
  await signIn(page);
  await page.goto("/transactions");
  await page.waitForFunction(
    () => getComputedStyle(document.body).containerType === "inline-size",
  );
  if (what === "add") {
    await page
      .getByRole("button", { name: "Add transaction", exact: true })
      .filter({ visible: true })
      .click();
    return page.getByRole("dialog", { name: "Add transaction" });
  }
  await page.locator(".tx-row").first().click();
  return page.getByRole("dialog", { name: "Edit transaction" });
}
const box = async (locator: Locator) => {
  const found = await locator.boundingBox();
  if (!found) throw new Error("not on screen");
  return found;
};
/** An element is a real 44 px target when a click 21 px out from its centre still lands on it. */
async function is44(page: Page, locator: Locator) {
  const found = await box(locator);
  const x = found.x + found.width / 2;
  const y = found.y + found.height / 2;
  return page.evaluate(
    ({ x, y }) => {
      const hit = (px: number, py: number) => document.elementFromPoint(px, py);
      const target = hit(x, y);
      return [
        [x - 21, y],
        [x + 21, y],
        [x, y - 21],
        [x, y + 21],
      ].every(([px, py]) => {
        const element = hit(px as number, py as number);
        return !!element && !!target && target.contains(element);
      });
    },
    { x, y },
  );
}

for (const width of [320, 390]) {
  test(`on a phone at ${width} px the Add sheet rises from the bottom, keeps Save in view and never scrolls sideways`, async ({
    page,
  }) => {
    const sheet = await open(page, width, "add");
    const frame = await box(sheet);
    expect(frame.x).toBeLessThanOrEqual(1);
    expect(frame.width).toBeGreaterThanOrEqual(width - 2);
    expect(frame.y + frame.height).toBeGreaterThanOrEqual(898);
    const save = sheet.getByRole("button", { name: "Save transaction" });
    const saved = await box(save);
    expect(saved.y + saved.height).toBeLessThanOrEqual(900);
    expect(await is44(page, save)).toBe(true);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    // The big amount is the type scale's 35 px with the currency code beside it.
    const amount = sheet.getByLabel("Amount (USD)");
    await expect(amount).toBeFocused();
    expect(
      await amount.evaluate((element) => getComputedStyle(element).fontSize),
    ).toBe("35px");
    await expect(
      sheet.locator(".entry-amount-code", { hasText: "USD" }),
    ).toBeVisible();
    // The pill's three options are real targets.
    for (const name of ["Expense", "Income", "Transfer"])
      expect(await is44(page, sheet.getByRole("radio", { name }))).toBe(true);
    // Date and time stack on a phone, so neither is cut short.
    const date = await box(sheet.getByLabel("Date", { exact: true }));
    const time = await box(
      sheet.getByLabel("Time (optional)", { exact: true }),
    );
    expect(time.y).toBeGreaterThan(date.y + date.height - 1);
    expect(date.width).toBeGreaterThan(220);
  });
}

test("from 700 px the sheet is a 440 px drawer on the right and date and time sit side by side", async ({
  page,
}) => {
  const sheet = await open(page, 1280, "add");
  const frame = await box(sheet);
  expect(Math.round(frame.width)).toBe(440);
  expect(Math.round(frame.x + frame.width)).toBe(1280);
  const date = await box(sheet.getByLabel("Date", { exact: true }));
  const time = await box(sheet.getByLabel("Time (optional)", { exact: true }));
  expect(Math.abs(date.y - time.y)).toBeLessThan(2);
  expect(time.x).toBeGreaterThan(date.x + date.width - 1);
});

test("Save is pinned: the form scrolls under it and Cancel is in the head", async ({
  page,
}) => {
  const sheet = await open(page, 390, "add");
  const save = sheet.getByRole("button", { name: "Save transaction" });
  const before = await box(save);
  await sheet.getByText("Pending", { exact: true }).scrollIntoViewIfNeeded();
  const after = await box(save);
  expect(Math.round(after.y)).toBe(Math.round(before.y));
  const cancel = await box(sheet.getByRole("button", { name: "Cancel" }));
  expect(cancel.y).toBeLessThan(before.y);
});

test("the Edit sheet asks before deleting in a centred question that has real targets", async ({
  page,
}) => {
  const sheet = await open(page, 390, "edit");
  await sheet.getByRole("button", { name: "Delete transaction" }).click();
  const question = page.getByRole("dialog", { name: "Delete this entry?" });
  await expect(question).toBeVisible();
  const frame = await box(question);
  expect(Math.abs(frame.x + frame.width / 2 - 195)).toBeLessThan(2);
  expect(frame.y).toBeGreaterThan(50);
  for (const name of ["Keep entry", "Confirm delete"])
    expect(await is44(page, question.getByRole("button", { name }))).toBe(true);
  await question.getByRole("button", { name: "Keep entry" }).click();
  await expect(question).toBeHidden();
  await expect(sheet).toBeVisible();
  await expect(
    sheet.getByRole("button", { name: "Delete transaction" }),
  ).toBeFocused();
});

test("the type pill moves an Add between expense, income and transfer without losing the sheet", async ({
  page,
}) => {
  const sheet = await open(page, 1280, "add");
  await sheet.getByRole("radio", { name: "Income" }).click();
  await expect(sheet.getByLabel("Payer", { exact: true })).toBeVisible();
  await sheet.getByRole("radio", { name: "Transfer" }).click();
  await expect(sheet.getByLabel("From account")).toBeVisible();
  await expect(sheet.getByRole("radio", { name: "Transfer" })).toBeChecked();
  await sheet.getByRole("radio", { name: "Expense" }).click();
  await expect(sheet.getByLabel("Payee", { exact: true })).toBeVisible();
  await expect(sheet.getByRole("radio", { name: "Expense" })).toBeChecked();
});
