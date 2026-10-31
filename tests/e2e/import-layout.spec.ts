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

// The Import and export page in a real browser (ADR 0047, PR 6a), against the approved prototype: jsdom cannot run
// container queries, so the two columns, the aligned card tops, the pick rows, the drop zone, the sideways scroll of
// a wide file and the Undo question are measured here.
const { env, pool } = connectLocalDatabase("Import layout browser tests");
const fixtures: string[] = [];
test.beforeEach(async ({ page }, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop",
    "one project is enough: these tests set their own widths",
  );
  const ledgerId = newId();
  fixtures.push(ledgerId);
  await createOwnerLedger(pool, env, ledgerId, "E2E import layout ledger");
  await pool.query(
    "INSERT INTO accounts (id,ledger_id,name,type,opening_balance) VALUES ($1,$2,'Checking','bank',0)",
    [newId(), ledgerId],
  );
  for (const [name, kind] of [
    ["Food", "expense"],
    ["Salary", "income"],
  ])
    await pool.query(
      "INSERT INTO categories (id,ledger_id,name,kind) VALUES ($1,$2,$3,$4)",
      [newId(), ledgerId, name, kind],
    );
  await prepareBrowser(page, testInfo, {
    ledgerId,
    name: "Synthetic import layout ledger",
    forwarded: [150, 20],
  });
});
test.afterEach(async () => {
  for (const id of fixtures) {
    for (const table of [
      "transactions",
      "import_batches",
      "accounts",
      "categories",
    ])
      await pool.query(
        `UPDATE ${table} SET deleted_at=now(), updated_at=now() WHERE ledger_id=$1`,
        [id],
      );
    await pool.query(
      "UPDATE ledger_members SET deleted_at=now(), updated_at=now() WHERE ledger_id=$1",
      [id],
    );
    await pool.query(
      "UPDATE ledgers SET deleted_at=now(), updated_at=now() WHERE id=$1 AND name LIKE 'E2E import layout ledger%'",
      [id],
    );
  }
  fixtures.length = 0;
});
test.afterAll(async () => {
  await pool.end();
});

const STATEMENT =
  "Date,Description,Amount,Category\n" +
  "2026-10-02,Corner shop,-4.50,Food\n" +
  "2026-10-04,Pay,2500.00,Salary\n";
// One cell far wider than any phone: it must scroll inside its card, not widen the page.
const WIDE = `Date,Description,Amount,Category\n2026-10-02,${"A very long description ".repeat(12)},-4.50,Food\n`;

async function open(page: Page, width: number, theme?: "light" | "dark") {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width, height: 900 });
  await signIn(page);
  await page.goto("/import");
  await page.waitForFunction(
    () => getComputedStyle(document.body).containerType === "inline-size",
  );
  if (theme) await setTheme(page, theme);
  await expect(page.getByLabel("CSV file")).toBeAttached();
}
const upload = (page: Page, text: string) =>
  page.getByLabel("CSV file").setInputFiles({
    name: "statement.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(text),
  });
const box = async (locator: Locator) => {
  const found = await locator.boundingBox();
  if (!found) throw new Error("not on screen");
  return found;
};
/** An element is a real 44 px target when a click 21 px out from its centre still lands on it. */
async function is44(page: Page, locator: Locator) {
  // Centred, so the phone's bottom bar is never over it.
  await locator.evaluate((node) => node.scrollIntoView({ block: "center" }));
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
        const control = target?.closest(
          "button, a, label, select, [role=switch], [role=radio]",
        );
        return !!element && !!control && control.contains(element);
      });
    },
    { x, y },
  );
}
const noSideways = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
/** Waits until an element has stopped moving: its box reads the same twice in a row. */
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
const importCard = (page: Page) => page.locator(".imp-stack .ui-card").first();
const exportCard = (page: Page) =>
  page.locator("section[aria-labelledby=export-title]");

for (const theme of ["light", "dark"] as const)
  for (const width of [320, 390, 1280]) {
    test(`the file step fits ${width} px in ${theme}: pick row, drop zone, export and real targets`, async ({
      page,
    }) => {
      await open(page, width, theme);
      expect(await noSideways(page)).toBe(true);
      // "Import into" is a pick row: the whole row is the select, and it is at least 56 px tall.
      const pick = page.locator(".ui-pick-row").first();
      expect((await box(pick)).height).toBeGreaterThanOrEqual(56);
      expect(await is44(page, page.getByLabel("Import into"))).toBe(true);
      // The drop zone is one dashed target.
      const drop = page.locator(".imp-drop");
      await expect(drop).toBeVisible();
      expect(
        await drop.evaluate((node) => getComputedStyle(node).borderTopStyle),
      ).toBe("dashed");
      for (const name of [
        "Download CSV template",
        "Download transactions",
        "Download accounts",
        "Download categories",
      ])
        expect(await is44(page, page.getByRole("button", { name }))).toBe(true);
      // The three downloads are one width.
      const widths = [];
      for (const name of [
        "Download transactions",
        "Download accounts",
        "Download categories",
      ])
        widths.push((await box(page.getByRole("button", { name }))).width);
      expect(Math.max(...widths) - Math.min(...widths)).toBeLessThan(1);
      // The steps are numbered circles.
      const circle = page.locator(".imp-steps li i").first();
      const round = await box(circle);
      expect(Math.round(round.width)).toBe(24);
      const from = await box(page.getByLabel("From date", { exact: true }));
      const to = await box(page.getByLabel("To date", { exact: true }));
      // From and To sit side by side where each date fits beside its calendar button (320 px stacks them), and
      // neither date is ever cut off.
      if (width >= 390) {
        expect(Math.abs(from.y - to.y)).toBeLessThan(2);
        expect(to.x).toBeGreaterThan(from.x + from.width - 1);
      }
      expect(from.width).toBeGreaterThan(100);
      for (const date of ["From date", "To date"])
        expect(
          // A date input hides its overflow, so measure the longest date, typed into a text input of the same
          // font, against the room the field leaves (6 px for the date field's own inner margins).
          await page.getByLabel(date, { exact: true }).evaluate((node) => {
            const css = getComputedStyle(node);
            const probe = document.createElement("input");
            probe.value = "12/31/2026";
            probe.style.cssText = `position:absolute;visibility:hidden;width:1px;padding:0;border:0;font-family:${css.fontFamily};font-size:${css.fontSize};font-weight:${css.fontWeight};font-variant-numeric:${css.fontVariantNumeric}`;
            document.body.append(probe);
            const needed = probe.scrollWidth;
            probe.remove();
            const room =
              node.clientWidth -
              Number.parseFloat(css.paddingLeft) -
              Number.parseFloat(css.paddingRight);
            return room >= needed + 6;
          }),
        ).toBe(true);
      if (width < 700)
        // On a phone the export sits under the import.
        expect((await box(exportCard(page))).y).toBeGreaterThan(
          (await box(importCard(page))).y,
        );
    });
  }

test("from 700 px the import and the export are two columns whose cards start on one line, and 2 to 1 from 1100 px", async ({
  page,
}) => {
  await open(page, 900);
  const left = await box(importCard(page));
  const right = await box(exportCard(page));
  expect(Math.abs(left.y - right.y)).toBeLessThan(1);
  expect(right.x).toBeGreaterThan(left.x + left.width - 1);
  expect(Math.abs(left.width - right.width)).toBeLessThan(2);
  // Their first rows are one row tall each, so the two cards open alike.
  const rows = [
    await box(importCard(page).locator(".ui-row").first()),
    await box(exportCard(page).locator(".ui-row").first()),
  ];
  expect(
    Math.abs((rows[0]?.height ?? 0) - (rows[1]?.height ?? 1)),
  ).toBeLessThan(1);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.waitForTimeout(200);
  const wide = [await box(importCard(page)), await box(exportCard(page))];
  expect(Math.abs((wide[0]?.y ?? 0) - (wide[1]?.y ?? 1))).toBeLessThan(1);
  expect((wide[0]?.width ?? 0) / (wide[1]?.width ?? 1)).toBeGreaterThan(1.8);
  expect((wide[0]?.width ?? 0) / (wide[1]?.width ?? 1)).toBeLessThan(2.2);
  // The steps are above both columns, so they do not push the import card below the export card.
  const steps = await box(page.locator(".imp-steps"));
  expect(steps.y + steps.height).toBeLessThanOrEqual((wide[0]?.y ?? 0) + 1);
});

test("the export card's title is the same row as 'Import into', and the Done card opens the same way", async ({
  page,
}) => {
  await open(page, 1280);
  const style = (locator: Locator) =>
    locator.evaluate((node) => {
      const css = getComputedStyle(node);
      return [css.fontSize, css.fontWeight];
    });
  const title = await style(page.locator("#export-title"));
  const pickTitle = await style(
    page.locator(".ui-pick-row .ui-row-title").first(),
  );
  expect(title).toEqual(pickTitle);
});

test("the focus ring of the first row follows the card's curve instead of being cut at its corners", async ({
  page,
}) => {
  await open(page, 390);
  const select = page.getByLabel("Import into");
  await select.focus();
  const row = page.locator(".ui-pick-row").first();
  const corners = await row.evaluate((node) => {
    const css = getComputedStyle(node);
    return {
      outline: css.outlineStyle,
      topLeft: Number.parseFloat(css.borderTopLeftRadius),
      topRight: Number.parseFloat(css.borderTopRightRadius),
      card: Number.parseFloat(
        getComputedStyle(node.closest(".ui-card") as Element)
          .borderTopLeftRadius,
      ),
    };
  });
  expect(corners.outline).toBe("solid");
  // One pixel less than the card, which has a one pixel border.
  expect(corners.topLeft).toBe(corners.card - 1);
  expect(corners.topRight).toBe(corners.card - 1);
});

test("the end of the page is clear of the phone's bottom bar", async ({
  page,
}) => {
  await open(page, 320);
  const last = page.getByRole("button", { name: "Download categories" });
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expect(last).toBeVisible();
  const found = await box(last);
  const covered = await page.evaluate(
    ({ x, y }) => {
      const hit = document.elementFromPoint(x, y);
      return !hit?.closest("button");
    },
    { x: found.x + found.width / 2, y: found.y + found.height - 2 },
  );
  expect(covered).toBe(false);
});

test("a wide file scrolls inside its card and never widens the page", async ({
  page,
}) => {
  await open(page, 320);
  await upload(page, WIDE);
  await expect(
    page.getByRole("switch", { name: "The first row holds column names" }),
  ).toBeVisible();
  expect(await noSideways(page)).toBe(true);
  const table = page.locator(".imp-sample-card");
  expect(
    await table.evaluate((node) => node.scrollWidth > node.clientWidth),
  ).toBe(true);
  for (const name of ["Back", "Continue"])
    expect(await is44(page, page.getByRole("button", { name }))).toBe(true);
  // The amount style is a segmented control of real targets, and the switch row too.
  for (const name of [
    "One amount column",
    "Amount and type",
    "Money in and out",
  ])
    expect(await is44(page, page.getByRole("radio", { name }))).toBe(true);
  expect(
    await is44(
      page,
      page.getByRole("switch", { name: "The first row holds column names" }),
    ),
  ).toBe(true);
  // A long switch title wraps rather than being cut off.
  const title = page
    .getByRole("switch", { name: "The first row holds column names" })
    .locator(".ui-row-title");
  expect(
    await title.evaluate((node) => node.scrollWidth <= node.clientWidth + 1),
  ).toBe(true);
});

test("a recent import's row opens a centred Undo question with real targets, and keeping the entries returns to the row", async ({
  page,
}) => {
  await open(page, 390);
  await upload(page, STATEMENT);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: /^Import \d+ entr/ }).click();
  await expect(page.getByText(/^Imported 2 entries/)).toBeVisible();
  await page.goto("/import");
  const row = page.getByRole("button", { name: /^statement\.csv/ });
  await expect(row.getByText("Undo", { exact: true })).toBeVisible();
  await row.click();
  const question = page.getByRole("dialog", { name: "Undo this import?" });
  await expect(question).toBeVisible();
  await settled(question);
  const frame = await box(question);
  expect(Math.abs(frame.x + frame.width / 2 - 195)).toBeLessThan(2);
  expect(frame.y).toBeGreaterThan(50);
  for (const name of ["Keep them", "Delete these entries"])
    expect(await is44(page, question.getByRole("button", { name }))).toBe(true);
  await question.getByRole("button", { name: "Keep them" }).click();
  await expect(question).toBeHidden();
  await expect(row).toBeFocused();
});

for (const theme of ["light", "dark"] as const)
  test(`has no accessibility violations in ${theme} on the file, columns and review steps`, async ({
    page,
  }) => {
    const found = async () =>
      (await new AxeBuilder({ page }).analyze()).violations.map(
        (item) =>
          `${item.id}: ${item.nodes.map((node) => node.target.join(" ")).join(" | ")}`,
      );
    await open(page, 1280, theme);
    expect(await found()).toEqual([]);
    await upload(page, STATEMENT);
    await expect(
      page.getByRole("switch", { name: "The first row holds column names" }),
    ).toBeVisible();
    expect(await found()).toEqual([]);
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(
      page.getByRole("button", { name: /^Import \d+ entr/ }),
    ).toBeVisible();
    await expect(page.getByText("Ready", { exact: true })).toBeVisible();
    expect(await found()).toEqual([]);
  });
