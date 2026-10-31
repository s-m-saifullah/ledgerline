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

// More in a real browser (ADR 0047, PR 6b), against the approved prototype: jsdom cannot run container queries, so
// the one column of a phone, the right-hand column from 700 px, the row sizes and the two figures are measured here.
const { env, pool } = connectLocalDatabase("More layout browser tests");
const fixtures: string[] = [];
test.beforeEach(async ({ page }, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop",
    "one project is enough: these tests set their own widths",
  );
  const ledgerId = newId();
  fixtures.push(ledgerId);
  await createOwnerLedger(pool, env, ledgerId, "E2E more layout ledger");
  await prepareBrowser(page, testInfo, {
    ledgerId,
    name: "Synthetic more layout ledger",
    forwarded: [225, 20],
  });
});
test.afterEach(async () => {
  for (const id of fixtures) {
    await pool.query(
      "UPDATE ledger_members SET deleted_at=now(), updated_at=now() WHERE ledger_id=$1",
      [id],
    );
    await pool.query(
      "UPDATE ledgers SET deleted_at=now(), updated_at=now() WHERE id=$1 AND name LIKE 'E2E more layout ledger%'",
      [id],
    );
  }
  fixtures.length = 0;
});
test.afterAll(async () => {
  await pool.end();
});

/** Home's summary with money owed, so the two figures show without seeding clients and loans. */
async function withFigures(page: Page) {
  await page.route("**/api/v1/ledgers/*/home*", async (route) => {
    // A request that is cut off by a navigation or the end of the test has nothing left to answer.
    try {
      const response = await route.fetch();
      const body = await response.json();
      body.owed = {
        ...body.owed,
        total: { amount: 28000, currency: "USD" },
        personCount: 2,
      };
      body.loans = {
        lent: { amount: 123456789, currency: "USD" },
        borrowed: { amount: 0, currency: "USD" },
      };
      await route.fulfill({ response, json: body });
    } catch {
      await route.abort().catch(() => {});
    }
  });
}

async function open(page: Page, width: number, theme?: "light" | "dark") {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width, height: 900 });
  await signIn(page);
  await page.goto("/more");
  await page.waitForFunction(
    () => getComputedStyle(document.body).containerType === "inline-size",
  );
  if (theme) await setTheme(page, theme);
  await expect(
    page.getByRole("main").getByRole("link", { name: /^Settings/ }),
  ).toBeVisible();
}
const box = async (locator: Locator) => {
  const found = await locator.boundingBox();
  if (!found) throw new Error("not on screen");
  return found;
};
const group = (page: Page, name: string) =>
  page.getByRole("main").getByRole("region", { name });
const noSideways = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
/** An element is a real 44 px target when a click 21 px out from its centre still lands on it. */
async function is44(page: Page, locator: Locator) {
  await locator.evaluate((node) => node.scrollIntoView({ block: "center" }));
  const found = await box(locator);
  const x = found.x + found.width / 2;
  const y = found.y + found.height / 2;
  return page.evaluate(
    ({ x, y }) => {
      const target = document.elementFromPoint(x, y);
      const control = target?.closest("button, a, label, select");
      return [
        [x - 21, y],
        [x + 21, y],
        [x, y - 21],
        [x, y + 21],
      ].every(([px, py]) => {
        const element = document.elementFromPoint(px as number, py as number);
        return !!element && !!control && control.contains(element);
      });
    },
    { x, y },
  );
}

for (const theme of ["light", "dark"] as const)
  for (const width of [320, 390, 1280])
    test(`fits ${width} px in ${theme}: nine rows, none wrapped, each a real target, with both figures`, async ({
      page,
    }) => {
      await withFigures(page);
      await open(page, width, theme);
      const clients = page
        .getByRole("main")
        .getByRole("link", { name: /^Clients/ });
      await expect(clients).toContainText("$280.00");
      await expect(
        page.getByRole("main").getByRole("link", { name: /^Loans/ }),
      ).toContainText("1,234,567.89");
      expect(await noSideways(page)).toBe(true);
      const rows = page.locator(".more-grid a.ui-row");
      await expect(rows).toHaveCount(9);
      for (const row of await rows.all()) {
        const found = await box(row);
        expect(found.height).toBeGreaterThanOrEqual(56);
        // Nothing wraps: the title and the hint are one line each (a line is at most 1.5 times its font size).
        for (const part of ["ui-row-title", "ui-row-hint"]) {
          for (const line of await row.locator(`.${part}`).all())
            expect(
              await line.evaluate(
                (node) =>
                  node.getBoundingClientRect().height /
                  Number.parseFloat(getComputedStyle(node).fontSize),
              ),
            ).toBeLessThan(1.8);
        }
        expect(await is44(page, row)).toBe(true);
      }
    });

test("a phone reads the three groups in one column, in order", async ({
  page,
}) => {
  await open(page, 390);
  const [a, b, c] = [
    await box(group(page, "Receivables and lending")),
    await box(group(page, "Money setup")),
    await box(group(page, "Data and preferences")),
  ];
  expect(Math.abs(a.x - b.x)).toBeLessThan(1);
  expect(Math.abs(a.x - c.x)).toBeLessThan(1);
  expect(b.y).toBeGreaterThan(a.y + a.height - 1);
  expect(c.y).toBeGreaterThan(b.y + b.height - 1);
});

// Widths are the page's own: the rail takes 88 px and the sidebar 248 px, so 800 px is a 712 px page.
for (const width of [800, 1099, 1280])
  test(`from a 700 px page Money setup is the right column beside the other two (${width} px)`, async ({
    page,
  }) => {
    await open(page, width);
    const [a, b, c] = [
      await box(group(page, "Receivables and lending")),
      await box(group(page, "Money setup")),
      await box(group(page, "Data and preferences")),
    ];
    // Receivables above Data on the left; Money setup on the right, starting on the same line as Receivables.
    expect(b.x).toBeGreaterThan(a.x + a.width - 1);
    expect(Math.abs(a.y - b.y)).toBeLessThan(1);
    expect(Math.abs(a.x - c.x)).toBeLessThan(1);
    expect(c.y).toBeGreaterThan(a.y + a.height - 1);
    // Data and preferences sits straight under Receivables, whatever the height of Money setup beside them.
    expect(c.y - (a.y + a.height)).toBeLessThan(24);
    // The two columns are the same width.
    expect(Math.abs(a.width - b.width)).toBeLessThan(2);
    expect(await noSideways(page)).toBe(true);
  });

test("the page draws no heading but its own and no line at the foot", async ({
  page,
}) => {
  await open(page, 390);
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  await expect(
    page.getByTestId("app-version").filter({ visible: true }),
  ).toHaveCount(0);
  await expect(page.getByText("MAKE IT YOURS")).toHaveCount(0);
  await expect(
    page.getByRole("main").getByRole("link", { name: /^Settings/ }),
  ).toContainText(/Version /);
});

test("a row opens its page and the More tab stays current", async ({
  page,
}) => {
  await open(page, 390);
  await page
    .getByRole("main")
    .getByRole("link", { name: /^Categories/ })
    .click();
  await expect(page).toHaveURL(/\/categories$/);
  await expect(
    page
      .getByRole("navigation", { name: "Mobile navigation" })
      .getByRole("link", { name: "More", exact: true }),
  ).toHaveAttribute("aria-current", "page");
});

for (const theme of ["light", "dark"] as const)
  for (const width of [390, 1280])
    test(`has no accessibility violations in ${theme} at ${width} px`, async ({
      page,
    }) => {
      await withFigures(page);
      await open(page, width, theme);
      await expect(
        page.getByRole("main").getByRole("link", { name: /^Clients/ }),
      ).toContainText("$280.00");
      const found = (await new AxeBuilder({ page }).analyze()).violations.map(
        (item) =>
          `${item.id}: ${item.nodes.map((node) => node.target.join(" ")).join(" | ")}`,
      );
      expect(found).toEqual([]);
    });
