import { expect, type Locator, test } from "@playwright/test";
import { newId } from "../../packages/shared/src/index";
import {
  connectLocalDatabase,
  createOwnerLedger,
  prepareBrowser,
} from "./ledger-setup";
import { signIn } from "./sign-in";

// A drawer is as tall as the screen, so a short form must not leave its primary button part-way up: the footer stays at
// the bottom edge (the overlay's own contract). Tags' Add tag is one of the shortest forms.
const { env, pool } = connectLocalDatabase("Drawer footer browser tests");
const fixtures: string[] = [];
test.beforeEach(async ({ page }, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop",
    "one project is enough: these tests set their own widths",
  );
  const ledgerId = newId();
  fixtures.push(ledgerId);
  await createOwnerLedger(pool, env, ledgerId, "E2E drawer footer ledger");
  await prepareBrowser(page, testInfo, {
    ledgerId,
    name: "Synthetic drawer footer ledger",
    forwarded: [190, 11],
  });
});
test.afterEach(async () => {
  for (const id of fixtures) {
    await pool.query(
      "UPDATE ledger_members SET deleted_at=now(), updated_at=now() WHERE ledger_id=$1",
      [id],
    );
    await pool.query(
      "UPDATE ledgers SET deleted_at=now(), updated_at=now() WHERE id=$1 AND name LIKE 'E2E drawer footer ledger%'",
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

for (const width of [390, 700, 1280])
  test(`a short sheet keeps its Save button at its bottom edge at ${width} px`, async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize({ width, height: 900 });
    await signIn(page);
    await page.goto("/tags");
    await page.waitForFunction(
      () => getComputedStyle(document.body).containerType === "inline-size",
    );
    await page
      .getByRole("button", { name: "Add tag", exact: true })
      .filter({ visible: true })
      .first()
      .click();
    const sheet = page.getByRole("dialog", { name: "Add tag", exact: true });
    await expect(sheet).toBeVisible();
    const frame = await box(sheet);
    const foot = await box(sheet.locator(".ui-sheet-foot"));
    // The drawer's border is 1 px; a phone's bottom sheet may also leave the home-bar inset under the button.
    expect(
      Math.abs(foot.y + foot.height - (frame.y + frame.height)),
    ).toBeLessThanOrEqual(1.5);
    if (width >= 700) expect(frame.height).toBeCloseTo(900, 0);
  });
