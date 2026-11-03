import { randomUUID } from "node:crypto";
import { expect, type Locator, type Page, test } from "@playwright/test";
import {
  type Category,
  categorySchema,
  newId,
} from "../../packages/shared/src/index";
import { clickCategoryAction, expectCategoryAction } from "./category-actions";
import { chooseCategory } from "./category-picker";
import { connectLocalDatabase } from "./ledger-setup";
import { openMorePage } from "./more-nav";
import { signIn } from "./sign-in";
import { setTheme } from "./theme";

const { env, pool } = connectLocalDatabase("Category browser tests");
let fixtureLedger = "";
const fixtures: string[] = [];
test.beforeEach(async ({ page }, testInfo) => {
  fixtureLedger = newId();
  const owner = (
    await pool.query(
      "SELECT id FROM users WHERE email = $1 AND deleted_at IS NULL",
      [env.OWNER_EMAIL],
    )
  ).rows[0];
  if (!owner) throw new Error("Missing browser test owner");
  await pool.query("INSERT INTO ledgers (id, name) VALUES ($1, $2)", [
    fixtureLedger,
    `E2E category ledger ${testInfo.project.name}`,
  ]);
  await pool.query(
    "INSERT INTO ledger_members (id, ledger_id, user_id, role) VALUES ($1, $2, $3, 'owner')",
    [newId(), fixtureLedger, owner.id],
  );
  fixtures.push(fixtureLedger);
  // UI selects this synthetic ledger; every category operation still uses real guards and PostgreSQL.
  await page.route("**/api/v1/ledgers", async (route) =>
    route.fulfill({
      json: {
        items: [
          {
            id: fixtureLedger,
            name: "Synthetic category ledger",
            timeZone: null,
            version: 1,
            baseCurrency: "USD",
            role: "owner",
          },
        ],
      },
    }),
  );
  await page.setExtraHTTPHeaders({
    "x-forwarded-for": `198.51.100.${60 + (testInfo.workerIndex % 160)}`,
  });
  await page.emulateMedia({ colorScheme: "light" });
});
test.afterEach(async () => {
  for (const ledgerId of fixtures) {
    await pool.query(
      "UPDATE categories SET deleted_at = $1, updated_at = $1 WHERE ledger_id = $2",
      [new Date(), ledgerId],
    );
    await pool.query(
      "UPDATE ledger_members SET deleted_at = $1, updated_at = $1 WHERE ledger_id = $2",
      [new Date(), ledgerId],
    );
    await pool.query(
      "UPDATE ledgers SET deleted_at = $1, updated_at = $1 WHERE id = $2 AND name LIKE 'E2E category ledger %'",
      [new Date(), ledgerId],
    );
  }
  fixtures.length = 0;
});
test.afterAll(async () => {
  await pool.end();
});
async function openCategories(page: Page) {
  await signIn(page);
  await openMorePage(page, "Categories");
  await expect(
    page.getByRole("heading", { name: "Categories", exact: true }),
  ).toBeVisible();
}
/** The main categories in the page, in order (both kinds on a wide page, expense first). */
const rowNames = (page: Page) => page.locator(".cg-toggle .ui-row-title");
const actionsFor = (page: Page, name: string) =>
  page.getByRole("button", { name: `Actions for ${name}`, exact: true });
const statusChip = (page: Page, name: "Active" | "Archived" | "All") =>
  page
    .getByRole("group", { name: "View categories" })
    .getByRole("button", { name, exact: true });
const expandAll = async (page: Page) => {
  const button = page.getByRole("button", { name: "Expand all", exact: true });
  // The list may still be loading, so give the button a moment to appear.
  await button.waitFor({ timeout: 2000 }).catch(() => undefined);
  if (await button.count()) await button.click();
};
/** Open an icon or colour row in the editor and choose one of its options, each drawn with its icon or colour. */
async function pickLook(dialog: Locator, row: string, option: string) {
  await dialog.getByRole("button", { name: new RegExp(`^${row}`) }).click();
  await dialog
    .getByRole("radiogroup", { name: row })
    .getByRole("radio", { name: option })
    .click();
}
async function add(page: Page, name: string, parent?: Category) {
  await page
    .getByRole("button", { name: /Add (your first )?category/, exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "Add category" });
  await expect(dialog.getByLabel("Category name")).toBeFocused();
  await dialog.getByLabel("Category name").fill(name);
  if (parent) {
    await chooseCategory(dialog, "Parent category", parent.name);
  }
  await pickLook(dialog, "Category icon", "Shopping");
  await pickLook(dialog, "Category color", "Blue");
  const response = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      /\/categories$/.test(response.url()),
  );
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  const saved = await response;
  expect(saved.status()).toBe(201);
  await expect(dialog).toHaveCount(0);
  return categorySchema.parse(await saved.json());
}
test("creates, retries, edits, reorders and archives categories with active-only parent choices", async ({
  page,
}, testInfo) => {
  test.setTimeout(60000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openCategories(page);
  await expect(page.getByText("No categories yet.")).toBeVisible();
  await page.getByRole("button", { name: "Add starter categories" }).click();
  await expect(
    page
      .getByRole("dialog")
      .getByRole("listitem")
      .filter({ hasText: "Salary & wages" }),
  ).toBeVisible();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  expect(
    (
      await pool.query(
        "SELECT count(*)::int AS count FROM categories WHERE ledger_id = $1 AND deleted_at IS NULL",
        [fixtureLedger],
      )
    ).rows[0]?.count,
  ).toBe(0);
  const name = `E2E Food ${randomUUID().slice(0, 6)}`;
  const keys: string[] = [];
  let original: Category | undefined;
  let dropped = false;
  await page.route(/\/api\/v1\/ledgers\/[^/]+\/categories$/, async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    keys.push(route.request().headers()["idempotency-key"] ?? "");
    if (!dropped) {
      dropped = true;
      const response = await route.fetch();
      expect(response.status()).toBe(201);
      original = categorySchema.parse(await response.json());
      await route.abort("failed");
    } else await route.continue();
  });
  await page.getByRole("button", { name: "Add your first category" }).click();
  let dialog = page.getByRole("dialog");
  await dialog.getByLabel("Category name").fill(name);
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText(
    "couldn't confirm the save",
  );
  await dialog.getByRole("button", { name: "Close for now" }).click();
  await expect(
    page.getByRole("button", { name: "Add your first category" }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Resume action" }).click();
  const replay = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      /\/categories$/.test(response.url()),
  );
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Retry save" })
    .click();
  const retried = await replay;
  expect(retried.headers()["idempotency-replayed"]).toBe("true");
  const root = categorySchema.parse(await retried.json());
  expect(root.id).toBe(original?.id);
  expect(keys[0]).toBe(keys[1]);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const other = await add(page, `E2E Transport ${randomUUID().slice(0, 6)}`);
  const child = await add(
    page,
    `E2E Groceries ${randomUUID().slice(0, 6)}`,
    root,
  );
  expect(child.parentId).toBe(root.id);
  expect(child.icon).toBe("shopping-bag");
  expect(child.color).toBe("#2563EB");
  await expectCategoryAction(page, "archive", root.name, "disabled");
  await clickCategoryAction(page, "up", other.name);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByRole("status").filter({ hasText: "Category order updated" }),
  ).toBeVisible();
  await expect(rowNames(page).first()).toHaveText(other.name);
  await clickCategoryAction(page, "edit", root.name);
  dialog = page.getByRole("dialog", { name: "Edit category" });
  const external = await page.request.patch(
    `/api/v1/ledgers/${fixtureLedger}/categories/${root.id}`,
    {
      headers: {
        origin: env.APP_URL ?? "http://localhost:5173",
        "idempotency-key": randomUUID(),
      },
      data: { expectedVersion: 2, name: `${name} latest` },
    },
  );
  expect(external.status()).toBe(200);
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText(
    "This category changed",
  );
  await dialog.getByRole("button", { name: "Reload latest details" }).click();
  await expect(dialog.getByLabel("Category name")).toHaveValue(
    `${name} latest`,
  );
  await dialog.getByLabel("Category name").fill(name);
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect
    .poll(() => page.evaluate(() => document.activeElement?.id))
    .toMatch(/^(categories-title|edit-category-)/);
  await expect(page.locator(".skip-link")).not.toBeInViewport();
  await page.screenshot({
    path: testInfo.outputPath("categories-light.png"),
    fullPage: true,
  });
  await setTheme(page, "dark");
  await page.screenshot({
    path: testInfo.outputPath("categories-dark.png"),
    fullPage: true,
  });
  for (const category of [child, root]) {
    await clickCategoryAction(page, "archive", category.name);
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Archive", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  }
  await statusChip(page, "Active").click();
  await expect(actionsFor(page, root.name)).toHaveCount(0);
  await page.getByRole("button", { name: "Add category", exact: true }).click();
  await expect(
    page
      .getByRole("dialog")
      .getByRole("option", { name: root.name, exact: true }),
  ).toHaveCount(0);
  await page.keyboard.press("Escape");
  await statusChip(page, "Archived").click();
  await expect(actionsFor(page, root.name)).toBeVisible();
  await expandAll(page);
  await expect(actionsFor(page, child.name)).toBeVisible();
  await page.reload();
  await expect(actionsFor(page, root.name)).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});
test("explicit starter creation, income view and keyboard dialog fit work on narrow phones", async ({
  page,
}, testInfo) => {
  if (testInfo.project.name === "mobile")
    await page.setViewportSize({ width: 320, height: 740 });
  await openCategories(page);
  const firstCategory = page.getByRole("button", {
    name: "Add your first category",
    exact: true,
  });
  const starterCategories = page.getByRole("button", {
    name: "Add starter categories",
    exact: true,
  });
  await expect(firstCategory).toBeVisible();
  await expect(starterCategories).toBeVisible();
  for (const theme of ["light", "dark"] as const) {
    await setTheme(page, theme);
    const first = await firstCategory.boundingBox();
    const starter = await starterCategories.boundingBox();
    if (!first || !starter) throw new Error("Missing category empty actions");
    expect(Math.abs(first.height - starter.height)).toBeLessThanOrEqual(1);
    expect(first.height).toBeGreaterThanOrEqual(44);
    if (testInfo.project.name === "desktop")
      expect(Math.abs(first.y - starter.y)).toBeLessThanOrEqual(1);
    else {
      expect(Math.abs(first.x - starter.x)).toBeLessThanOrEqual(1);
      expect(Math.abs(first.width - starter.width)).toBeLessThanOrEqual(1);
      expect(first.y - starter.y - starter.height).toBe(12);
    }
    await page.screenshot({
      path: testInfo.outputPath(`category-empty-${theme}.png`),
    });
  }
  if (testInfo.project.name === "desktop") {
    await starterCategories.hover();
    const hint = page.getByRole("tooltip");
    await expect(hint).toContainText("Hourly wages");
    const hintBox = await hint.boundingBox();
    const buttonBox = await starterCategories.boundingBox();
    expect(hintBox?.y ?? 0).toBeGreaterThanOrEqual(
      (buttonBox?.y ?? 0) + (buttonBox?.height ?? 0),
    );
    expect(hintBox?.x ?? -1).toBeGreaterThanOrEqual(0);
    expect((hintBox?.x ?? 0) + (hintBox?.width ?? 0)).toBeLessThanOrEqual(
      page.viewportSize()?.width ?? 0,
    );
    // No ancestor that hides overflow may cut the hint off.
    const clipped = await hint.evaluate((el) => {
      const box = el.getBoundingClientRect();
      for (let node = el.parentElement; node; node = node.parentElement) {
        const { overflowX, overflowY } = getComputedStyle(node);
        if (
          [overflowX, overflowY].every((value) => value === "visible") ||
          node === document.documentElement
        )
          continue;
        const bounds = node.getBoundingClientRect();
        if (node === document.body) continue;
        if (overflowY === "auto" || overflowY === "scroll") continue;
        if (
          box.bottom > bounds.bottom + 1 ||
          box.right > bounds.right + 1 ||
          box.left < bounds.left - 1
        )
          return true;
      }
      return false;
    });
    expect(clipped).toBe(false);
    await page.screenshot({
      path: testInfo.outputPath("starter-hint.png"),
    });
    await page.keyboard.press("Escape");
    await expect(hint).toBeHidden();
  }
  await starterCategories.click();
  let dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Create categories" }).click();
  await expect(dialog).toHaveCount(0);
  await expandAll(page);
  const kindColumn = (kind: "expense" | "income") =>
    page.locator(".cg-col").nth(kind === "expense" ? 0 : 1);
  const rows = (kind: "expense" | "income") =>
    kindColumn(kind).locator(".cg-toggle, .cg-sub");
  await expect(rows("expense")).toHaveCount(28);
  await expect(rows("income")).toHaveCount(9);
  // Under 700 px one kind shows at a time through the switch; from it both are on the page.
  const incomeSwitch = page.getByRole("radio", { name: /^Income/ });
  const narrow = await incomeSwitch.isVisible();
  if (narrow) {
    await incomeSwitch.click();
    await expect(kindColumn("expense")).toBeHidden();
  }
  await expect(actionsFor(page, "Salary & wages")).toBeVisible();
  await page.getByRole("button", { name: "Add category", exact: true }).click();
  dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("Category name")).toBeFocused();
  await expect(
    dialog.getByRole("radio", { name: narrow ? "Income" : "Expense" }),
  ).toBeChecked();
  await dialog.getByLabel("Category name").fill("E2E keyboard preview");
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press("Tab");
    expect(
      await page.evaluate(
        () => !!document.activeElement?.closest('[role="dialog"]'),
      ),
    ).toBe(true);
  }
  await page.screenshot({
    path: testInfo.outputPath("category-dialog.png"),
    fullPage: false,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  // The sheet slides in, so it is measured once it has stopped.
  await expect
    .poll(async () => {
      const bounds = await dialog.boundingBox();
      return bounds ? bounds.y + bounds.height : Number.POSITIVE_INFINITY;
    })
    .toBeLessThanOrEqual(page.viewportSize()?.height ?? 0);
  expect((await dialog.boundingBox())?.x).toBeGreaterThanOrEqual(0);
  expect((await dialog.boundingBox())?.y).toBeGreaterThanOrEqual(0);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Categories", exact: true }),
  ).toBeFocused();
});
test("arrow clicks save immediately and interrupted or stale reorders recover inline", async ({
  page,
}) => {
  await openCategories(page);
  const root = await add(page, "E2E reorder Food");
  const other = await add(page, "E2E reorder Transport");
  const writes: { key: string; body: string | null }[] = [];
  await page.route("**/categories/reorder", async (route) => {
    writes.push({
      key: route.request().headers()["idempotency-key"] ?? "",
      body: route.request().postData(),
    });
    if (writes.length === 1) {
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      await route.abort("failed");
    } else await route.continue();
  });
  await clickCategoryAction(page, "up", other.name);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("alert")).toContainText(
    "Couldn't confirm the order",
  );
  await expect(
    page.getByRole("button", { name: "Add category", exact: true }),
  ).toBeDisabled();
  const replay = page.waitForResponse((response) =>
    response.url().endsWith("/categories/reorder"),
  );
  await page.getByRole("button", { name: "Retry order" }).click();
  const retried = await replay;
  expect(retried.status()).toBe(200);
  expect(retried.headers()["idempotency-replayed"]).toBe("true");
  expect(writes[1]).toEqual(writes[0]);
  await expect(rowNames(page).first()).toHaveText(other.name);
  await clickCategoryAction(page, "down", other.name);
  await expect(rowNames(page).first()).toHaveText(root.name);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expectCategoryAction(page, "up", other.name, "enabled");
  const external = await page.request.patch(
    `/api/v1/ledgers/${fixtureLedger}/categories/${root.id}`,
    {
      headers: {
        origin: env.APP_URL ?? "http://localhost:5173",
        "idempotency-key": randomUUID(),
      },
      data: { expectedVersion: 3, icon: "wallet" },
    },
  );
  expect(external.status()).toBe(200);
  await clickCategoryAction(page, "up", other.name);
  await expect(page.getByRole("alert")).toContainText(
    "These categories changed",
  );
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expectCategoryAction(page, "up", other.name, "disabled");
  await page.getByRole("button", { name: "Reload categories" }).click();
  await expectCategoryAction(page, "up", other.name, "enabled");
  await expect(rowNames(page).first()).toHaveText(root.name);
  const saved = page.waitForResponse((response) =>
    response.url().endsWith("/categories/reorder"),
  );
  await clickCategoryAction(page, "up", other.name);
  expect((await saved).status()).toBe(200);
  await expect(rowNames(page).first()).toHaveText(other.name);
  expect(writes).toHaveLength(5);
  expect(writes[4]?.key).not.toBe(writes[3]?.key);
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
async function expectAlignedCategoryActions(page: Page) {
  for (const group of await page.locator(".cg-head").all()) {
    const bounds = await group.boundingBox();
    const title = await group.locator(".ui-row-main").boundingBox();
    const more = await group
      .getByRole("button", { name: /^Actions for/ })
      .boundingBox();
    if (!bounds || !title || !more) throw new Error("Missing category bounds");
    // The name and the actions button share the row's middle, the name never reaching the button.
    expect(
      Math.abs(title.y + title.height / 2 - more.y - more.height / 2),
    ).toBeLessThan(1.5);
    expect(title.x + title.width).toBeLessThanOrEqual(more.x + 0.5);
    // The category name keeps real room on every width (it used to shrink to one letter on phones).
    expect(title.width).toBeGreaterThanOrEqual(100);
    expect(more.width).toBeGreaterThanOrEqual(44);
    expect(more.height).toBeGreaterThanOrEqual(44);
    expect(more.x + more.width).toBeLessThanOrEqual(bounds.x + bounds.width);
    expect(more.y + more.height).toBeLessThanOrEqual(bounds.y + bounds.height);
    expect(
      await group
        .locator(".ui-row-title")
        .evaluate((n) => n.scrollWidth <= n.clientWidth + 1),
    ).toBe(true);
  }
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
}
test("unarchives preserve category identity and icon actions align on narrow phones", async ({
  page,
}, testInfo) => {
  test.setTimeout(60000);
  await openCategories(page);
  const root = await add(page, "Housing");
  const child = await add(page, "Utilities", root);
  await add(page, "Food");
  await add(page, "Health");
  await add(
    page,
    "A long category name that stays readable through its full hover hint and accessible label",
  );
  const widths = testInfo.project.name === "mobile" ? [390, 320] : [1280];
  for (const width of widths) {
    await page.setViewportSize({
      width,
      height: testInfo.project.name === "mobile" ? 844 : 800,
    });
    await expectAlignedCategoryActions(page);
    await setTheme(page, "dark");
    await page.screenshot({
      path: testInfo.outputPath(`category-cards-${width}-dark.png`),
      fullPage: true,
    });
    await setTheme(page, "light");
  }
  for (const category of [child, root]) {
    await clickCategoryAction(page, "archive", category.name);
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Archive", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  }
  await statusChip(page, "Archived").click();
  await expectCategoryAction(page, "unarchive", "Utilities", "disabled");
  const requests: { key: string; body: string | null }[] = [];
  await page.route("**/categories/*/unarchive", async (route) => {
    requests.push({
      key: route.request().headers()["idempotency-key"] ?? "",
      body: route.request().postData(),
    });
    if (requests.length === 1) {
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      expect(categorySchema.parse(await response.json())).toMatchObject({
        id: root.id,
        name: root.name,
        icon: root.icon,
        color: root.color,
        parentId: null,
        archivedAt: null,
        version: 3,
      });
      await route.abort("failed");
    } else await route.continue();
  });
  await clickCategoryAction(page, "unarchive", "Housing");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Unarchive", exact: true })
    .click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "couldn't confirm this action",
  );
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Close for now" })
    .click();
  await expect(
    page.getByRole("button", { name: "Add category", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Resume action" }).click();
  const replay = page.waitForResponse((response) =>
    response.url().endsWith("/unarchive"),
  );
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Retry action" })
    .click();
  expect((await replay).headers()["idempotency-replayed"]).toBe("true");
  expect(requests[1]).toEqual(requests[0]);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expectCategoryAction(page, "unarchive", "Utilities", "enabled");
  await clickCategoryAction(page, "unarchive", "Utilities");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Unarchive", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  // Nothing is archived now, so the chips are gone and everything shows.
  await expect(statusChip(page, "Active")).toHaveCount(0);
  await expandAll(page);
  await expect(actionsFor(page, "Housing")).toBeVisible();
  await expect(actionsFor(page, "Utilities")).toBeVisible();
  await expectAlignedCategoryActions(page);
  await page.getByRole("button", { name: "Add category", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await chooseCategory(dialog, "Parent category", root.name);
  await expect(
    dialog.getByLabel("Parent category", { exact: true }),
  ).toHaveValue(root.name);
  await page.keyboard.press("Escape");
  await page.reload();
  await expandAll(page);
  await expect(actionsFor(page, "Housing")).toBeVisible();
  await expect(actionsFor(page, "Utilities")).toBeVisible();
});
