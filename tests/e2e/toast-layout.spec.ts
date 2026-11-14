import { expect, type Locator, test } from "@playwright/test";
import { newId } from "../../packages/shared/src/index";
import {
  connectLocalDatabase,
  createOwnerLedger,
  prepareBrowser,
} from "./ledger-setup";
import { signIn } from "./sign-in";
import { setTheme } from "./theme";

// The toast's one Dismiss control, measured in a real browser: a cross that is a 44 px target on a phone, the word from
// 700 px, always named "Dismiss", and a toast that never runs past the screen (WP-11a).
const { env, pool } = connectLocalDatabase("Toast layout browser tests");
const fixtures: string[] = [];
test.beforeEach(async ({ page }, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop",
    "one project is enough: these tests set their own widths",
  );
  const ledgerId = newId();
  fixtures.push(ledgerId);
  await createOwnerLedger(pool, env, ledgerId, "E2E toast layout ledger");
  await prepareBrowser(page, testInfo, {
    ledgerId,
    name: "Synthetic toast layout ledger",
    forwarded: [190, 12],
  });
});
test.afterEach(async () => {
  for (const id of fixtures) {
    await pool.query(
      "UPDATE tags SET deleted_at=now(), updated_at=now() WHERE ledger_id=$1",
      [id],
    );
    await pool.query(
      "UPDATE ledger_members SET deleted_at=now(), updated_at=now() WHERE ledger_id=$1",
      [id],
    );
    await pool.query(
      "UPDATE ledgers SET deleted_at=now(), updated_at=now() WHERE id=$1 AND name LIKE 'E2E toast layout ledger%'",
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

for (const theme of ["light", "dark"] as const)
  for (const width of [320, 390, 1280])
    test(`a toast's Dismiss is a 44 px cross on a phone and the word from 700 px (${width} px, ${theme})`, async ({
      page,
    }) => {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.setViewportSize({ width, height: 800 });
      await signIn(page);
      await page.goto("/tags");
      await page.waitForFunction(
        () => getComputedStyle(document.body).containerType === "inline-size",
      );
      await setTheme(page, theme);
      await page
        .getByRole("button", { name: "Add tag", exact: true })
        .filter({ visible: true })
        .first()
        .click();
      await page.getByLabel("Name", { exact: true }).fill("Synthetic tag");
      await page.getByRole("button", { name: "Save", exact: true }).click();
      const toast = page.getByRole("group", { name: "Tag notification" });
      await expect(toast).toBeVisible();
      const dismiss = toast.getByRole("button", { name: "Dismiss" });
      await expect(dismiss).toHaveCount(1);
      const found = await box(dismiss);
      const frame = await box(toast);
      expect(found.height).toBeGreaterThanOrEqual(43.5);
      expect(found.width).toBeGreaterThanOrEqual(43.5);
      // The toast, and the control inside it, stay on the screen.
      expect(frame.x).toBeGreaterThanOrEqual(0);
      expect(frame.x + frame.width).toBeLessThanOrEqual(width + 0.5);
      expect(found.x + found.width).toBeLessThanOrEqual(
        frame.x + frame.width + 0.5,
      );
      const cross = dismiss.locator("svg");
      const word = dismiss.locator(".toast-dismiss-word");
      if (width < 700) {
        await expect(cross).toBeVisible();
        // The word is still there for assistive technology but takes no room.
        expect((await box(word)).width).toBeLessThanOrEqual(1.5);
        expect(found.width).toBeLessThanOrEqual(48);
      } else {
        await expect(cross).toBeHidden();
        expect((await box(word)).width).toBeGreaterThan(30);
      }
      await dismiss.click();
      await expect(toast).toHaveCount(0);
    });
