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

// Profile in a real browser (ADR 0048, slice 4), against the approved prototype: jsdom cannot run container queries,
// so the columns, the rows' targets, the sheet against the drawer, the focus rings and the sidebar link are measured
// here. The account and the devices are mocked, so the real account is never changed.
const { env, pool } = connectLocalDatabase("Profile layout browser tests");
const fixtures: string[] = [];
test.beforeEach(async ({ page }, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop",
    "one project is enough: these tests set their own widths",
  );
  const ledgerId = newId();
  fixtures.push(ledgerId);
  await createOwnerLedger(pool, env, ledgerId, "E2E profile layout ledger");
  await prepareBrowser(page, testInfo, {
    ledgerId,
    name: "Synthetic profile layout ledger",
    forwarded: [232, 42],
  });
});
test.afterEach(async () => {
  for (const id of fixtures) {
    await pool.query(
      "UPDATE ledger_members SET deleted_at=now(), updated_at=now() WHERE ledger_id=$1",
      [id],
    );
    await pool.query(
      "UPDATE ledgers SET deleted_at=now(), updated_at=now() WHERE id=$1 AND name LIKE 'E2E profile layout ledger%'",
      [id],
    );
  }
  fixtures.length = 0;
});
test.afterAll(async () => {
  await pool.end();
});

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
    if (
      Math.abs(next.x - last.x) < 0.5 &&
      Math.abs(next.y - last.y) < 0.5 &&
      Math.abs(next.width - last.width) < 0.5 &&
      Math.abs(next.height - last.height) < 0.5
    )
      return next;
    last = next;
  }
  throw new Error("never settled");
}
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
      const control = target?.closest("button, a, label, summary, input");
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
const cut = (node: Locator) =>
  node.evaluate((n) => n.scrollWidth <= n.clientWidth + 1);
const sheet = (page: Page) => page.locator(".ui-sheet");

const NAME = "Sam Lee";
const EMAIL = "sam@example.com";
const LONG_NAME = "Alexandria Montgomery-Featherstonehaugh";
const LONG_EMAIL = "alexandria.montgomery-featherstonehaugh@example.com";
const device = (name: string, current: boolean) => ({
  id: newId(),
  current,
  device: name,
  createdAt: "2026-10-01T10:00:00.000Z",
  lastUsedAt: "2026-10-21T15:04:00.000Z",
  expiresAt: "2026-12-01T10:00:00.000Z",
});
type Calls = { patch: unknown[]; password: unknown[] };
/** Mocks the account: who I am, the devices, a rename and a password change. */
async function mockAccount(
  page: Page,
  { name = NAME, email = EMAIL, isAdmin = true, twoFactor = true } = {},
) {
  const calls: Calls = { patch: [], password: [] };
  let current = name;
  await page.route(/\/api\/v1\/me$/, (route) => {
    const request = route.request();
    if (request.method() === "PATCH") {
      const body = request.postDataJSON();
      calls.patch.push(body);
      current = body.name;
    }
    return route.fulfill({
      json: {
        id: newId(),
        name: current,
        email,
        isAdmin,
        mustChangePassword: false,
        twoFactorEnabled: twoFactor,
      },
    });
  });
  await page.route("**/api/v1/me/password", (route) => {
    calls.password.push(route.request().postDataJSON());
    return route.fulfill({ status: 204, body: "" });
  });
  await page.route("**/api/v1/sessions", (route) =>
    route.request().method() === "GET"
      ? route.fulfill({
          json: {
            items: [
              device("Chrome on macOS", true),
              device("Ledgerline Android app", false),
            ],
          },
        })
      : route.fulfill({ status: 204, body: "" }),
  );
  return calls;
}
async function open(
  page: Page,
  width: number,
  theme?: "light" | "dark",
  account: Parameters<typeof mockAccount>[1] = {},
) {
  const calls = await mockAccount(page, account);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width, height: 900 });
  await signIn(page);
  await page.goto("/profile");
  await page.waitForFunction(
    () => getComputedStyle(document.body).containerType === "inline-size",
  );
  if (theme) await setTheme(page, theme);
  await expect(page.locator("#profile-account")).toBeVisible();
  return calls;
}
const section = (page: Page, name: string) =>
  page.getByRole("region", { name, exact: true });

for (const theme of ["light", "dark"] as const)
  for (const width of [320, 390, 1280])
    test(`fits ${width} px in ${theme}: three labelled groups, rows are real targets, nothing cut`, async ({
      page,
    }) => {
      await open(page, width, theme);
      expect(await noSideways(page)).toBe(true);
      for (const name of ["Account", "Password", "Security"])
        await expect(section(page, name)).toBeVisible();
      for (const row of [
        page.locator("#profile-account"),
        page.locator("#profile-password"),
        page.getByRole("link", { name: /Two-factor/ }),
        page.getByRole("link", { name: /Signed-in devices/ }),
      ]) {
        expect((await box(row)).height).toBeGreaterThanOrEqual(56);
        expect(await is44(page, row)).toBe(true);
      }
      await expect(
        page.getByRole("link", { name: /Signed-in devices/ }),
      ).toContainText("2");
      // The page's title and no subtitle.
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(
        "Profile",
      );
      expect(await page.locator(".page-heading p").count()).toBe(0);
      expect(await noSideways(page)).toBe(true);
    });

test("a long name and email wrap in their row, never cut or pushed past the edge", async ({
  page,
}) => {
  await open(page, 320, undefined, { name: LONG_NAME, email: LONG_EMAIL });
  for (const part of await page
    .locator("#profile-account .ui-row-title, #profile-account .ui-row-hint")
    .all())
    expect(await cut(part)).toBe(true);
  expect(await noSideways(page)).toBe(true);
});

test("one column on a phone in the order Account, Password, Security; two from 700 px, with the tops of the cards level", async ({
  page,
}) => {
  await open(page, 390);
  const tops = async () => ({
    account: (await box(section(page, "Account"))).y,
    password: (await box(section(page, "Password"))).y,
    security: (await box(section(page, "Security"))).y,
  });
  const phone = await tops();
  expect(phone.account).toBeLessThan(phone.password);
  expect(phone.password).toBeLessThan(phone.security);
  const column = (await box(section(page, "Account"))).x;
  expect((await box(section(page, "Security"))).x).toBeCloseTo(column, 0);
  await page.setViewportSize({ width: 1280, height: 900 });
  const wide = await tops();
  // Both columns open with a label row, so the two first cards start on one line.
  expect(wide.security).toBeCloseTo(wide.account, 0);
  const left = await box(page.locator("#profile-account"));
  const right = await box(page.getByRole("link", { name: /Two-factor/ }));
  expect(right.y).toBeCloseTo(left.y, 0);
  expect(right.x).toBeGreaterThan(left.x + left.width - 1);
  const card = await box(page.locator(".pf-cols"));
  expect(card.width).toBeGreaterThan(600);
});

test("the Admin pill shows for the admin only, and Two-factor says On or Off", async ({
  page,
}) => {
  await open(page, 390, undefined, { isAdmin: true, twoFactor: true });
  await expect(page.locator("#profile-account")).toContainText("Admin");
  await expect(page.getByRole("link", { name: /Two-factor/ })).toContainText(
    "On",
  );
  await page.unrouteAll({ behavior: "ignoreErrors" });
  await mockAccount(page, { isAdmin: false, twoFactor: false });
  await page.reload();
  await expect(page.locator("#profile-account")).toBeVisible();
  await expect(page.locator("#profile-account")).not.toContainText("Admin");
  await expect(page.getByRole("link", { name: /Two-factor/ })).toContainText(
    "Off",
  );
});

test("the rows that lead to Settings go there", async ({ page }) => {
  await open(page, 390);
  await page.getByRole("link", { name: /Two-factor/ }).click();
  await expect(page).toHaveURL(/\/settings$/);
  await page.goBack();
  await page.getByRole("link", { name: /Signed-in devices/ }).click();
  await expect(page).toHaveURL(/\/settings$/);
});

test("a phone has no Add button here and a back arrow to More; More stays lit", async ({
  page,
}) => {
  await open(page, 390);
  await expect(page.locator("#mobile-add-page")).toBeHidden();
  await expect(page.locator("#mobile-add")).toBeHidden();
  await expect(page.getByRole("link", { name: "Back to More" })).toBeVisible();
  await expect(
    page.getByRole("link", { name: "More", exact: true }).last(),
  ).toHaveAttribute("aria-current", "page");
  await page.getByRole("link", { name: "Back to More" }).click();
  await expect(page).toHaveURL(/\/more$/);
});

test("More's first card leads to Profile", async ({ page }) => {
  await mockAccount(page);
  await page.setViewportSize({ width: 390, height: 900 });
  await signIn(page);
  await page.goto("/more");
  const card = page.getByRole("link", { name: /Profile and password/ });
  await expect(card).toBeVisible();
  await expect(card).toContainText(NAME);
  await expect(card).toContainText("Admin");
  expect(await is44(page, card)).toBe(true);
  // It is above the first group.
  const group = await box(
    page.getByRole("region", { name: "Receivables and lending" }),
  );
  expect((await box(card)).y).toBeLessThan(group.y);
  await card.click();
  await expect(page).toHaveURL(/\/profile$/);
});

test("on a desktop the sidebar's name leads to Profile, says Admin, and the palette finds Profile", async ({
  page,
}) => {
  await mockAccount(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await signIn(page);
  await page.goto("/transactions");
  const who = page.locator(".ui-side-who");
  await expect(who).toBeVisible();
  await expect(who).toContainText("Admin");
  // Its name holds what is shown and says where it goes.
  await expect(who).toHaveAccessibleName(/Admin\s*,\s*Profile$/);
  expect((await box(who)).height).toBeGreaterThanOrEqual(43.9);
  // The sign-out button beside it is still its own control.
  await expect(
    page.getByRole("button", { name: "Sign out" }).first(),
  ).toBeVisible();
  await who.click();
  await expect(page).toHaveURL(/\/profile$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Profile");
  // It is a link to a page, not one of the navigation's rows: on its own page it takes no highlight.
  await page.mouse.move(700, 400);
  expect(
    await who.evaluate((node) => getComputedStyle(node).backgroundColor),
  ).toBe("rgba(0, 0, 0, 0)");
  await page.keyboard.press("Control+k");
  await page
    .getByRole("searchbox", { name: "Search pages and actions" })
    .fill("prof");
  await page.getByRole("button", { name: "Profile" }).click();
  await expect(page).toHaveURL(/\/profile$/);
});

test("the sidebar block does not change height when the answer about the admin arrives", async ({
  page,
}) => {
  // The answer is held until the test lets it go, so the block is measured before and after it, not by luck.
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(/\/api\/v1\/me$/, async (route) => {
    await held;
    await route.fulfill({
      json: {
        id: newId(),
        name: NAME,
        email: EMAIL,
        isAdmin: true,
        mustChangePassword: false,
        twoFactorEnabled: false,
      },
    });
  });
  await page.setViewportSize({ width: 1280, height: 900 });
  await signIn(page);
  await page.goto("/transactions");
  const who = page.locator(".ui-side-who");
  await expect(who).toBeVisible();
  await expect(who).not.toContainText("Admin");
  const before = await box(who);
  release();
  await expect(who).toContainText("Admin");
  await expect(async () => {
    const after = await box(who);
    expect(Math.abs(after.height - before.height)).toBeLessThan(0.5);
    expect(Math.abs(after.y - before.y)).toBeLessThan(0.5);
  }).toPass();
});

test("a phone's sheet is a bottom sheet and from 700 px a right-hand drawer, for both sheets", async ({
  page,
}) => {
  await open(page, 390);
  for (const [row, title] of [
    ["#profile-account", "Your name"],
    ["#profile-password", "Change password"],
  ] as const) {
    await page.locator(row).click();
    await expect(sheet(page)).toBeVisible();
    await expect(sheet(page).getByRole("dialog")).toHaveCount(0);
    await expect(page.getByRole("dialog", { name: title })).toBeVisible();
    const at = await settled(sheet(page));
    expect(at.width).toBeCloseTo(390, 0);
    expect(at.y + at.height).toBeCloseTo(900, 0);
    await page.keyboard.press("Escape");
    await expect(sheet(page)).toBeHidden();
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  for (const row of ["#profile-account", "#profile-password"]) {
    await page.locator(row).click();
    const at = await settled(sheet(page));
    expect(at.width).toBeCloseTo(440, 0);
    expect(at.x + at.width).toBeCloseTo(1280, 0);
    await page.keyboard.press("Escape");
    await expect(sheet(page)).toBeHidden();
  }
});

test("the name sheet opens on its field, saves with Enter, and the page and sidebar follow", async ({
  page,
}) => {
  const calls = await open(page, 1280);
  await page.locator("#profile-account").click();
  const field = page.getByLabel("Name", { exact: true });
  await expect(field).toBeFocused();
  expect((await box(field)).height).toBeGreaterThanOrEqual(43.9);
  await field.fill("Sam Park");
  await field.press("Enter");
  await expect(sheet(page)).toBeHidden();
  expect(calls.patch).toEqual([{ name: "Sam Park" }]);
  await expect(page.locator("#profile-account")).toContainText("Sam Park");
  await expect(page.getByRole("status")).toContainText("Name saved.");
  // Focus is back on the row that opened the sheet.
  await expect(page.locator("#profile-account")).toBeFocused();
});

test("the password sheet: 44 px rows, the switch on, a visible focus ring, an error on its row, and the request", async ({
  page,
}) => {
  const calls = await open(page, 390, "dark");
  await page.locator("#profile-password").click();
  await settled(sheet(page));
  const current = page.getByLabel("Current", { exact: true });
  await expect(current).toBeFocused();
  for (const label of ["Current", "New", "Repeat it"]) {
    const input = page.getByLabel(label, { exact: true });
    expect((await box(input)).height).toBeGreaterThanOrEqual(43.9);
    expect(await is44(page, input)).toBe(true);
  }
  // A keyboard user can see where they are.
  const ring = await current.evaluate((node) => {
    const style = getComputedStyle(node);
    return style.outlineStyle !== "none" || style.boxShadow !== "none";
  });
  const ringOnRow = await current.evaluate((node) => {
    const row = node.closest(".pf-input-row");
    if (!row) return false;
    const style = getComputedStyle(row);
    return style.outlineStyle !== "none" || style.boxShadow !== "none";
  });
  expect(ring || ringOnRow).toBe(true);
  const others = sheet(page).getByRole("switch", {
    name: "Sign out my other devices",
  });
  await expect(others).toBeChecked();
  expect(await is44(page, others)).toBe(true);
  expect(await noSideways(page)).toBe(true);
  // Mismatch: the message sits under the rows and the Repeat row is marked.
  await current.fill("old-password-1");
  await page.getByLabel("New", { exact: true }).fill("a-new-password-2");
  await page.getByLabel("Repeat it", { exact: true }).fill("a-new-password-3");
  await sheet(page).getByRole("button", { name: "Save password" }).click();
  await expect(sheet(page).getByRole("alert")).toHaveText(
    "The two new passwords are different.",
  );
  await expect(page.getByLabel("Repeat it", { exact: true })).toBeFocused();
  expect(calls.password).toEqual([]);
  await page.getByLabel("Repeat it", { exact: true }).fill("a-new-password-2");
  await sheet(page).getByRole("button", { name: "Save password" }).click();
  await expect(sheet(page)).toBeHidden();
  expect(calls.password).toEqual([
    {
      currentPassword: "old-password-1",
      newPassword: "a-new-password-2",
      signOutOtherDevices: true,
    },
  ]);
  await expect(page.getByRole("status")).toContainText("Password changed.");
  await expect(page.locator("#profile-password")).toBeFocused();
});

for (const theme of ["light", "dark"] as const)
  for (const width of [320, 390, 1280])
    test(`has no accessibility violations at ${width} px in ${theme}: the page and both sheets`, async ({
      page,
    }) => {
      await open(page, width, theme);
      const violations = async () =>
        (await new AxeBuilder({ page }).analyze()).violations.map(
          (item) => item.id,
        );
      expect(await violations()).toEqual([]);
      await page.locator("#profile-account").click();
      await settled(sheet(page));
      expect(await violations()).toEqual([]);
      await page.keyboard.press("Escape");
      await expect(sheet(page)).toBeHidden();
      await page.locator("#profile-password").click();
      await settled(sheet(page));
      expect(await violations()).toEqual([]);
    });
