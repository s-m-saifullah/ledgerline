import AxeBuilder from "@axe-core/playwright";
import { expect, type Locator, type Page, test } from "@playwright/test";
import { newId } from "../../packages/shared/src/index";
import {
  connectLocalDatabase,
  createOwnerLedger,
  prepareBrowser,
} from "./ledger-setup";
import { signIn } from "./sign-in";
import { setTheme } from "./theme";

// The transfer sheet in a real browser (ADR 0047, PR 5c): the cards, the swap between From and To, Save pinned
// at the foot, and the delete question. jsdom cannot run container queries, so widths are measured here.
const { env, pool } = connectLocalDatabase("Transfer sheet browser tests");
const fixtures: string[] = [];
test.beforeEach(async ({ page }, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop",
    "one project is enough: these tests set their own widths",
  );
  const ledgerId = newId();
  fixtures.push(ledgerId);
  await createOwnerLedger(pool, env, ledgerId, "E2E transfer sheet ledger");
  await pool.query(
    "INSERT INTO accounts (id,ledger_id,name,type,currency,opening_balance) VALUES ($1,$4,'Checking','bank','USD',100000),($2,$4,'Cash','cash','USD',5000),($3,$4,'Euro wallet','wallet','EUR',0)",
    [newId(), newId(), newId(), ledgerId],
  );
  await prepareBrowser(page, testInfo, {
    ledgerId,
    name: "Synthetic transfer sheet ledger",
    forwarded: [200, 20],
  });
});
test.afterEach(async () => {
  for (const id of fixtures) {
    for (const table of ["transactions", "accounts"])
      await pool.query(
        `UPDATE ${table} SET deleted_at=now(), updated_at=now() WHERE ledger_id=$1`,
        [id],
      );
    await pool.query(
      "UPDATE ledger_members SET deleted_at=now(), updated_at=now() WHERE ledger_id=$1",
      [id],
    );
    await pool.query(
      "UPDATE ledgers SET deleted_at=now(), updated_at=now() WHERE id=$1 AND name LIKE 'E2E transfer sheet ledger%'",
      [id],
    );
  }
  fixtures.length = 0;
});
test.afterAll(async () => {
  await pool.end();
});

async function openAdd(page: Page, width: number, theme?: "light" | "dark") {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width, height: 900 });
  await signIn(page);
  await page.goto("/transactions");
  await page.waitForFunction(
    () => getComputedStyle(document.body).containerType === "inline-size",
  );
  if (theme) await setTheme(page, theme);
  await page
    .getByRole("button", { name: "Add transaction", exact: true })
    .filter({ visible: true })
    .click();
  const sheet = page.getByRole("dialog", { name: "Add transaction" });
  await sheet.getByRole("radio", { name: "Transfer", exact: true }).click();
  await expect(sheet.getByLabel("From account")).toBeVisible();
  return sheet;
}
const box = async (locator: Locator) => {
  const found = await locator.boundingBox();
  if (!found) throw new Error("not on screen");
  return found;
};
/** Waits until a dialog has stopped moving: its box reads the same twice in a row (a question settles after it opens). */
async function settled(locator: Locator) {
  let last = "";
  await expect
    .poll(async () => {
      const now = JSON.stringify(await locator.boundingBox());
      const same = now === last;
      last = now;
      return same;
    })
    .toBe(true);
}
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
  test(`on a phone at ${width} px From, Swap and To stack, Save stays in view and nothing scrolls sideways`, async ({
    page,
  }) => {
    const sheet = await openAdd(page, width);
    const from = await box(sheet.getByLabel("From account"));
    const swap = sheet.getByRole("button", { name: "Swap accounts" });
    const to = await box(sheet.getByLabel("To account"));
    const between = await box(swap);
    expect(between.y).toBeGreaterThan(from.y + from.height - 1);
    expect(to.y).toBeGreaterThan(between.y + between.height - 1);
    expect(await is44(page, swap)).toBe(true);
    const save = sheet.getByRole("button", { name: "Save transfer" });
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
    // Date and time stack on a phone, so neither is cut short.
    const date = await box(sheet.getByLabel("Date", { exact: true }));
    const time = await box(
      sheet.getByLabel("Time (optional)", { exact: true }),
    );
    expect(time.y).toBeGreaterThan(date.y + date.height - 1);
    expect(date.width).toBeGreaterThan(220);
  });
}

test("from 700 px the sheet is a 440 px drawer and Save stays pinned while the form scrolls", async ({
  page,
}) => {
  const sheet = await openAdd(page, 1280);
  const frame = await box(sheet);
  expect(Math.round(frame.width)).toBe(440);
  expect(Math.round(frame.x + frame.width)).toBe(1280);
  const save = sheet.getByRole("button", { name: "Save transfer" });
  const before = await box(save);
  await sheet.getByLabel("Note", { exact: true }).scrollIntoViewIfNeeded();
  expect(Math.round((await box(save)).y)).toBe(Math.round(before.y));
});

test("Swap exchanges the accounts and the two amounts in the browser", async ({
  page,
}) => {
  const sheet = await openAdd(page, 390);
  const from = sheet.getByLabel("From account");
  const to = sheet.getByLabel("To account");
  await from.selectOption({ label: "Checking" });
  await to.selectOption({ label: "Euro wallet" });
  await sheet.getByLabel("Amount sent (USD)").fill("100");
  await sheet.getByLabel("Amount received (EUR)").fill("89");
  await sheet.getByRole("button", { name: "Swap accounts" }).click();
  await expect(from.locator("option:checked")).toHaveText("Euro wallet");
  await expect(to.locator("option:checked")).toHaveText("Checking");
  await expect(sheet.getByLabel("Amount sent (EUR)")).toHaveValue("89");
  await expect(sheet.getByLabel("Amount received (USD)")).toHaveValue("100");
  await sheet.getByRole("button", { name: "Save transfer" }).click();
  await expect(
    page.getByText("Transfer saved.", { exact: true }),
  ).toBeVisible();
  const saved = await pool.query(
    "SELECT a.name, t.amount, t.currency FROM transactions t JOIN accounts a ON a.id=t.account_id JOIN ledgers l ON l.id=t.ledger_id WHERE l.name LIKE 'E2E transfer sheet ledger%' AND t.kind='transfer' AND t.deleted_at IS NULL ORDER BY t.amount",
  );
  expect(saved.rows.map((row) => [row.name, row.amount, row.currency])).toEqual(
    [
      ["Euro wallet", "-8900", "EUR"],
      ["Checking", "10000", "USD"],
    ],
  );
});

test("a saved transfer asks before deleting in a centred question with real targets", async ({
  page,
}) => {
  const sheet = await openAdd(page, 390);
  await sheet.getByLabel("From account").selectOption({ label: "Checking" });
  await sheet.getByLabel("To account").selectOption({ label: "Cash" });
  await sheet.getByLabel("Amount (USD)").fill("12.34");
  await sheet.getByRole("button", { name: "Save transfer" }).click();
  await expect(
    page.getByText("Transfer saved.", { exact: true }),
  ).toBeVisible();
  await page.locator(".tx-row").first().click();
  const editor = page.getByRole("dialog", { name: "Edit transfer" });
  // A saved transfer has no type pill and no fee or bonus fields.
  await expect(editor.getByRole("radio")).toHaveCount(0);
  await expect(editor.getByLabel("Fee (optional)")).toHaveCount(0);
  await editor.getByRole("button", { name: "Delete transfer" }).click();
  const question = page.getByRole("dialog", { name: "Delete this transfer?" });
  await expect(question).toBeVisible();
  await settled(question);
  const frame = await box(question);
  expect(Math.abs(frame.x + frame.width / 2 - 195)).toBeLessThan(2);
  expect(frame.y).toBeGreaterThan(50);
  for (const name of ["Keep transfer", "Confirm delete"])
    expect(await is44(page, question.getByRole("button", { name }))).toBe(true);
  await question.getByRole("button", { name: "Keep transfer" }).click();
  await expect(question).toBeHidden();
  await expect(editor).toBeVisible();
  await expect(
    editor.getByRole("button", { name: "Delete transfer" }),
  ).toBeFocused();
});

for (const theme of ["light", "dark"] as const)
  test(`has no accessibility violations in ${theme}, new and with a cross-currency amount`, async ({
    page,
  }) => {
    const sheet = await openAdd(page, 1280, theme);
    const found = async () =>
      (await new AxeBuilder({ page }).analyze()).violations.map(
        (item) =>
          `${item.id}: ${item.nodes.map((node) => node.target.join(" ")).join(" | ")}`,
      );
    expect(await found()).toEqual([]);
    await sheet.getByLabel("To account").selectOption({ label: "Euro wallet" });
    await expect(sheet.getByLabel("Amount received (EUR)")).toBeVisible();
    expect(await found()).toEqual([]);
  });
