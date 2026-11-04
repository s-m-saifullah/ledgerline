import { expect, type Locator, type Page, test } from "@playwright/test";
import { newId } from "../../packages/shared/src/index";
import {
  connectLocalDatabase,
  createOwnerLedger,
  prepareBrowser,
} from "./ledger-setup";
import { signIn } from "./sign-in";

// The sheet's gestures on a phone, in a real browser (jsdom has no touch, scrolling or container queries): the grab
// handle closes a sheet when tapped, a sheet follows a finger dragged down from its handle or title bar and closes
// past a threshold or springs back, and nothing behind a sheet scrolls while it is open. A drawer (700 px and up) and a
// question have neither. Tags are mocked, so the owner's ledger is never changed.
const { env, pool } = connectLocalDatabase("Sheet gesture browser tests");
const fixtures: string[] = [];
test.beforeEach(async ({ page }, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop",
    "one project is enough: these tests set their own widths",
  );
  const ledgerId = newId();
  fixtures.push(ledgerId);
  await createOwnerLedger(pool, env, ledgerId, "E2E sheet gesture ledger");
  await prepareBrowser(page, testInfo, {
    ledgerId,
    name: "Synthetic sheet gesture ledger",
    forwarded: [232, 41],
  });
});
test.afterEach(async () => {
  for (const id of fixtures) {
    await pool.query(
      "UPDATE ledger_members SET deleted_at=now(), updated_at=now() WHERE ledger_id=$1",
      [id],
    );
    await pool.query(
      "UPDATE ledgers SET deleted_at=now(), updated_at=now() WHERE id=$1 AND name LIKE 'E2E sheet gesture ledger%'",
      [id],
    );
  }
  fixtures.length = 0;
});
test.afterAll(async () => {
  await pool.end();
});

const stamp = "2026-10-01T00:00:00.000Z";
const uuid = (n: number) =>
  `01a1a000-0000-7000-8000-${String(n).padStart(12, "0")}`;
// Enough tags that the page behind the sheet is taller than the phone and can scroll.
const tags = Array.from({ length: 40 }, (_, n) => ({
  id: uuid(100 + n),
  ledgerId: uuid(1),
  name: `Tag ${String(n).padStart(2, "0")}`,
  archivedAt: null,
  usageCount: n % 4,
  version: 1,
  createdAt: stamp,
  updatedAt: stamp,
}));

async function open(page: Page, width: number, height = 640) {
  await page.setViewportSize({ width, height });
  await signIn(page);
  await page.route(/\/tags\?/, (route) =>
    route.fulfill({ json: { items: tags, nextCursor: null } }),
  );
  await page.goto("/tags");
  await page.waitForFunction(
    () => getComputedStyle(document.body).containerType === "inline-size",
  );
  await expect(page.locator(".tg-row").first()).toBeVisible();
}
const sheet = (page: Page) => page.locator(".ui-sheet");
const box = async (locator: Locator) => {
  const found = await locator.boundingBox();
  if (!found) throw new Error("not on screen");
  return found;
};
/** A box that has stopped moving: a sheet slides in, so two reads in a row must agree. */
async function settled(locator: Locator) {
  let last = await box(locator);
  for (let tries = 0; tries < 40; tries++) {
    await locator.page().waitForTimeout(60);
    const next = await box(locator);
    if (Math.abs(next.y - last.y) < 0.5 && Math.abs(next.x - last.x) < 0.5)
      return next;
    last = next;
  }
  throw new Error("never settled");
}
async function openSheet(page: Page) {
  await page.locator("#mobile-add-page").click();
  await expect(sheet(page)).toBeVisible();
  return settled(sheet(page));
}
const scrolled = (page: Page) => page.evaluate(() => scrollY);

/** A finger, sent as real touch events so the browser decides what is a scroll and what is a drag. */
async function finger(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  // Without this a headless browser on a CI runner may take a synthesized touch scroll for nothing at all.
  await cdp.send("Emulation.setTouchEmulationEnabled", {
    enabled: true,
    maxTouchPoints: 1,
  });
  const send = (
    type: "touchStart" | "touchMove" | "touchEnd" | "touchCancel",
    x?: number,
    y?: number,
  ) =>
    cdp.send("Input.dispatchTouchEvent", {
      type,
      touchPoints:
        type === "touchEnd" || type === "touchCancel"
          ? []
          : [{ x: x ?? 0, y: y ?? 0 }],
    });
  return {
    /** Puts a finger down at a point and drags it by `dy`, in `steps` moves; releases unless asked to hold. */
    async drag(
      from: { x: number; y: number },
      dy: number,
      { steps = 8, hold = false, pause = 12 } = {},
    ) {
      await send("touchStart", from.x, from.y);
      for (let step = 1; step <= steps; step++) {
        await send("touchMove", from.x, from.y + (dy * step) / steps);
        await page.waitForTimeout(pause);
      }
      if (!hold) await send("touchEnd");
    },
    release: () => send("touchEnd"),
    /** The system takes the touch away (a call, a gesture of its own): it must never close the sheet. */
    cancel: () => send("touchCancel"),
    /** A browser-made scroll gesture: what a thumb does to a page. */
    scroll: (x: number, y: number, dy: number) =>
      cdp.send("Input.synthesizeScrollGesture", {
        x,
        y,
        yDistance: -dy,
        gestureSourceType: "touch",
        speed: 1200,
      }),
  };
}
const centre = (b: {
  x: number;
  y: number;
  width: number;
  height: number;
}) => ({
  x: b.x + b.width / 2,
  y: b.y + b.height / 2,
});

test("the page behind a sheet does not scroll, by wheel or by finger, over the dimmed page or over any part of the sheet", async ({
  page,
}) => {
  await open(page, 390);
  const touch = await finger(page);
  // Control: with no sheet open a finger does scroll this page, so "it did not move" below means something.
  await touch.scroll(200, 400, 250);
  await expect.poll(() => scrolled(page)).toBeGreaterThan(100);
  await page.evaluate(() => scrollTo(0, 300));
  const before = await scrolled(page);
  expect(before).toBeGreaterThan(100);
  const at = await openSheet(page);
  const x = at.x + at.width / 2;
  const places: [string, number, number][] = [
    ["the dimmed page", 200, 40],
    ["the handle", x, at.y + 12],
    ["the title bar", x, at.y + 40],
    ["the body", x, at.y + 90],
    ["the footer", x, at.y + at.height - 30],
  ];
  for (const [name, px, py] of places) {
    await page.mouse.move(px, py);
    await page.mouse.wheel(0, 500);
    await page.waitForTimeout(150);
    expect(await scrolled(page), `wheel over ${name}`).toBe(before);
    await touch.scroll(px, py, 500);
    await page.waitForTimeout(250);
    expect(await scrolled(page), `finger over ${name}`).toBe(before);
  }
  // The page is where it was, and it scrolls again once the sheet is shut.
  await page.keyboard.press("Escape");
  await expect(sheet(page)).toBeHidden();
  expect(await scrolled(page), "after Escape").toBe(before);
  await page.mouse.move(200, 300);
  await page.mouse.wheel(0, 300);
  await expect.poll(() => scrolled(page)).toBeGreaterThan(before);
});

test("a sheet with more in it than fits scrolls inside itself, and the page behind still does not move", async ({
  page,
}) => {
  await open(page, 390, 420);
  await page.evaluate(() => scrollTo(0, 300));
  const before = await scrolled(page);
  const at = await openSheet(page);
  // Make the sheet's body taller than the sheet, as a long form is on a small phone.
  await page.evaluate(() => {
    const body = document.querySelector(".ui-sheet-body");
    const filler = document.createElement("div");
    filler.id = "filler";
    filler.style.height = "900px";
    body?.append(filler);
  });
  const grown = await settled(sheet(page));
  expect(grown.height).toBeGreaterThan(at.height);
  const body = sheet(page).locator(".ui-sheet-body");
  const touch = await finger(page);
  await touch.scroll(
    grown.x + grown.width / 2,
    grown.y + grown.height / 2,
    400,
  );
  await expect
    .poll(() => body.evaluate((node) => node.scrollTop))
    .toBeGreaterThan(50);
  // Pushed past its end, it does not hand the rest of the movement to the page.
  await touch.scroll(
    grown.x + grown.width / 2,
    grown.y + grown.height / 2,
    2000,
  );
  await touch.scroll(
    grown.x + grown.width / 2,
    grown.y + grown.height / 2,
    2000,
  );
  await page.waitForTimeout(250);
  await page.mouse.move(grown.x + grown.width / 2, grown.y + grown.height / 2);
  await page.mouse.wheel(0, 2000);
  await page.waitForTimeout(250);
  expect(await scrolled(page)).toBe(before);
  // Scrolling the body did not drag the sheet or close it.
  await expect(sheet(page)).toBeVisible();
  expect((await box(sheet(page))).y).toBeCloseTo(grown.y, 0);
});

test("tapping the grab handle closes the sheet", async ({ page }) => {
  await open(page, 390);
  await openSheet(page);
  await page.locator(".ui-grab").click();
  await expect(sheet(page)).toBeHidden();
});

test("the handle is a real target: a tap a little to either side of the bar still lands on it", async ({
  page,
}) => {
  await open(page, 390);
  await openSheet(page);
  const handle = await box(page.locator(".ui-grab"));
  expect(handle.height).toBeGreaterThanOrEqual(24);
  expect(handle.width).toBeGreaterThanOrEqual(120);
  // Not hidden from the keyboard's way out: Cancel and Escape still close it.
  await expect(
    sheet(page).getByRole("button", { name: "Cancel" }),
  ).toBeVisible();
});

test("a finger dragged down from the handle moves the sheet with it, and a long drag closes it", async ({
  page,
}) => {
  await open(page, 390);
  const at = await openSheet(page);
  const touch = await finger(page);
  const grab = centre(await box(page.locator(".ui-grab")));
  await touch.drag(grab, 90, { hold: true, pause: 40 });
  // It followed the finger: down by about the distance dragged, and the dimmed page is still there.
  const during = await box(sheet(page));
  expect(during.y - at.y).toBeGreaterThan(70);
  expect(during.y - at.y).toBeLessThan(110);
  await touch.release();
  // 90 px of a short sheet is under a third of it: it springs back.
  await expect(sheet(page)).toBeVisible();
  const back = await settled(sheet(page));
  expect(back.y).toBeCloseTo(at.y, 0);
  // A long drag closes it.
  await touch.drag(grab, Math.round(at.height * 0.7));
  await expect(sheet(page)).toBeHidden();
});

test("a quick flick down closes the sheet even when it is short", async ({
  page,
}) => {
  await open(page, 390);
  await openSheet(page);
  const touch = await finger(page);
  const grab = centre(await box(page.locator(".ui-grab")));
  await touch.drag(grab, 70, { steps: 3, pause: 0 });
  await expect(sheet(page)).toBeHidden();
});

test("the title bar drags the sheet too, but the body and an upward drag do not", async ({
  page,
}) => {
  await open(page, 390);
  const at = await openSheet(page);
  const touch = await finger(page);
  const bar = centre(await box(sheet(page).locator(".ui-sheet-title")));
  // Upward from the title bar: the sheet stays at its place.
  await touch.drag(bar, -80, { hold: true });
  expect((await box(sheet(page))).y).toBeCloseTo(at.y, 0);
  await touch.release();
  // Down from the title bar follows the finger.
  await touch.drag(bar, 70, { hold: true, steps: 2, pause: 0 });
  // Long enough for the spring-back that is still finishing from the drag before to have run its clean-up.
  await page.waitForTimeout(400);
  expect((await box(sheet(page))).y - at.y).toBeGreaterThan(55);
  // The finger stopped before it lifted, so this is not a flick: the sheet springs back.
  await touch.release();
  await expect(sheet(page)).toBeVisible();
  const back = await settled(sheet(page));
  expect(back.y).toBeCloseTo(at.y, 0);
  // Down from the body: not a drag of the sheet.
  const body = centre(await box(sheet(page).locator(".ui-sheet-body")));
  await touch.drag(body, Math.round(at.height * 0.8));
  await page.waitForTimeout(300);
  await expect(sheet(page)).toBeVisible();
  expect((await box(sheet(page))).y).toBeCloseTo(at.y, 0);
});

test("a drag over the Cancel button does not start a drag, and Cancel still works", async ({
  page,
}) => {
  await open(page, 390);
  await openSheet(page);
  await sheet(page).getByRole("button", { name: "Cancel" }).click();
  await expect(sheet(page)).toBeHidden();
});

test("a touch the system cancels mid-drag never closes the sheet: it springs back", async ({
  page,
}) => {
  await open(page, 390);
  const at = await openSheet(page);
  const touch = await finger(page);
  const grab = centre(await box(page.locator(".ui-grab")));
  await touch.drag(grab, Math.round(at.height * 0.8), { hold: true });
  expect((await box(sheet(page))).y - at.y).toBeGreaterThan(at.height * 0.6);
  await touch.cancel();
  await expect(sheet(page)).toBeVisible();
  expect((await settled(sheet(page))).y).toBeCloseTo(at.y, 0);
});

test("a short mouse drag that ends on the handle springs back; the click after it is not a tap", async ({
  page,
}) => {
  await open(page, 390);
  const at = await openSheet(page);
  const grab = centre(await box(page.locator(".ui-grab")));
  await page.mouse.move(grab.x, grab.y);
  await page.mouse.down();
  await page.mouse.move(grab.x, grab.y + 30, { steps: 6 });
  await page.waitForTimeout(200);
  await page.mouse.up();
  await page.waitForTimeout(400);
  await expect(sheet(page)).toBeVisible();
  expect((await settled(sheet(page))).y).toBeCloseTo(at.y, 0);
  // A plain click on the handle afterwards still closes it.
  await page.locator(".ui-grab").click();
  await expect(sheet(page)).toBeHidden();
});

test("a mouse can drag the sheet from the handle too", async ({ page }) => {
  await open(page, 390);
  const at = await openSheet(page);
  const grab = centre(await box(page.locator(".ui-grab")));
  await page.mouse.move(grab.x, grab.y);
  await page.mouse.down();
  await page.mouse.move(grab.x, grab.y + 60, { steps: 6 });
  expect((await box(sheet(page))).y - at.y).toBeGreaterThan(40);
  await page.mouse.move(grab.x, grab.y + at.height, { steps: 8 });
  await page.mouse.up();
  await expect(sheet(page)).toBeHidden();
});

test("from 700 px a sheet is a drawer: no handle, and a drag on its title bar moves nothing", async ({
  page,
}) => {
  await open(page, 1280, 800);
  await page.locator("#add-tag").click();
  await expect(sheet(page)).toBeVisible();
  const at = await settled(sheet(page));
  await expect(page.locator(".ui-grab")).toBeHidden();
  const bar = centre(await box(sheet(page).locator(".ui-sheet-title")));
  await page.mouse.move(bar.x, bar.y);
  await page.mouse.down();
  await page.mouse.move(bar.x + 200, bar.y + 300, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  await expect(sheet(page)).toBeVisible();
  const after = await box(sheet(page));
  expect(after.x).toBeCloseTo(at.x, 0);
  expect(after.y).toBeCloseTo(at.y, 0);
});

test("the page behind a drawer does not scroll either", async ({ page }) => {
  await open(page, 1280, 500);
  await page.evaluate(() => scrollTo(0, 200));
  const before = await scrolled(page);
  expect(before).toBeGreaterThan(50);
  // The button is at the top of the page: click it from the page, as a click would not move the page.
  await page.evaluate(() => document.getElementById("add-tag")?.click());
  await expect(sheet(page)).toBeVisible();
  expect(await scrolled(page)).toBe(before);
  await page.mouse.move(300, 250);
  await page.mouse.wheel(0, 500);
  await page.waitForTimeout(200);
  expect(await scrolled(page)).toBe(before);
});

test("while a save is in flight a tap or a drag on the handle does nothing", async ({
  page,
}) => {
  await open(page, 390);
  await openSheet(page);
  const touch = await finger(page);
  const grab = centre(await box(page.locator(".ui-grab")));
  await page.route(/\/tags$/, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await route.fulfill({
      status: 201,
      json: { ...tags[0], id: uuid(900), name: "Slow tag" },
    });
  });
  await sheet(page).locator("input").first().fill("Slow tag");
  await sheet(page).locator(".ui-sheet-foot .ui-btn-primary").click();
  await touch.drag(grab, 400);
  await page.locator(".ui-grab").click({ force: true });
  await page.waitForTimeout(300);
  await expect(sheet(page)).toBeVisible();
  // It is not stuck: when the save has finished the sheet closes by itself.
  await expect(sheet(page)).toBeHidden({ timeout: 5000 });
});

test("a question, a centred dialog, has no handle and does not move", async ({
  page,
}) => {
  await open(page, 390);
  // Delete asks a question; tags in use cannot be deleted, so open the unused one ("Tag 00" has no entries).
  await page.getByRole("button", { name: /^Tag 00 0 entr/ }).click();
  await expect(sheet(page)).toBeVisible();
  await settled(sheet(page));
  await sheet(page)
    .getByRole("button", { name: "Delete", exact: true })
    .click();
  const question = page.getByRole("dialog", { name: "Delete Tag 00?" });
  await expect(question).toBeVisible();
  const at = await settled(question);
  expect(await question.locator(".ui-grab").count()).toBe(0);
  const touch = await finger(page);
  await touch.drag(centre(at), 200);
  await page.waitForTimeout(300);
  await expect(question).toBeVisible();
  const after = await box(question);
  expect(after.y).toBeCloseTo(at.y, 0);
});
