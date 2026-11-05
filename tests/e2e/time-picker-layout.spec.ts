import { expect, type Locator, type Page, test } from "@playwright/test";
import { newId } from "../../packages/shared/src/index";
import {
  connectLocalDatabase,
  createOwnerLedger,
  prepareBrowser,
} from "./ledger-setup";
import { signIn } from "./sign-in";
import { setTheme } from "./theme";

// The themed time picker in a real browser: jsdom has no layout, so the spacing between its three button rows (AM and
// PM, the minute shortcuts, and Clear, Now and Set time) is measured here. The three rows are one 12 px apart.
const { env, pool } = connectLocalDatabase("Time picker layout browser tests");
const fixtures: string[] = [];
test.beforeEach(async ({ page }, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop",
    "one project is enough: these tests set their own widths",
  );
  const ledgerId = newId();
  fixtures.push(ledgerId);
  await createOwnerLedger(pool, env, ledgerId, "E2E time picker layout ledger");
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
    name: "Synthetic time picker layout ledger",
    forwarded: [190, 10],
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
      "UPDATE ledgers SET deleted_at=now(), updated_at=now() WHERE id=$1 AND name LIKE 'E2E time picker layout ledger%'",
      [id],
    );
  }
  fixtures.length = 0;
});
test.afterAll(async () => {
  await pool.end();
});

const box = async (locator: Locator) => {
  const found = await locator.boundingBox();
  if (!found) throw new Error("not on screen");
  return found;
};
async function openPicker(page: Page, width: number, theme: "light" | "dark") {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width, height: 900 });
  await signIn(page);
  await page.goto("/home");
  await page.waitForFunction(
    () => getComputedStyle(document.body).containerType === "inline-size",
  );
  await setTheme(page, theme);
  await page
    .getByRole("button", { name: "Add transaction", exact: true })
    .filter({ visible: true })
    .click();
  await expect(page.getByLabel("Amount (USD)")).toBeVisible();
  await page
    .getByRole("button", { name: "Choose time (optional)", exact: true })
    .click();
  const picker = page.getByRole("dialog", {
    name: "Time (optional)",
    exact: true,
  });
  await expect(picker).toBeVisible();
  return picker;
}

for (const theme of ["light", "dark"] as const)
  for (const width of [320, 390, 1280])
    test(`the three button rows are one 12 px apart at ${width} px in ${theme}, and the picker fits`, async ({
      page,
    }) => {
      const picker = await openPicker(page, width, theme);
      // The rows: AM and PM, the minute shortcuts, and the actions.
      const period = picker.getByRole("button", { name: /^(AM|PM)$/ });
      const shortcuts = picker.getByRole("group", { name: "Minute shortcuts" });
      const actions = picker.getByRole("button", {
        name: /^(Clear|Now|Set time)$/,
      });
      const bottom = async (rows: Locator) => {
        let low = 0;
        for (const row of await rows.all()) {
          const found = await box(row);
          low = Math.max(low, found.y + found.height);
        }
        return low;
      };
      const top = async (rows: Locator) => {
        let high = Number.POSITIVE_INFINITY;
        for (const row of await rows.all())
          high = Math.min(high, (await box(row)).y);
        return high;
      };
      const shortcutButtons = shortcuts.getByRole("button");
      await expect(period).toHaveCount(2);
      await expect(shortcutButtons).toHaveCount(4);
      await expect(actions).toHaveCount(3);
      const first = (await top(shortcutButtons)) - (await bottom(period));
      const second = (await top(actions)) - (await bottom(shortcutButtons));
      expect(first).toBeCloseTo(12, 0);
      expect(second).toBeCloseTo(12, 0);
      // The shortcut row has the same inset on both sides, and the action row ends where the shortcut row ends.
      const frame = await box(picker);
      const firstShortcut = await box(shortcutButtons.first());
      const lastShortcut = await box(shortcutButtons.last());
      const left = firstShortcut.x - frame.x;
      const shortcutsRight = lastShortcut.x + lastShortcut.width;
      expect(
        Math.abs(left - (frame.x + frame.width - shortcutsRight)),
      ).toBeLessThanOrEqual(1);
      const lastAction = await box(actions.last());
      expect(
        Math.abs(lastAction.x + lastAction.width - shortcutsRight),
      ).toBeLessThanOrEqual(1);
      // It fits the screen.
      expect(frame.x).toBeGreaterThanOrEqual(0);
      expect(frame.x + frame.width).toBeLessThanOrEqual(width);
      expect(frame.y).toBeGreaterThanOrEqual(0);
      expect(frame.y + frame.height).toBeLessThanOrEqual(900);
    });
