import { expect, type Locator, type Page, test } from "@playwright/test";
import { newId } from "../../packages/shared/src/index";
import {
  connectLocalDatabase,
  createOwnerLedger,
  prepareBrowser,
} from "./ledger-setup";
import { signIn } from "./sign-in";
import { setTheme } from "./theme";

// An overlay opened from another one (a question from a sheet, a picker from an editor) must dim what is beneath it.
// The stylesheet used to put every overlay on the same two layers, so the sheet below was drawn over the dark layer of
// the question and looked as bright as before. Hit testing cannot tell (Radix switches pointer events off on the lower
// sheet while another is open), so this looks at what is drawn: how light a strip of the sheet's head is before and
// after the second overlay opens.
const { env, pool } = connectLocalDatabase("Overlay layers browser tests");
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
  await createOwnerLedger(pool, env, ledgerId, "E2E overlay layers ledger");
  await pool.query(
    "INSERT INTO accounts (id,ledger_id,name,type,opening_balance) VALUES ($1,$2,'Checking','bank',100000)",
    [checking, ledgerId],
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
    name: "Synthetic overlay layers ledger",
    forwarded: [190, 13],
  });
});
test.afterEach(async () => {
  for (const id of fixtures) {
    for (const table of ["transactions", "accounts", "categories", "tags"])
      await pool.query(
        `UPDATE ${table} SET deleted_at=now(), updated_at=now() WHERE ledger_id=$1`,
        [id],
      );
    await pool.query(
      "UPDATE ledger_members SET deleted_at=now(), updated_at=now() WHERE ledger_id=$1",
      [id],
    );
    await pool.query(
      "UPDATE ledgers SET deleted_at=now(), updated_at=now() WHERE id=$1 AND name LIKE 'E2E overlay layers ledger%'",
      [id],
    );
  }
  fixtures.length = 0;
});
test.afterAll(async () => {
  await pool.end();
});

type Rect = { x: number; y: number; width: number; height: number };
/** A box that has stopped moving (an overlay slides in). */
async function settled(locator: Locator): Promise<Rect> {
  let last = await locator.boundingBox();
  for (let tries = 0; tries < 40; tries++) {
    await locator.page().waitForTimeout(60);
    const next = await locator.boundingBox();
    if (
      last &&
      next &&
      Math.abs(next.x - last.x) < 0.5 &&
      Math.abs(next.y - last.y) < 0.5 &&
      Math.abs(next.width - last.width) < 0.5
    )
      return next;
    last = next;
  }
  throw new Error("never settled");
}

/** The middle lightness (0 to 255) of a strip of the screen: the sheet's own colour, not the few pixels of text in it. */
async function lightness(page: Page, strip: Rect) {
  const png = (await page.screenshot({ clip: strip })).toString("base64");
  // Read the picture on a blank page: the app's own policy does not allow a data: image.
  const blank = await page.context().newPage();
  try {
    return await blank.evaluate(async (data) => {
      const image = new Image();
      image.src = `data:image/png;base64,${data}`;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("no canvas");
      context.drawImage(image, 0, 0);
      const pixels = context.getImageData(
        0,
        0,
        canvas.width,
        canvas.height,
      ).data;
      const values: number[] = [];
      for (let at = 0; at < pixels.length; at += 4)
        values.push(
          0.2126 * (pixels[at] ?? 0) +
            0.7152 * (pixels[at + 1] ?? 0) +
            0.0722 * (pixels[at + 2] ?? 0),
        );
      values.sort((a, b) => a - b);
      return values[Math.floor(values.length / 2)] ?? 0;
    }, png);
  } finally {
    await blank.close();
  }
}

/** A strip of the sheet's head with no title or button in it, on a phone and in a drawer. */
const headStrip = (sheet: Rect): Rect => ({
  x: sheet.x + sheet.width * 0.68,
  y: sheet.y + 18,
  width: sheet.width * 0.1,
  height: 14,
});

for (const theme of ["light", "dark"] as const)
  for (const width of [390, 1280]) {
    const start = async (page: Page, path: string) => {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.setViewportSize({ width, height: 800 });
      await signIn(page);
      await page.goto(path);
      await page.waitForFunction(
        () => getComputedStyle(document.body).containerType === "inline-size",
      );
      await setTheme(page, theme);
    };
    /** Opens the second overlay with `open`, and checks the sheet's head got darker. */
    const expectDimmed = async (page: Page, open: () => Promise<Locator>) => {
      const sheet = page.locator(".ui-sheet").first();
      const before = await lightness(page, headStrip(await settled(sheet)));
      const upper = await open();
      await expect(upper).toBeVisible();
      await settled(upper);
      const after = await lightness(page, headStrip(await settled(sheet)));
      expect(
        after,
        `the sheet's head was ${before} and is ${after}: not dimmed`,
      ).toBeLessThan(before - 3);
    };
    test(`the delete question dims the transaction sheet beneath it (${width} px, ${theme})`, async ({
      page,
    }) => {
      await start(page, "/transactions");
      await page.locator(".tx-row").first().click();
      const sheet = page.getByRole("dialog", { name: /^Edit /i });
      await expect(sheet).toBeVisible();
      await expectDimmed(page, async () => {
        await sheet
          .getByRole("button", { name: "Delete transaction", exact: true })
          .click();
        return page.getByRole("dialog", { name: /^Delete this/ });
      });
    });
    test(`the delete question dims the tag sheet beneath it (${width} px, ${theme})`, async ({
      page,
    }) => {
      await start(page, "/tags");
      await page
        .getByRole("button", { name: "Add tag", exact: true })
        .filter({ visible: true })
        .first()
        .click();
      await page.getByLabel("Name", { exact: true }).fill("Gift");
      await page.getByRole("button", { name: "Save", exact: true }).click();
      await expect(
        page.getByRole("group", { name: "Tag notification" }),
      ).toBeVisible();
      await page.getByRole("button", { name: /Gift/ }).first().click();
      const sheet = page.getByRole("dialog", { name: /Gift|Edit tag/ });
      await expect(sheet).toBeVisible();
      await expectDimmed(page, async () => {
        await sheet
          .getByRole("button", { name: "Delete", exact: true })
          .click();
        return page.getByRole("dialog", { name: "Delete Gift?" });
      });
    });
    // From 700 px the picker is a drawer on the same spot as the editor's and hides it, so only a phone shows both.
    if (width < 700)
      test(`the date picker dims the sheet it was opened from (${width} px, ${theme})`, async ({
        page,
      }) => {
        await start(page, "/home");
        await page
          .getByRole("button", { name: "Add transaction", exact: true })
          .filter({ visible: true })
          .click();
        await expect(page.getByLabel("Amount (USD)")).toBeVisible();
        await expectDimmed(page, async () => {
          await page
            .getByRole("button", { name: "Choose date", exact: true })
            .click();
          return page.getByRole("dialog", { name: "Date", exact: true });
        });
      });
  }
