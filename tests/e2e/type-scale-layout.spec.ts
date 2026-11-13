import { expect, type Page, test } from "@playwright/test";
import { newId } from "../../packages/shared/src/index";
import {
  connectLocalDatabase,
  createOwnerLedger,
  prepareBrowser,
} from "./ledger-setup";
import { signIn } from "./sign-in";

// The type scale in a real browser (docs/STYLE_GUIDE.md, ADR 0047 and ADR 0052): every page title is 27 px, the
// base size of the page is 14 px, and the text of a form field is 16 px (so iOS does not zoom when it is focused).
// The stylesheet test reads the CSS; only a browser knows what an element ends up with.
const { env, pool } = connectLocalDatabase("Type scale browser tests");
const fixtures: string[] = [];
test.beforeEach(async ({ page }, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop",
    "one project is enough: these tests set their own widths",
  );
  const ledgerId = newId();
  fixtures.push(ledgerId);
  await createOwnerLedger(pool, env, ledgerId, "E2E type scale ledger");
  await prepareBrowser(page, testInfo, {
    ledgerId,
    name: "Synthetic type scale ledger",
    forwarded: [240, 10],
  });
});
test.afterEach(async () => {
  for (const id of fixtures) {
    await pool.query(
      "UPDATE ledger_members SET deleted_at=now(), updated_at=now() WHERE ledger_id=$1",
      [id],
    );
    await pool.query(
      "UPDATE ledgers SET deleted_at=now(), updated_at=now() WHERE id=$1 AND name LIKE 'E2E type scale ledger%'",
      [id],
    );
  }
  fixtures.length = 0;
});
test.afterAll(async () => {
  await pool.end();
});

const routes = [
  "/",
  "/transactions",
  "/budgets",
  "/insights",
  "/more",
  "/clients",
  "/loans",
  "/accounts",
  "/categories",
  "/tags",
  "/currencies",
  "/recurring",
  "/import",
  "/settings",
  "/profile",
  "/users",
];

async function open(page: Page, width: number, path: string) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width, height: 900 });
  await signIn(page);
  await page.goto(path);
  await page.waitForFunction(
    () => getComputedStyle(document.body).containerType === "inline-size",
  );
  await expect(page.locator("main h1").first()).toBeAttached();
}

for (const width of [390, 1280]) {
  test(`every page title is 27 px at ${width} px`, async ({ page }) => {
    await open(page, width, "/more");
    for (const path of routes) {
      await page.goto(path);
      const title = page.locator("main h1").first();
      await expect(title).toBeAttached();
      // A page may swap its loading heading for the real one; read the size until it settles.
      await expect
        .poll(
          () =>
            title
              .evaluate((node) => ({
                px: getComputedStyle(node).fontSize,
                weight: getComputedStyle(node).fontWeight,
              }))
              .catch(() => null),
          { message: path },
        )
        .toEqual({ px: "27px", weight: "600" });
    }
  });
}

test("the page is 14 px, and a form field's text is 16 px", async ({
  page,
}) => {
  await open(page, 390, "/transactions");
  expect(
    await page.evaluate(() => getComputedStyle(document.body).fontSize),
  ).toBe("14px");
  const search = page
    .getByRole("searchbox")
    .or(page.getByPlaceholder(/^Search/));
  await expect(search.first()).toBeVisible();
  expect(
    await search.first().evaluate((node) => getComputedStyle(node).fontSize),
  ).toBe("16px");
});

test("every text field in the Add sheet is 16 px on a phone", async ({
  page,
}) => {
  await open(page, 390, "/more");
  // The sheet shows its fields only when the ledger has an account and a category.
  const ledgerId = fixtures[fixtures.length - 1];
  const root = `/api/v1/ledgers/${ledgerId}`;
  const headers = () => ({
    origin: "http://localhost:5173",
    "idempotency-key": newId(),
  });
  for (const [path, data] of [
    [
      "/accounts",
      {
        name: "Everyday",
        type: "bank",
        openingBalance: { amount: 0, currency: "USD" },
      },
    ],
    ["/categories", { name: "Food", kind: "expense" }],
  ] as const) {
    const made = await page.request.post(`${root}${path}`, {
      headers: headers(),
      data,
    });
    expect(made.status()).toBe(201);
  }
  await page.goto("/transactions");
  await page
    .getByRole("button", { name: "Add transaction", exact: true })
    .filter({ visible: true })
    .first()
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  // The amount box is the one big figure (35 px); a checkbox draws no text.
  const sizes = await page.getByRole("dialog").evaluate((dialog) =>
    Array.from(
      dialog.querySelectorAll(
        'input:not([type="checkbox"]):not([type="radio"]):not([type="hidden"]):not(.entry-amount-input), textarea',
      ),
    ).map((field) => ({
      field:
        `${field.tagName.toLowerCase()} ${field.getAttribute("type") ?? ""} ${field.className}`.trim(),
      size: getComputedStyle(field).fontSize,
    })),
  );
  expect(sizes.length).toBeGreaterThan(3);
  for (const field of sizes) expect(field).toEqual({ ...field, size: "16px" });
});

// The bottom bar's labels are 12 px from a 380 px wide screen and 10 px below it (ADR 0053): "Transactions" is
// 75 px wide in 12 px semibold, which needs a tab of that width, so a narrower phone keeps the 10 px label.
for (const [width, size] of [
  [320, "10px"],
  [375, "10px"],
  [379, "10px"],
  [380, "12px"],
  [390, "12px"],
  [412, "12px"],
] as const) {
  test(`the bottom bar's labels are ${size} at ${width} px, and none is clipped`, async ({
    page,
  }) => {
    await open(page, width, "/transactions");
    const links = page.locator(".ui-bottom a");
    await expect(links).toHaveCount(5);
    const found = await links.evaluateAll((nodes) =>
      nodes.map((node) => {
        const range = document.createRange();
        // The label is the element that holds the words (it sits beside the icon).
        const word = Array.from(node.querySelectorAll("*")).find(
          (element) =>
            element.children.length === 0 && element.textContent?.trim(),
        );
        if (!word) throw new Error("no label found");
        range.selectNodeContents(word);
        return {
          label: node.textContent?.trim(),
          size: getComputedStyle(node).fontSize,
          text: Math.ceil(range.getBoundingClientRect().width),
          // The room for the label: the tab less its own side padding.
          tab: Math.floor(
            node.getBoundingClientRect().width -
              Number.parseFloat(getComputedStyle(node).paddingLeft) -
              Number.parseFloat(getComputedStyle(node).paddingRight),
          ),
        };
      }),
    );
    for (const link of found) {
      expect({ label: link.label, size: link.size }).toEqual({
        label: link.label,
        size,
      });
      // At 10 px "Transactions" is within a pixel or two of a 64 px tab, depending on the platform's font
      // rendering; it spills into the margin beside a short label and nothing clips it. The 12 px label must fit.
      const slack = size === "10px" ? 2 : 0;
      expect(link.text, link.label).toBeLessThanOrEqual(link.tab + slack);
    }
  });
}
