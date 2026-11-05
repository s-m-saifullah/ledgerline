import { expect, type Page, test } from "@playwright/test";
import { newId } from "../../packages/shared/src/index";
import {
  connectLocalDatabase,
  createOwnerLedger,
  prepareBrowser,
} from "./ledger-setup";
import { signIn } from "./sign-in";

// A phone sheet must not flicker (ADR 0047, sheet gestures): after the entrance has finished, a tap on the handle or the
// title bar, a drag that springs back, and a change of the viewport (the keyboard opening and closing) must never
// play the entrance again. The frames are recorded one by one in a real browser with real touch, with motion ON
// (`sheet-gestures.spec.ts` only looks at where a sheet ends up, which a replayed entrance does not change).
test.use({
  viewport: { width: 412, height: 915 },
  hasTouch: true,
  isMobile: true,
  deviceScaleFactor: 3.5,
});
const { env, pool } = connectLocalDatabase("Sheet motion browser tests");
const fixtures: string[] = [];
test.beforeEach(async ({ page }, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop",
    "one project is enough: these tests set their own size and touch",
  );
  const ledgerId = newId();
  fixtures.push(ledgerId);
  await createOwnerLedger(pool, env, ledgerId, "E2E sheet motion ledger");
  await prepareBrowser(page, testInfo, {
    ledgerId,
    name: "Synthetic sheet motion ledger",
    forwarded: [175, 5],
  });
});
test.afterEach(async () => {
  for (const id of fixtures) {
    await pool.query(
      "UPDATE ledger_members SET deleted_at=now(), updated_at=now() WHERE ledger_id=$1",
      [id],
    );
    await pool.query(
      "UPDATE ledgers SET deleted_at=now(), updated_at=now() WHERE id=$1 AND name LIKE 'E2E sheet motion ledger%'",
      [id],
    );
  }
  fixtures.length = 0;
});
test.afterAll(async () => {
  await pool.end();
});

const adminId = newId();
const person = (over: Record<string, unknown> = {}) => ({
  id: newId(),
  name: "Jordan Lee",
  email: "jordan@example.com",
  isAdmin: false,
  mustChangePassword: false,
  disabled: false,
  twoFactorEnabled: false,
  createdAt: "2026-11-03T10:00:00.000Z",
  ...over,
});

type Frame = { top: number; entrance: boolean } | { gone: true };
/** Opens a person's sheet on Users with motion on, waits for the entrance to finish and starts a frame recorder. */
async function openSheet(page: Page) {
  await page.route(/\/api\/v1\/me$/, (route) =>
    route.fulfill({
      json: {
        id: adminId,
        name: "Sam",
        email: "sam@example.com",
        isAdmin: true,
        mustChangePassword: false,
        twoFactorEnabled: true,
      },
    }),
  );
  await page.route(/\/api\/v1\/users$/, (route) =>
    route.fulfill({
      json: {
        items: [
          person({
            id: adminId,
            name: "Sam",
            email: "sam@example.com",
            isAdmin: true,
          }),
          person(),
        ],
      },
    }),
  );
  await page.route(/\/api\/v1\/users\/deleted$/, (route) =>
    route.fulfill({ json: { items: [] } }),
  );
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await signIn(page);
  await page.goto("/users");
  await page.waitForFunction(
    () => getComputedStyle(document.body).containerType === "inline-size",
  );
  await page.locator(".us-page .ui-row", { hasText: "Jordan" }).tap();
  await expect(page.locator(".ui-sheet")).toBeVisible();
  // The entrance is over when the sheet has no running animation.
  await page.waitForFunction(
    () => document.querySelector(".ui-sheet")?.getAnimations().length === 0,
  );
  await page.evaluate(() => {
    const w = window as unknown as {
      __rec: { frames: unknown[]; on: boolean };
    };
    w.__rec = { frames: [], on: false };
    const loop = () => {
      if (w.__rec.on) {
        const sheet = document.querySelector(".ui-sheet");
        w.__rec.frames.push(
          sheet
            ? {
                top: sheet.getBoundingClientRect().top,
                entrance: sheet
                  .getAnimations()
                  .some(
                    (animation) =>
                      (animation as CSSAnimation).animationName === "ui-up",
                  ),
              }
            : { gone: true },
        );
      }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  });
}
const record = (page: Page, on: boolean) =>
  page.evaluate((value) => {
    const w = window as unknown as {
      __rec: { frames: unknown[]; on: boolean };
    };
    if (value) w.__rec.frames = [];
    w.__rec.on = value;
  }, on);
const frames = (page: Page) =>
  page.evaluate(
    () =>
      (window as unknown as { __rec: { frames: Frame[] } }).__rec
        .frames as Frame[],
  );
const center = async (page: Page, selector: string) => {
  const found = await page.locator(selector).boundingBox();
  if (!found) throw new Error("not on screen");
  return { x: found.x + found.width / 2, y: found.y + found.height / 2 };
};
const rest = (page: Page) =>
  page.evaluate(
    () => document.querySelector(".ui-sheet")?.getBoundingClientRect().top ?? 0,
  );
const entranceFrames = (all: Frame[]) =>
  all.filter((frame) => "entrance" in frame && frame.entrance).length;

test("a tap on the handle closes the sheet and never replays its entrance", async ({
  page,
}) => {
  await openSheet(page);
  const at = await center(page, ".ui-grab");
  await record(page, true);
  await page.touchscreen.tap(at.x, at.y);
  await expect(page.locator(".ui-sheet")).toHaveCount(0);
  await page.waitForTimeout(300);
  await record(page, false);
  expect(entranceFrames(await frames(page))).toBe(0);
});

test("a tap on the title bar leaves the sheet where it is and never replays its entrance", async ({
  page,
}) => {
  await openSheet(page);
  const before = await rest(page);
  // The title, away from Cancel: a quiet place to tap, such as to put the keyboard away.
  const at = await center(page, ".ui-sheet-title");
  await record(page, true);
  await page.touchscreen.tap(at.x, at.y);
  await page.waitForTimeout(700);
  await record(page, false);
  expect(entranceFrames(await frames(page))).toBe(0);
  expect(await rest(page)).toBeCloseTo(before, 0);
  await expect(page.locator(".ui-sheet")).toHaveCount(1);
});

test("a drag that is let go half way springs back smoothly: never lower than it was let go, and no replayed entrance", async ({
  page,
}) => {
  await openSheet(page);
  const before = await rest(page);
  const cdp = await page.context().newCDPSession(page);
  const at = await center(page, ".ui-grab");
  const touch = (type: "touchStart" | "touchMove" | "touchEnd", y: number) =>
    cdp.send("Input.dispatchTouchEvent", {
      type,
      touchPoints: type === "touchEnd" ? [] : [{ x: at.x, y }],
    });
  await touch("touchStart", at.y);
  for (let step = 1; step <= 8; step++) {
    await touch("touchMove", at.y + step * 12);
    await page.waitForTimeout(16);
  }
  // Held still, so it is not a flick.
  await page.waitForTimeout(300);
  const letGo = await rest(page);
  expect(letGo).toBeGreaterThan(before + 90);
  await record(page, true);
  await touch("touchEnd", at.y + 96);
  await page.waitForTimeout(900);
  await record(page, false);
  const all = await frames(page);
  expect(entranceFrames(all)).toBe(0);
  // Every frame after the release is between the resting place and where the finger let go, and never moves back down.
  let previous = Number.POSITIVE_INFINITY;
  for (const frame of all) {
    if (!("top" in frame)) continue;
    expect(frame.top).toBeLessThanOrEqual(letGo + 1);
    expect(frame.top).toBeGreaterThanOrEqual(before - 1);
    expect(frame.top).toBeLessThanOrEqual(previous + 0.5);
    previous = frame.top;
  }
  expect(await rest(page)).toBeCloseTo(before, 0);
  // Nothing of the drag is left on the sheet (its `animation: none` stays on purpose: the entrance is over).
  const left = await page.locator(".ui-sheet").evaluate((node) => ({
    transform: (node as HTMLElement).style.transform,
    transition: (node as HTMLElement).style.transition,
  }));
  expect(left).toEqual({ transform: "", transition: "" });
});

test("a finger put down on the handle while the sheet is still sliding in takes it over at once", async ({
  page,
}) => {
  // A slow entrance, so the press lands inside it on any machine.
  await page.addInitScript(() => {
    document.addEventListener("DOMContentLoaded", () => {
      const style = document.createElement("style");
      style.textContent = ".ui-sheet { animation-duration: 3s !important; }";
      document.head.append(style);
    });
  });
  await page.route(/\/api\/v1\/me$/, (route) =>
    route.fulfill({
      json: {
        id: adminId,
        name: "Sam",
        email: "sam@example.com",
        isAdmin: true,
        mustChangePassword: false,
        twoFactorEnabled: true,
      },
    }),
  );
  await page.route(/\/api\/v1\/users$/, (route) =>
    route.fulfill({
      json: {
        items: [
          person({
            id: adminId,
            name: "Sam",
            email: "sam@example.com",
            isAdmin: true,
          }),
          person(),
        ],
      },
    }),
  );
  await page.route(/\/api\/v1\/users\/deleted$/, (route) =>
    route.fulfill({ json: { items: [] } }),
  );
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await signIn(page);
  await page.goto("/users");
  await page.waitForFunction(
    () => getComputedStyle(document.body).containerType === "inline-size",
  );
  await page.locator(".us-page .ui-row", { hasText: "Jordan" }).tap();
  await expect(page.locator(".ui-sheet")).toBeVisible();
  // The control: the entrance really is still running when the finger goes down.
  expect(
    await page.evaluate(
      () => document.querySelector(".ui-sheet")?.getAnimations().length,
    ),
  ).toBeGreaterThan(0);
  const cdp = await page.context().newCDPSession(page);
  const at = await center(page, ".ui-grab");
  // Where the sheet comes to rest: its bottom is the screen's bottom.
  const restTop = await page.evaluate(
    () =>
      innerHeight -
      (document.querySelector(".ui-sheet") as HTMLElement).offsetHeight,
  );
  const touch = (type: "touchStart" | "touchMove" | "touchEnd", y: number) =>
    cdp.send("Input.dispatchTouchEvent", {
      type,
      touchPoints: type === "touchEnd" ? [] : [{ x: at.x, y }],
    });
  await touch("touchStart", at.y);
  for (let step = 1; step <= 6; step++) {
    await touch("touchMove", at.y + step * 10);
    await page.waitForTimeout(16);
  }
  // It follows the finger: 60 px below its resting place, though the entrance was still running.
  expect(Math.abs((await rest(page)) - (restTop + 60))).toBeLessThanOrEqual(3);
  expect(
    await page.evaluate(
      () => document.querySelector(".ui-sheet")?.getAnimations().length,
    ),
  ).toBe(0);
  await touch("touchEnd", at.y + 60);
});

test("the keyboard opening and closing (the viewport changing) never replays the entrance", async ({
  page,
}) => {
  await openSheet(page);
  await page.locator(".ui-sheet").getByRole("button").first().focus();
  await record(page, true);
  await page.setViewportSize({ width: 412, height: 560 });
  await page.waitForTimeout(400);
  await page.setViewportSize({ width: 412, height: 915 });
  await page.waitForTimeout(600);
  await record(page, false);
  expect(entranceFrames(await frames(page))).toBe(0);
  await expect(page.locator(".ui-sheet")).toHaveCount(1);
});
