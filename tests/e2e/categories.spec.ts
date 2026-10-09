import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { expect, type Page, test } from "@playwright/test";
import { createDatabase } from "../../apps/api/src/db/client";
import {
  type Category,
  categorySchema,
  newId,
} from "../../packages/shared/src/index";
import { clickCategoryAction, expectCategoryAction } from "./category-actions";
import { chooseCategory } from "./category-picker";
import { signIn } from "./sign-in";
import { setTheme } from "./theme";

const env = parseEnv(readFileSync(".env", "utf8"));
const databaseUrl = env.DATABASE_URL;
if (
  !databaseUrl ||
  !["localhost", "127.0.0.1"].includes(new URL(databaseUrl).hostname) ||
  !["/ledgerline", "/ledgerline_test"].includes(new URL(databaseUrl).pathname)
)
  throw new Error(
    "Category browser tests require the local development database.",
  );
const { pool } = createDatabase(databaseUrl);
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
  await page
    .getByRole("link", { name: "More", exact: true })
    .filter({ visible: true })
    .click();
  await page.getByRole("link", { name: /^Categories/ }).click();
  await expect(
    page.getByRole("heading", { name: "Categories", exact: true }),
  ).toBeVisible();
}
async function expectInsetArrows(page: Page) {
  for (const wrapper of await page.locator(".category-select").all()) {
    const select = wrapper.locator("select");
    const arrow = wrapper.locator("svg");
    const bounds = await select.boundingBox();
    const arrowBounds = await arrow.boundingBox();
    expect(bounds).not.toBeNull();
    expect(arrowBounds).not.toBeNull();
    if (!bounds || !arrowBounds) throw new Error("Missing dropdown bounds");
    const inset = bounds.x + bounds.width - arrowBounds.x - arrowBounds.width;
    expect(inset).toBeGreaterThanOrEqual(12);
    expect(inset).toBeLessThanOrEqual(13);
    await expect(select).toHaveCSS("appearance", "none");
    await expect(select).toHaveCSS("padding-right", "40px");
    await expect(arrow).toHaveAttribute("aria-hidden", "true");
  }
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
  await dialog.getByLabel("Category icon").selectOption("shopping-bag");
  await dialog.getByLabel("Category color").selectOption("#2563EB");
  const response = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      /\/categories$/.test(response.url()),
  );
  await dialog
    .getByRole("button", { name: "Add category", exact: true })
    .click();
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
  await expect(page.getByText("Make room for your categories.")).toBeVisible();
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
  await dialog
    .getByRole("button", { name: "Add category", exact: true })
    .click();
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
  await expect(page.getByRole("status")).toContainText(
    "Category order updated",
  );
  await expect(
    page.locator(".category-groups article").first(),
  ).toHaveAccessibleName(other.name);
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
  await dialog.getByRole("button", { name: "Save changes" }).click();
  await expect(dialog.getByRole("alert")).toContainText(
    "This category changed",
  );
  await dialog.getByRole("button", { name: "Reload latest details" }).click();
  await expect(dialog.getByLabel("Category name")).toHaveValue(
    `${name} latest`,
  );
  await dialog.getByLabel("Category name").fill(name);
  await dialog.getByRole("button", { name: "Save changes" }).click();
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
      .getByRole("button", { name: "Archive category", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  }
  await page.getByLabel("View categories").selectOption("active");
  await expect(
    page.getByRole("article", { name: root.name, exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Add category", exact: true }).click();
  await expect(
    page
      .getByRole("dialog")
      .getByRole("option", { name: root.name, exact: true }),
  ).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.getByLabel("View categories").selectOption("archived");
  await expect(
    page.getByRole("article", { name: root.name, exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("article", { name: child.name, exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("article", { name: root.name, exact: true }),
  ).toBeVisible();
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
    expect(first.height).toBeGreaterThanOrEqual(48);
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
  await expect(page.getByRole("article")).toHaveCount(28);
  await page.getByRole("button", { name: "Income", exact: true }).click();
  await expect(page.getByRole("article")).toHaveCount(9);
  await expect(
    page.getByRole("article", { name: "Salary & wages", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Add category", exact: true }).click();
  dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("Category name")).toBeFocused();
  await expect(dialog.getByLabel("Category kind")).toHaveValue("income");
  await dialog.getByLabel("Category name").fill("E2E keyboard preview");
  await expect(page.locator(".category-select")).toHaveCount(4);
  await expectInsetArrows(page);
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
  const bounds = await dialog.boundingBox();
  expect(bounds?.x).toBeGreaterThanOrEqual(0);
  expect(bounds?.y).toBeGreaterThanOrEqual(0);
  expect((bounds?.y ?? 0) + (bounds?.height ?? 0)).toBeLessThanOrEqual(
    page.viewportSize()?.height ?? 0,
  );
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
  await expect(
    page.locator(".category-groups article").first(),
  ).toHaveAccessibleName(other.name);
  await clickCategoryAction(page, "down", other.name);
  await expect(
    page.locator(".category-groups article").first(),
  ).toHaveAccessibleName(root.name);
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
  await expect(
    page.locator(".category-groups article").first(),
  ).toHaveAccessibleName(root.name);
  const saved = page.waitForResponse((response) =>
    response.url().endsWith("/categories/reorder"),
  );
  await clickCategoryAction(page, "up", other.name);
  expect((await saved).status()).toBe(200);
  await expect(
    page.locator(".category-groups article").first(),
  ).toHaveAccessibleName(other.name);
  expect(writes).toHaveLength(5);
  expect(writes[4]?.key).not.toBe(writes[3]?.key);
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
async function expectAlignedCategoryActions(page: Page) {
  for (const row of await page.getByRole("article").all()) {
    const bounds = await row.boundingBox();
    const heading = await row.locator(".category-row-heading").boundingBox();
    // Wide screens show the action buttons; phones show a single menu button.
    const actions = await row
      .locator(".category-controls, button[aria-haspopup='menu']")
      .first()
      .boundingBox();
    if (!bounds || !heading || !actions)
      throw new Error("Missing category bounds");
    expect(
      Math.abs(heading.y + heading.height / 2 - actions.y - actions.height / 2),
    ).toBeLessThan(1);
    expect(heading.x + heading.width).toBeLessThanOrEqual(actions.x);
    // The category name keeps real room on every width (it used to shrink to one letter on phones).
    expect(heading.width).toBeGreaterThanOrEqual(120);
    for (const button of await row.getByRole("button").all()) {
      const target = await button.boundingBox();
      if (!target) throw new Error("Missing action bounds");
      expect(target.width).toBeGreaterThanOrEqual(44);
      expect(target.height).toBeGreaterThanOrEqual(44);
      expect(target.x + target.width).toBeLessThanOrEqual(
        bounds.x + bounds.width,
      );
      expect(target.y + target.height).toBeLessThanOrEqual(
        bounds.y + bounds.height,
      );
      await expect(button).toHaveAttribute("title", /.+/);
      await expect(button).toHaveText("");
    }
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
      .getByRole("button", { name: "Archive category", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  }
  await page.getByLabel("View categories").selectOption("archived");
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
    .getByRole("button", { name: "Unarchive category", exact: true })
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
    .getByRole("button", { name: "Unarchive category", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByLabel("View categories").selectOption("active");
  await expect(
    page.getByRole("article", { name: "Housing", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("article", { name: "Utilities", exact: true }),
  ).toBeVisible();
  await expectAlignedCategoryActions(page);
  await page.getByRole("button", { name: "Add category", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await chooseCategory(dialog, "Parent category", root.name);
  await expect(
    dialog.getByLabel("Parent category", { exact: true }),
  ).toHaveValue(root.name);
  await page.keyboard.press("Escape");
  await page.reload();
  await expect(
    page.getByRole("article", { name: "Housing", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("article", { name: "Utilities", exact: true }),
  ).toBeVisible();
});
