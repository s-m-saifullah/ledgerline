import { expect, type Page, test } from "@playwright/test";
import { newId } from "../../packages/shared/src/index";
import {
  connectLocalDatabase,
  createOwnerLedger,
  prepareBrowser,
} from "./ledger-setup";
import { signIn } from "./sign-in";

// The page frame (`ui-page` in layout.css, docs/STYLE_GUIDE.md): every page sits inside one `main` with the same
// padding, which steps at the container's 700 and 1100 px, and a toast leaves room under the page to scroll past it.
const { env, pool } = connectLocalDatabase("Page frame browser tests");
const fixtures: string[] = [];
test.beforeEach(async ({ page }, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop",
    "one project is enough: these tests set their own widths",
  );
  const ledgerId = newId();
  fixtures.push(ledgerId);
  await createOwnerLedger(pool, env, ledgerId, "E2E page frame ledger");
  await prepareBrowser(page, testInfo, {
    ledgerId,
    name: "Synthetic page frame ledger",
    forwarded: [230, 10],
  });
});
test.afterEach(async () => {
  for (const id of fixtures) {
    await pool.query(
      "UPDATE ledger_members SET deleted_at=now(), updated_at=now() WHERE ledger_id=$1",
      [id],
    );
    await pool.query(
      "UPDATE ledgers SET deleted_at=now(), updated_at=now() WHERE id=$1 AND name LIKE 'E2E page frame ledger%'",
      [id],
    );
  }
  fixtures.length = 0;
});
test.afterAll(async () => {
  await pool.end();
});

async function open(page: Page, width: number, path: string) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width, height: 900 });
  await signIn(page);
  await page.goto(path);
  await page.waitForFunction(
    () => getComputedStyle(document.body).containerType === "inline-size",
  );
  await expect(page.locator("main")).toBeAttached();
}
const frame = (page: Page) =>
  page.locator("main").evaluate((main) => {
    const style = getComputedStyle(main);
    return {
      frame: main.classList.contains("ui-page"),
      id: main.id,
      padding: [
        style.paddingTop,
        style.paddingRight,
        style.paddingBottom,
        style.paddingLeft,
      ].join(" "),
      maxWidth: style.maxWidth,
    };
  });

// Top, right, bottom and left: a phone, a tablet from 700 px and a desktop from 1100 px.
const steps = [
  [320, "28px 20px 28px 20px"],
  [390, "28px 20px 28px 20px"],
  [699, "28px 20px 28px 20px"],
  [700, "32px 32px 32px 32px"],
  [1099, "32px 32px 32px 32px"],
  [1100, "48px 48px 48px 48px"],
] as const;

for (const [width, padding] of steps) {
  test(`the page frame has ${padding} at ${width} px`, async ({ page }) => {
    await open(page, width, "/more");
    // A page may swap its loading `main` for the real one; read it until it settles.
    await expect
      .poll(() => frame(page).catch(() => null))
      .toEqual({
        frame: true,
        id: "main-content",
        padding,
        maxWidth: "1180px",
      });
  });
}

// A toast is fixed to the corner, so the page gains room at its foot to scroll the last row past it.
for (const [width, one, client, both] of [
  [390, "300px", "360px", "540px"],
  [1280, "280px", "280px", "280px"],
] as const) {
  test(`the page leaves room under a toast at ${width} px`, async ({
    page,
  }) => {
    await open(page, width, "/more");
    const bottom = () =>
      page
        .locator("main")
        .evaluate((main) => getComputedStyle(main).paddingBottom);
    const add = (classes: string) =>
      page.evaluate((names) => {
        const toast = document.createElement("div");
        toast.className = names;
        toast.dataset.probe = "true";
        document.body.append(toast);
      }, classes);
    const clear = () =>
      page.evaluate(() => {
        for (const probe of Array.from(
          document.querySelectorAll("[data-probe]"),
        ))
          probe.remove();
      });
    await add("transaction-toast");
    await expect.poll(bottom, { message: "a transaction toast" }).toBe(one);
    await clear();
    await add("transaction-toast client-toast");
    await expect.poll(bottom, { message: "a client toast" }).toBe(client);
    await add("transaction-toast");
    await expect.poll(bottom, { message: "both" }).toBe(both);
  });
}
