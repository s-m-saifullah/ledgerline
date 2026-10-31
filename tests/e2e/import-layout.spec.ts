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

// The Import and export page in a real browser (ADR 0047, PR 6a): jsdom cannot run container queries, so the
// cards, the date columns, the sideways scroll of a wide file and the Undo question are measured here.
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
  await expect(page.getByLabel("CSV file")).toBeVisible();
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
        const control = target?.closest("button, a, label, [role=switch]");
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

for (const theme of ["light", "dark"] as const)
  for (const width of [320, 390, 1280]) {
    test(`the file step fits ${width} px in ${theme}: the import card, the export and real targets`, async ({
      page,
    }) => {
      await open(page, width, theme);
      expect(await noSideways(page)).toBe(true);
      await expect(
        page.getByRole("heading", { name: "Export", exact: true }),
      ).toBeVisible();
      for (const name of [
        "Download transactions",
        "Download accounts",
        "Download categories",
        "Download CSV template",
      ])
        expect(await is44(page, page.getByRole("button", { name }))).toBe(true);
      const from = await box(page.getByLabel("From date", { exact: true }));
      const to = await box(page.getByLabel("To date", { exact: true }));
      if (width >= 700) {
        expect(Math.abs(from.y - to.y)).toBeLessThan(2);
        expect(to.x).toBeGreaterThan(from.x + from.width - 1);
        // The page is a column of at most 760 px, not stretched across a desktop.
        const card = await box(page.locator(".imp-card").first());
        expect(card.width).toBeLessThanOrEqual(761);
      } else {
        expect(to.y).toBeGreaterThan(from.y + from.height - 1);
        expect(from.width).toBeGreaterThan(220);
      }
    });
  }

test("the end of the page is clear of the phone's bottom bar", async ({
  page,
}) => {
  await open(page, 320);
  const last = page.locator(".imp-note").last();
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.evaluate(() => document.querySelector("main")?.scrollTo(0, 1e6));
  await expect(last).toBeVisible();
  const found = await box(last);
  const covered = await page.evaluate(
    ({ x, y }) => {
      const hit = document.elementFromPoint(x, y);
      return !hit?.closest(".imp-note");
    },
    { x: found.x + 4, y: found.y + found.height - 2 },
  );
  expect(covered).toBe(false);
});

test("a wide file scrolls inside its card and never widens the page", async ({
  page,
}) => {
  await open(page, 320);
  await upload(page, WIDE);
  await expect(page.getByText("Match your columns")).toBeVisible();
  expect(await noSideways(page)).toBe(true);
  const table = page.locator(".imp-sample-wrap");
  expect(
    await table.evaluate((node) => node.scrollWidth > node.clientWidth),
  ).toBe(true);
  for (const name of ["Back", "Continue"])
    expect(await is44(page, page.getByRole("button", { name }))).toBe(true);
  // The three amount styles are real 44 px targets, and the two switches too.
  for (const row of await page.locator(".imp-choice").all())
    expect((await box(row)).height).toBeGreaterThanOrEqual(44);
  expect(
    await is44(
      page,
      page.getByRole("switch", { name: "First row is a header" }),
    ),
  ).toBe(true);
});

test("Undo asks in a centred question that has real targets, and keeping the entries returns to the button", async ({
  page,
}) => {
  await open(page, 390);
  await upload(page, STATEMENT);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: /^Import \d+ entr/ }).click();
  await expect(page.getByText(/^Imported 2 entries/)).toBeVisible();
  await page.goto("/import");
  const undo = page.getByRole("button", { name: "Undo this import" });
  await undo.click();
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
  await expect(undo).toBeFocused();
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
    await expect(page.getByText("Match your columns")).toBeVisible();
    expect(await found()).toEqual([]);
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByText("Review before importing")).toBeVisible();
    await expect(page.getByText("Ready", { exact: true })).toBeVisible();
    expect(await found()).toEqual([]);
  });
