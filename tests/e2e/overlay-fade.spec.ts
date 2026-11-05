import { expect, type Page, test } from "@playwright/test";
import { newId } from "../../packages/shared/src/index";
import {
  connectLocalDatabase,
  createOwnerLedger,
  prepareBrowser,
} from "./ledger-setup";
import { signIn } from "./sign-in";

// The dark overlay behind a sheet, a drawer or a question fades in and out instead of switching on and off. jsdom has no
// animation, so the frames are recorded one by one in a real browser, with motion on, and with it off.
const { env, pool } = connectLocalDatabase("Overlay fade browser tests");
const fixtures: string[] = [];
test.beforeEach(async ({ page }, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop",
    "one project is enough: these tests set their own width",
  );
  const ledgerId = newId();
  fixtures.push(ledgerId);
  await createOwnerLedger(pool, env, ledgerId, "E2E overlay fade ledger");
  await prepareBrowser(page, testInfo, {
    ledgerId,
    name: "Synthetic overlay fade ledger",
    forwarded: [170, 5],
  });
});
test.afterEach(async () => {
  for (const id of fixtures) {
    await pool.query(
      "UPDATE ledger_members SET deleted_at=now(), updated_at=now() WHERE ledger_id=$1",
      [id],
    );
    await pool.query(
      "UPDATE ledgers SET deleted_at=now(), updated_at=now() WHERE id=$1 AND name LIKE 'E2E overlay fade ledger%'",
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

type Frame = {
  scrims: number;
  sheets: number;
  opacity: number;
  pointerEvents: string;
  // The copy of the sheet that is leaving.
  outs: number;
  outTop: number;
  outLeft: number;
  outOpacity: number;
  outPointerEvents: string;
  outValue: string;
};
async function openUsers(page: Page, motion: boolean, width = 390) {
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
          person({ name: "Riley Park", email: "riley@example.com" }),
        ],
      },
    }),
  );
  await page.route(/\/api\/v1\/users\/deleted$/, (route) =>
    route.fulfill({ json: { items: [] } }),
  );
  await page.emulateMedia({
    reducedMotion: motion ? "no-preference" : "reduce",
  });
  await page.setViewportSize({ width, height: 844 });
  await signIn(page);
  await page.goto("/users");
  await page.waitForFunction(
    () => getComputedStyle(document.body).containerType === "inline-size",
  );
  await page.evaluate(() => {
    const w = window as unknown as {
      __rec: { frames: unknown[]; on: boolean };
    };
    w.__rec = { frames: [], on: false };
    const loop = () => {
      if (w.__rec.on) {
        const scrim = document.querySelector(".ui-scrim");
        const out = document.querySelector(".ui-sheet-out");
        const outBox = out?.getBoundingClientRect();
        w.__rec.frames.push({
          outs: document.querySelectorAll(".ui-sheet-out").length,
          outTop: outBox?.top ?? -1,
          outLeft: outBox?.left ?? -1,
          outOpacity: out ? Number(getComputedStyle(out).opacity) : -1,
          outPointerEvents: out ? getComputedStyle(out).pointerEvents : "",
          outValue: out?.querySelector("input")?.value ?? "",
          scrims: document.querySelectorAll(".ui-scrim").length,
          sheets: document.querySelectorAll(".ui-sheet").length,
          opacity: scrim ? Number(getComputedStyle(scrim).opacity) : -1,
          pointerEvents: scrim ? getComputedStyle(scrim).pointerEvents : "",
        });
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
    () => (window as unknown as { __rec: { frames: Frame[] } }).__rec.frames,
  );
const between = (all: Frame[]) =>
  all.filter(
    (frame) => frame.scrims > 0 && frame.opacity > 0.03 && frame.opacity < 0.97,
  );

test("the dark overlay fades in over a number of frames when a sheet opens", async ({
  page,
}) => {
  await openUsers(page, true);
  await record(page, true);
  await page.locator(".us-page .ui-row", { hasText: "Jordan" }).click();
  await expect(page.locator(".ui-sheet")).toBeVisible();
  await page.waitForTimeout(500);
  await record(page, false);
  const all = await frames(page);
  expect(between(all).length).toBeGreaterThanOrEqual(3);
  expect(all.at(-1)?.opacity).toBeCloseTo(1, 1);
  // Opening leaves no stray copy of a sheet or of the dark overlay (development runs in StrictMode, which sets an effect up,
  // tears it down and sets it up again at once), and there is one dark overlay at a time.
  expect(all.filter((frame) => frame.outs > 0)).toEqual([]);
  expect(Math.max(...all.map((frame) => frame.scrims))).toBe(1);
  // It only ever gets darker while opening.
  const seen = all.filter((frame) => frame.scrims > 0).map((f) => f.opacity);
  for (let index = 1; index < seen.length; index++)
    expect(seen[index] as number).toBeGreaterThanOrEqual(
      (seen[index - 1] as number) - 0.02,
    );
});

test("it fades out after the sheet has closed, lets taps through meanwhile, and is then removed", async ({
  page,
}) => {
  await openUsers(page, true);
  await page.locator(".us-page .ui-row", { hasText: "Jordan" }).click();
  await expect(page.locator(".ui-sheet")).toBeVisible();
  await page.waitForTimeout(500);
  await record(page, true);
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.locator(".ui-sheet")).toHaveCount(0);
  await page.waitForTimeout(700);
  await record(page, false);
  const all = await frames(page);
  // After the sheet is gone the overlay is still there, getting lighter frame by frame, until it is removed.
  const fading = all.filter(
    (frame) => frame.sheets === 0 && frame.scrims > 0 && frame.opacity > 0.03,
  );
  expect(fading.length).toBeGreaterThanOrEqual(3);
  for (let index = 1; index < fading.length; index++)
    expect((fading[index] as Frame).opacity).toBeLessThanOrEqual(
      (fading[index - 1] as Frame).opacity + 0.02,
    );
  // It does not block the page while it goes.
  for (const frame of fading) expect(frame.pointerEvents).toBe("none");
  expect(all.at(-1)?.scrims).toBe(0);
});

test("with reduced motion the overlay switches on and off without a fade", async ({
  page,
}) => {
  await openUsers(page, false);
  await record(page, true);
  await page.locator(".us-page .ui-row", { hasText: "Jordan" }).click();
  await expect(page.locator(".ui-sheet")).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.locator(".ui-sheet")).toHaveCount(0);
  await page.waitForTimeout(500);
  await record(page, false);
  const all = await frames(page);
  expect(between(all)).toEqual([]);
  expect(all.at(-1)?.scrims).toBe(0);
  // No frame shows the overlay without the sheet after it has closed.
  const opened = all.findIndex((frame) => frame.sheets > 0);
  const lingering = all
    .slice(opened)
    .filter(
      (frame, index, rest) =>
        frame.sheets === 0 &&
        frame.scrims > 0 &&
        rest.slice(0, index).some((earlier) => earlier.sheets > 0),
    );
  expect(lingering).toEqual([]);
});

for (const [width, axis] of [
  [390, "down"],
  [1280, "right"],
] as const)
  test(`at ${width} px the sheet slides ${axis} and fades as it closes, under its own class, and lets taps through`, async ({
    page,
  }) => {
    await openUsers(page, true, width);
    await page.locator(".us-page .ui-row", { hasText: "Jordan" }).click();
    await expect(page.locator(".ui-sheet")).toBeVisible();
    await page.waitForTimeout(500);
    await record(page, true);
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page.locator(".ui-sheet")).toHaveCount(0);
    await page.waitForTimeout(700);
    await record(page, false);
    const all = await frames(page);
    const leaving = all.filter((frame) => frame.outs > 0);
    expect(leaving.length).toBeGreaterThanOrEqual(3);
    // It only ever moves further out and gets lighter; it never is the open sheet.
    for (let index = 1; index < leaving.length; index++) {
      const now = leaving[index] as Frame;
      const before = leaving[index - 1] as Frame;
      expect(now.outOpacity).toBeLessThanOrEqual(before.outOpacity + 0.02);
      if (axis === "down")
        expect(now.outTop).toBeGreaterThanOrEqual(before.outTop - 0.5);
      else expect(now.outLeft).toBeGreaterThanOrEqual(before.outLeft - 0.5);
    }
    const first = leaving[0] as Frame;
    const last = leaving.at(-1) as Frame;
    expect(last.outOpacity).toBeLessThan(first.outOpacity);
    if (axis === "down") expect(last.outTop).toBeGreaterThan(first.outTop + 5);
    else expect(last.outLeft).toBeGreaterThan(first.outLeft + 5);
    for (const frame of leaving) expect(frame.outPointerEvents).toBe("none");
    // A sheet is only ever the open one: the leaving copy is not found where the open sheet is looked for.
    expect(all.filter((frame) => frame.sheets > 0 && frame.outs > 0)).toEqual(
      [],
    );
    expect(all.at(-1)?.outs).toBe(0);
    expect(all.at(-1)?.scrims).toBe(0);
  });

test("a sheet opened straight after another closed is the only open sheet, and the page can be pressed at once", async ({
  page,
}) => {
  await openUsers(page, true);
  await page.locator(".us-page .ui-row", { hasText: "Jordan" }).click();
  await expect(page.locator(".ui-sheet")).toBeVisible();
  await page.waitForTimeout(500);
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.locator(".ui-sheet")).toHaveCount(0);
  // The old one is still sliding away: a row underneath takes the press, and there is exactly one open sheet.
  await page.locator(".us-page .ui-row", { hasText: "Riley" }).click();
  await expect(page.locator(".ui-sheet")).toHaveCount(1);
  await expect(page.locator(".ui-sheet")).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(1);
  await expect(page.getByRole("dialog")).toHaveAccessibleName("Riley Park");
});

test("with reduced motion no copy of the sheet is ever left", async ({
  page,
}) => {
  await openUsers(page, false);
  await record(page, true);
  await page.locator(".us-page .ui-row", { hasText: "Jordan" }).click();
  await expect(page.locator(".ui-sheet")).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.locator(".ui-sheet")).toHaveCount(0);
  await page.waitForTimeout(500);
  await record(page, false);
  expect((await frames(page)).filter((frame) => frame.outs > 0)).toEqual([]);
});

test("a question closed in place fades out, the page behind it is usable at that very moment, and the sheet under it is untouched", async ({
  page,
}) => {
  await openUsers(page, true);
  await page.locator(".us-page .ui-row", { hasText: "Jordan" }).click();
  await expect(page.locator(".ui-sheet")).toBeVisible();
  await page.getByRole("button", { name: /Sign out their devices/ }).click();
  const question = page.locator(".ui-question");
  await expect(question).toBeVisible();
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    const w = window as unknown as { __q: number[] };
    w.__q = [];
    const loop = () => {
      const node = document.querySelector(".ui-question-out");
      if (node) w.__q.push(Number(getComputedStyle(node).opacity));
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  });
  await question.getByRole("button", { name: "Cancel" }).click();
  // At once: no question in the page, and the sheet below is reachable (it is not still hidden or locked).
  await expect(question).toHaveCount(0);
  expect(
    await page.getByRole("dialog", { name: "Jordan Lee" }).isVisible(),
  ).toBe(true);
  await page.waitForTimeout(400);
  const opacities = await page.evaluate(
    () => (window as unknown as { __q: number[] }).__q,
  );
  expect(
    opacities.filter((value) => value > 0.03 && value < 0.97).length,
  ).toBeGreaterThanOrEqual(2);
  // It starts as the question was and only ever gets lighter (a fade IN would start near 0 and rise).
  expect(opacities[0]).toBeGreaterThan(0.85);
  for (let index = 1; index < opacities.length; index++)
    expect(opacities[index] as number).toBeLessThanOrEqual(
      (opacities[index - 1] as number) + 0.02,
    );
  await expect(page.locator(".ui-question-out")).toHaveCount(0);
  await expect(page.locator(".ui-sheet")).toHaveCount(1);
});

test("the sheet that slides away still shows what was typed in it", async ({
  page,
}) => {
  await openUsers(page, true);
  await page.locator("#mobile-add-page").click();
  await expect(page.locator(".ui-sheet")).toBeVisible();
  await page.getByLabel("Name", { exact: true }).fill("Avery Stone");
  await page.waitForTimeout(400);
  await record(page, true);
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.locator(".ui-sheet")).toHaveCount(0);
  await page.waitForTimeout(500);
  await record(page, false);
  const values = (await frames(page))
    .filter((frame) => frame.outs > 0)
    .map((frame) => frame.outValue);
  expect(values.length).toBeGreaterThanOrEqual(3);
  expect(values.every((value) => value === "Avery Stone")).toBe(true);
});
