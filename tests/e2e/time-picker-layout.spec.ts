import { expect, type Locator, type Page, test } from "@playwright/test";
import { newId } from "../../packages/shared/src/index";
import {
  connectLocalDatabase,
  createOwnerLedger,
  prepareBrowser,
} from "./ledger-setup";
import { signIn } from "./sign-in";
import { setTheme } from "./theme";

// The time picker in a real browser: jsdom has no layout, so where it sits (a bottom sheet or a drawer), the spacing of its
// two button rows (AM and PM, the minute shortcuts) and its pinned footer (Clear, Now and Set time) are measured here.
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
async function openPicker(
  page: Page,
  width: number,
  theme: "light" | "dark",
  motion = false,
) {
  await page.emulateMedia({
    reducedMotion: motion ? "no-preference" : "reduce",
  });
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
    test(`the picker is the shared sheet at ${width} px in ${theme}: its rows keep 12 px apart and its actions are pinned`, async ({
      page,
    }) => {
      const picker = await openPicker(page, width, theme);
      // The picker is a sheet like the others: a bottom sheet on a phone, a 440 px drawer from 700 px.
      await expect(picker).toHaveClass(/ui-sheet/);
      const frame = await box(picker);
      if (width < 700) {
        expect(frame.x).toBeCloseTo(0, 0);
        expect(frame.width).toBeCloseTo(width, 0);
        expect(frame.y + frame.height).toBeCloseTo(900, 0);
      } else {
        expect(frame.width).toBeCloseTo(440, 0);
        expect(frame.x + frame.width).toBeCloseTo(width, 0);
        expect(frame.y).toBeCloseTo(0, 0);
        expect(frame.height).toBeCloseTo(900, 0);
      }
      // Its head says Cancel, like every sheet, and there is no X.
      await expect(
        picker.getByRole("button", { name: "Cancel" }),
      ).toBeVisible();
      await expect(
        picker.getByRole("button", { name: "Close picker" }),
      ).toHaveCount(0);
      // The two rows of the body: AM and PM, then the minute shortcuts, 12 px apart.
      const period = picker.getByRole("button", { name: /^(AM|PM)$/ });
      const shortcuts = picker.getByRole("group", { name: "Minute shortcuts" });
      const shortcutButtons = shortcuts.getByRole("button");
      await expect(period).toHaveCount(2);
      await expect(shortcutButtons).toHaveCount(4);
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
      expect((await top(shortcutButtons)) - (await bottom(period))).toBeCloseTo(
        12,
        0,
      );
      // The shortcut row has the same inset on both sides.
      const firstShortcut = await box(shortcutButtons.first());
      const lastShortcut = await box(shortcutButtons.last());
      const shortcutsRight = lastShortcut.x + lastShortcut.width;
      expect(
        Math.abs(
          firstShortcut.x - frame.x - (frame.x + frame.width - shortcutsRight),
        ),
      ).toBeLessThanOrEqual(1);
      // Clear, Now and Set time are pinned at the bottom of the sheet, in one row, the filled one last and at the
      // shortcut row's right edge, and they are below the shortcuts.
      const foot = picker.locator(".ui-sheet-foot");
      const actions = foot.getByRole("button");
      await expect(actions).toHaveCount(3);
      await expect(
        foot.getByRole("button", { name: /^(Clear|Now|Set time)$/ }),
      ).toHaveCount(3);
      const footBox = await box(foot);
      // The drawer has a 1 px border at its bottom edge; the footer sits inside it.
      expect(
        Math.abs(footBox.y + footBox.height - (frame.y + frame.height)),
      ).toBeLessThanOrEqual(1.5);
      expect(footBox.y).toBeGreaterThan(await bottom(shortcutButtons));
      const last = await box(actions.last());
      expect(last.x + last.width).toBeCloseTo(shortcutsRight, 0);
      const row = await Promise.all((await actions.all()).map(box));
      for (const found of row) expect(found.y).toBeCloseTo(row[0]?.y ?? 0, 0);
      await expect(foot.getByRole("button", { name: "Set time" })).toHaveClass(
        /ui-btn-primary/,
      );
      // It fits the screen.
      expect(frame.x).toBeGreaterThanOrEqual(0);
      expect(frame.x + frame.width).toBeLessThanOrEqual(width);
      expect(frame.y).toBeGreaterThanOrEqual(0);
      expect(frame.y + frame.height).toBeLessThanOrEqual(900);
    });

test("the picker's dark overlay is the shared one: above the sheet it was opened from, and it fades out", async ({
  page,
}) => {
  const picker = await openPicker(page, 390, "light", true);
  // Two dark overlays are up: the editor's and the picker's, the picker's later in the page and so on top.
  const scrims = page.locator(".ui-scrim");
  await expect(scrims).toHaveCount(2);
  // Read once the sheet has finished sliding in (the animation is on here), so a slow machine does not catch it mid-way.
  await expect
    .poll(() =>
      picker.evaluate((node) => {
        const found = node.getBoundingClientRect();
        const hit = document.elementFromPoint(
          found.x + found.width / 2,
          found.y + 20,
        );
        return Boolean(hit && node.contains(hit));
      }),
    )
    .toBe(true);
  await page.waitForTimeout(400);
  await page.evaluate(() => {
    const w = window as unknown as { __opacity: number[] };
    w.__opacity = [];
    const loop = () => {
      const nodes = document.querySelectorAll(".ui-scrim");
      const node = nodes[nodes.length - 1];
      if (node) {
        const style = getComputedStyle(node);
        w.__opacity.push(
          Number(style.opacity),
          style.pointerEvents === "none" ? 1 : 0,
        );
      }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  });
  await picker.getByRole("button", { name: "Cancel" }).click();
  await expect(picker).toHaveCount(0);
  await page.waitForTimeout(600);
  const seen = await page.evaluate(
    () => (window as unknown as { __opacity: number[] }).__opacity,
  );
  const opacities = seen.filter((_, index) => index % 2 === 0);
  const passThrough = seen.filter((_, index) => index % 2 === 1);
  // It got lighter over several frames after the picker went, and let taps through once it was closing.
  expect(
    opacities.filter((value) => value > 0.03 && value < 0.97).length,
  ).toBeGreaterThanOrEqual(3);
  expect(passThrough.some((value) => value === 1)).toBe(true);
  // Only the editor's dark overlay is left, and the editor is still open.
  await expect(scrims).toHaveCount(1);
  await expect(page.getByLabel("Amount (USD)")).toBeVisible();
});

// The calendar's days keep a 44 px touch width where the sheet is narrowest (the seven columns need 308 px).
for (const width of [320, 390, 1280])
  test(`the calendar's days and month buttons are at least 44 px wide at ${width} px`, async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize({ width, height: 900 });
    await signIn(page);
    await page.goto("/home");
    await page.waitForFunction(
      () => getComputedStyle(document.body).containerType === "inline-size",
    );
    await page
      .getByRole("button", { name: "Add transaction", exact: true })
      .filter({ visible: true })
      .click();
    await expect(page.getByLabel("Amount (USD)")).toBeVisible();
    await page
      .getByRole("button", { name: "Choose date", exact: true })
      .click();
    const picker = page.getByRole("dialog", { name: "Date", exact: true });
    await expect(picker).toBeVisible();
    const days = picker.locator("[data-date]");
    await expect(days).toHaveCount(42);
    const widths = await days.evaluateAll((nodes) =>
      nodes.map((node) => node.getBoundingClientRect().width),
    );
    expect(Math.min(...widths)).toBeGreaterThanOrEqual(43.5);
    for (const name of ["Previous month", "Next month"]) {
      const found = await box(picker.getByRole("button", { name }));
      expect(found.width).toBeGreaterThanOrEqual(43.5);
      expect(found.height).toBeGreaterThanOrEqual(43.5);
    }
    const frame = await box(picker);
    const last = await box(days.last());
    expect(last.x + last.width).toBeLessThanOrEqual(
      frame.x + frame.width + 0.5,
    );
  });
