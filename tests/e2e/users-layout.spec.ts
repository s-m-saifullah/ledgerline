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

// Users and the first-sign-in card in a real browser (ADR 0048, slice 5), against the approved prototype: jsdom cannot
// run container queries, so the rows' targets, the sheet against the drawer, the centred question, the card's width
// and the focus rings are measured here. The account and the people are mocked, so no real account is changed.
const { env, pool } = connectLocalDatabase("Users layout browser tests");
const fixtures: string[] = [];
test.beforeEach(async ({ page }, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop",
    "one project is enough: these tests set their own widths",
  );
  const ledgerId = newId();
  fixtures.push(ledgerId);
  await createOwnerLedger(pool, env, ledgerId, "E2E users layout ledger");
  await prepareBrowser(page, testInfo, {
    ledgerId,
    name: "Synthetic users layout ledger",
    forwarded: [232, 43],
  });
});
test.afterEach(async () => {
  for (const id of fixtures) {
    await pool.query(
      "UPDATE ledger_members SET deleted_at=now(), updated_at=now() WHERE ledger_id=$1",
      [id],
    );
    await pool.query(
      "UPDATE ledgers SET deleted_at=now(), updated_at=now() WHERE id=$1 AND name LIKE 'E2E users layout ledger%'",
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
const question = (page: Page) => page.locator(".ui-question");

const adminId = newId();
const person = (over: Record<string, unknown> = {}) => ({
  id: newId(),
  name: "Jordan Lee",
  email: "jordan@example.com",
  isAdmin: false,
  mustChangePassword: false,
  disabled: false,
  twoFactorEnabled: false,
  createdAt: "2026-11-03T10:00:00.000Z",
  ...over,
});
const sam = person({
  id: adminId,
  name: "Sam Lee",
  email: "sam@example.com",
  isAdmin: true,
  twoFactorEnabled: true,
});
const jordan = person({ twoFactorEnabled: true });
const riley = person({
  name: "Riley Park",
  email: "riley@example.com",
  mustChangePassword: true,
});
const casey = person({
  name: "Casey Ng",
  email: "casey@example.com",
  disabled: true,
});
const LONG_NAME = "Alexandria Montgomery-Featherstonehaugh";
const LONG_EMAIL = "alexandria.montgomery-featherstonehaugh@example.com";

type Calls = {
  post: unknown[];
  others: { method: string; url: string; body: unknown }[];
};
/** Mocks who I am and the people: the list, adding one, and every action on one. */
async function mockPeople(
  page: Page,
  {
    isAdmin = true,
    people = [sam, jordan, riley, casey],
  }: { isAdmin?: boolean; people?: Record<string, unknown>[] } = {},
) {
  const calls: Calls = { post: [], others: [] };
  const list = [...people];
  await page.route(/\/api\/v1\/me$/, (route) =>
    route.fulfill({
      json: {
        id: adminId,
        name: "Sam Lee",
        email: "sam@example.com",
        isAdmin,
        mustChangePassword: false,
        twoFactorEnabled: true,
      },
    }),
  );
  await page.route(/\/api\/v1\/users$/, (route) => {
    const request = route.request();
    if (request.method() === "POST") {
      const body = request.postDataJSON();
      calls.post.push(body);
      const added = person({
        name: body.name,
        email: body.email,
        mustChangePassword: true,
      });
      list.push(added);
      return route.fulfill({ status: 201, json: added });
    }
    return route.fulfill({ json: { items: list } });
  });
  await page.route(/\/api\/v1\/users\/[^/]+(\/.*)?$/, (route) => {
    const request = route.request();
    calls.others.push({
      method: request.method(),
      url: new URL(request.url()).pathname,
      body: request.postDataJSON?.() ?? null,
    });
    return request.method() === "PATCH"
      ? route.fulfill({ json: jordan })
      : route.fulfill({ status: 204, body: "" });
  });
  return calls;
}
async function open(
  page: Page,
  width: number,
  theme?: "light" | "dark",
  options: Parameters<typeof mockPeople>[1] = {},
) {
  const calls = await mockPeople(page, options);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width, height: 900 });
  await signIn(page);
  await page.goto("/users");
  await page.waitForFunction(
    () => getComputedStyle(document.body).containerType === "inline-size",
  );
  if (theme) await setTheme(page, theme);
  await expect(
    page.getByRole("heading", { name: "Users", level: 1 }),
  ).toBeVisible();
  // The page is built again once the ledger has loaded (the Add button turns on): measure after that.
  await expect(page.locator("#add-transaction")).toBeEnabled();
  return calls;
}
const rowFor = (page: Page, name: RegExp) =>
  page.locator(".us-page .ui-row", { hasText: name });
/** Opens the Add sheet from whichever Add the width shows. */
async function openAdd(page: Page) {
  const header = page.locator("#add-user");
  if (await header.isVisible()) await header.click();
  else await page.locator("#mobile-add-page").click();
  await expect(sheet(page)).toBeVisible();
  await settled(sheet(page));
}

for (const theme of ["light", "dark"] as const)
  for (const width of [320, 390, 1280])
    test(`fits ${width} px in ${theme}: one card of people, every row a real target, nothing cut`, async ({
      page,
    }) => {
      await open(page, width, theme);
      expect(await noSideways(page)).toBe(true);
      await expect(page.locator(".us-page .ui-row")).toHaveCount(4);
      for (const row of await page.locator(".us-page .ui-row").all()) {
        expect((await box(row)).height).toBeGreaterThanOrEqual(56);
        expect(await is44(page, row)).toBe(true);
      }
      await expect(rowFor(page, /Sam Lee/)).toContainText("Admin");
      await expect(rowFor(page, /Sam Lee/)).toContainText("You");
      await expect(rowFor(page, /Riley Park/)).toContainText(
        "Temporary password",
      );
      await expect(rowFor(page, /Casey Ng/)).toContainText("Disabled");
      await expect(rowFor(page, /Jordan Lee/)).not.toContainText(
        /Admin|Disabled|Temporary/,
      );
      // Where the pill sits: under the email on a phone, beside it from 700 px.
      const riley = rowFor(page, /Riley Park/);
      const email = await box(riley.locator(".ui-row-hint"));
      const pill = await box(riley.locator(".ui-pill"));
      if (width < 700)
        expect(pill.y).toBeGreaterThanOrEqual(email.y + email.height - 1);
      else expect(pill.x).toBeGreaterThanOrEqual(email.x + email.width);
      // And an email is never broken into pieces: it is one line.
      expect(email.height).toBeLessThan(20);
      // One heading and no subtitle.
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("Users");
      expect(await page.locator(".page-heading p").count()).toBe(0);
      // The pills stay on one line.
      for (const pill of await page.locator(".us-page .ui-pill").all())
        expect(await cut(pill)).toBe(true);
    });

test("a long name and email wrap in their row, never cut or pushed past the edge", async ({
  page,
}) => {
  await open(page, 320, undefined, {
    people: [
      sam,
      person({ name: LONG_NAME, email: LONG_EMAIL, mustChangePassword: true }),
    ],
  });
  const row = await box(rowFor(page, /Alexandria/));
  for (const part of await rowFor(page, /Alexandria/)
    .locator(".ui-row-title, .ui-row-hint")
    .all()) {
    // The words themselves end inside the row (a title that only grows its own box would pass a scroll-width check).
    const at = await box(part);
    expect(at.x + at.width).toBeLessThanOrEqual(row.x + row.width + 0.5);
    expect(at.height).toBeGreaterThan(0);
  }
  // A name this long needs more than one line.
  expect((await box(rowFor(page, /Alexandria/))).height).toBeGreaterThan(70);
  expect(await noSideways(page)).toBe(true);
});

test("only you: one row and a calm message with its own Add user", async ({
  page,
}) => {
  await open(page, 390, undefined, { people: [sam] });
  await expect(page.locator(".us-page .ui-row")).toHaveCount(1);
  await expect(page.getByText("Only you have an account.")).toBeVisible();
  const add = page
    .locator(".ui-empty")
    .getByRole("button", { name: "Add user" });
  expect(await is44(page, add)).toBe(true);
  await add.click();
  await expect(page.getByRole("dialog", { name: "Add user" })).toBeVisible();
});

test("your own row opens Profile, not a sheet", async ({ page }) => {
  await open(page, 390);
  await rowFor(page, /Sam Lee/).click();
  await expect(page).toHaveURL(/\/profile$/);
});

test("a phone has one Add button that adds a user and a back arrow to More; from 700 px the page has its own Add", async ({
  page,
}) => {
  await open(page, 390);
  await expect(page.locator("#mobile-add-page")).toBeVisible();
  await expect(page.locator("#mobile-add-page")).toHaveAccessibleName(
    "Add user",
  );
  await expect(page.locator("#add-user")).toBeHidden();
  expect(await is44(page, page.locator("#mobile-add-page"))).toBe(true);
  await expect(page.getByRole("link", { name: "Back to More" })).toBeVisible();
  await expect(
    page.getByRole("link", { name: "More", exact: true }).last(),
  ).toHaveAttribute("aria-current", "page");
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(page.locator("#add-user")).toBeVisible();
  expect(await is44(page, page.locator("#add-user"))).toBe(true);
});

test("More lists Users last in its last group for the admin, and the sidebar and palette find it", async ({
  page,
}) => {
  await mockPeople(page);
  await page.setViewportSize({ width: 390, height: 900 });
  await signIn(page);
  await page.goto("/more");
  const group = page.getByRole("region", { name: "Data and preferences" });
  await expect(group.getByRole("link")).toHaveText([
    /Import and export/,
    /Settings/,
    /Users/,
  ]);
  expect(await is44(page, group.getByRole("link", { name: /^Users/ }))).toBe(
    true,
  );
  await group.getByRole("link", { name: /^Users/ }).click();
  await expect(page).toHaveURL(/\/users$/);
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(
    page
      .getByRole("navigation", { name: "More pages" })
      .getByRole("link", { name: "Users" }),
  ).toHaveAttribute("aria-current", "page");
  await page.goto("/transactions");
  // The app opens once /me has answered: the palette's key needs the shell.
  await expect(page.locator(".ui-side-who")).toBeVisible();
  await page.keyboard.press("Control+k");
  await page
    .getByRole("searchbox", { name: "Search pages and actions" })
    .fill("users");
  await page.getByRole("button", { name: "Users" }).click();
  await expect(page).toHaveURL(/\/users$/);
});

test("anyone else sees no Users in More, the sidebar or the palette, and the page says it is not theirs", async ({
  page,
}) => {
  await mockPeople(page, { isAdmin: false });
  await page.setViewportSize({ width: 1280, height: 900 });
  await signIn(page);
  await page.goto("/more");
  await expect(
    page.getByRole("link", { name: /Profile and password/ }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: /^Users/ })).toHaveCount(0);
  await expect(page.locator(".ui-side-who")).toBeVisible();
  await expect(
    page
      .getByRole("navigation", { name: "More pages" })
      .getByRole("link", { name: "Settings" }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("navigation", { name: "More pages" })
      .getByRole("link", { name: "Users" }),
  ).toHaveCount(0);
  await page.keyboard.press("Control+k");
  const search = page.getByRole("searchbox", {
    name: "Search pages and actions",
  });
  await search.fill("users");
  // The palette is open and does know pages: it finds Settings when asked, but no Users.
  await search.fill("sett");
  await expect(page.getByRole("button", { name: "Settings" })).toBeVisible();
  await search.fill("users");
  await expect(page.getByRole("button", { name: "Users" })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.goto("/users");
  await expect(
    page.getByText("Only the admin can manage users."),
  ).toBeVisible();
  await expect(page.locator("#add-user")).toHaveCount(0);
});

test("a phone's sheet is a bottom sheet and from 700 px a right-hand drawer, for Add user and a person", async ({
  page,
}) => {
  await open(page, 390);
  await openAdd(page);
  let at = await settled(sheet(page));
  expect(at.width).toBeCloseTo(390, 0);
  expect(at.y + at.height).toBeCloseTo(900, 0);
  await page.keyboard.press("Escape");
  await expect(sheet(page)).toBeHidden();
  await rowFor(page, /Jordan Lee/).click();
  at = await settled(sheet(page));
  expect(at.width).toBeCloseTo(390, 0);
  await page.keyboard.press("Escape");
  await expect(sheet(page)).toBeHidden();
  await page.setViewportSize({ width: 1280, height: 900 });
  await openAdd(page);
  at = await settled(sheet(page));
  expect(at.width).toBeCloseTo(440, 0);
  expect(at.x + at.width).toBeCloseTo(1280, 0);
  await page.keyboard.press("Escape");
  await expect(sheet(page)).toBeHidden();
  await rowFor(page, /Jordan Lee/).click();
  at = await settled(sheet(page));
  expect(at.x + at.width).toBeCloseTo(1280, 0);
});

test("Add user: opens on Name, the password is shown whole, 44 px rows, a visible focus ring, and the request carries the password shown", async ({
  page,
}) => {
  const calls = await open(page, 390, "dark");
  await openAdd(page);
  const name = page.getByLabel("Name", { exact: true });
  await expect(name).toBeFocused();
  for (const input of [name, page.getByLabel("Email", { exact: true })]) {
    // The row itself is as tall as every other row, not only its field.
    expect(
      (
        await box(
          input.locator("xpath=ancestor::div[contains(@class,'us-input-row')]"),
        )
      ).height,
    ).toBeGreaterThanOrEqual(56);
    expect((await box(input)).height).toBeGreaterThanOrEqual(43.9);
    expect(await is44(page, input)).toBe(true);
  }
  const ring = await name.evaluate((node) => {
    const style = getComputedStyle(node);
    const row = node.closest(".us-input-row");
    const rowStyle = row ? getComputedStyle(row) : style;
    return (
      style.outlineStyle !== "none" ||
      style.boxShadow !== "none" ||
      rowStyle.outlineStyle !== "none" ||
      rowStyle.boxShadow !== "none"
    );
  });
  expect(ring).toBe(true);
  const password = page.getByTestId("temporary-password");
  const first = (await password.textContent()) ?? "";
  expect(first).toMatch(/^[a-z]+-[a-z]+-\d{4}-[a-z]+$/);
  // The whole password is on screen, in a monospace face.
  expect(await cut(password)).toBe(true);
  expect(
    await password.evaluate((node) => getComputedStyle(node).fontFamily),
  ).toMatch(/mono|Menlo|Consolas/i);
  for (const action of ["Copy", "Make a new one"]) {
    const button = sheet(page).getByRole("button", {
      name: new RegExp(action),
    });
    expect((await box(button)).height).toBeGreaterThanOrEqual(56);
    expect(await is44(page, button)).toBe(true);
  }
  await sheet(page)
    .getByRole("button", { name: /Make a new one/ })
    .click();
  const second = (await password.textContent()) ?? "";
  expect(second).not.toBe(first);
  expect(await noSideways(page)).toBe(true);
  await name.fill("Avery Stone");
  await page.getByLabel("Email", { exact: true }).fill("avery@example.com");
  await sheet(page).getByRole("button", { name: "Add user" }).click();
  await expect(sheet(page)).toBeHidden();
  expect(calls.post).toEqual([
    {
      name: "Avery Stone",
      email: "avery@example.com",
      temporaryPassword: second,
    },
  ]);
  await expect(page.getByRole("status")).toContainText(
    "Avery can sign in. They set their own password first.",
  );
  await expect(rowFor(page, /Avery Stone/)).toContainText("Temporary password");
  // The password is gone from the page for good.
  expect(await page.locator("body").textContent()).not.toContain(second);
  await expect(page.locator("#mobile-add-page")).toBeFocused();
});

test("a person's sheet lists what fits them, with Delete user the only red", async ({
  page,
}) => {
  await open(page, 390, "light");
  await rowFor(page, /Jordan Lee/).click();
  await settled(sheet(page));
  await expect(sheet(page).locator(".ui-row-title")).toHaveText([
    "Reset password",
    "Turn off two-factor",
    "Sign out their devices",
    "Stop sign-in",
    "Delete user",
  ]);
  const danger = sheet(page).locator(".us-danger");
  await expect(danger).toHaveText("Delete user");
  const colors = await sheet(page)
    .locator(".ui-row-title")
    .evaluateAll((nodes) => nodes.map((n) => getComputedStyle(n).color));
  expect(new Set(colors.slice(0, 4)).size).toBe(1);
  expect(colors[4]).not.toBe(colors[0]);
  for (const row of await sheet(page).locator(".ui-row").all()) {
    expect((await box(row)).height).toBeGreaterThanOrEqual(56);
    expect(await is44(page, row)).toBe(true);
  }
  await page.keyboard.press("Escape");
  await rowFor(page, /Riley Park/).click();
  await settled(sheet(page));
  await expect(sheet(page).locator(".ui-row-title")).toHaveText([
    "Reset password",
    "Sign out their devices",
    "Stop sign-in",
    "Delete user",
  ]);
  await expect(sheet(page)).toContainText("Still on a temporary password");
  await page.keyboard.press("Escape");
  await rowFor(page, /Casey Ng/).click();
  await settled(sheet(page));
  await expect(sheet(page).locator(".ui-row-title")).toContainText([
    "Reset password",
    "Sign out their devices",
    "Allow sign-in again",
    "Delete user",
  ]);
});

test("Reset password swaps the sheet to a new temporary password and sends the one shown", async ({
  page,
}) => {
  const calls = await open(page, 1280);
  await rowFor(page, /Jordan Lee/).click();
  await settled(sheet(page));
  await sheet(page)
    .getByRole("button", { name: /Reset password/ })
    .click();
  await expect(
    page.getByRole("dialog", { name: "New temporary password" }),
  ).toBeVisible();
  const shown =
    (await page.getByTestId("temporary-password").textContent()) ?? "";
  expect(shown).toMatch(/^[a-z]+-[a-z]+-\d{4}-[a-z]+$/);
  await sheet(page).getByRole("button", { name: "Reset password" }).click();
  await expect(sheet(page)).toBeHidden();
  expect(calls.others).toEqual([
    {
      method: "POST",
      url: `/api/v1/users/${jordan.id}/password`,
      body: { temporaryPassword: shown },
    },
  ]);
  await expect(page.getByRole("status")).toContainText(
    "Password reset for Jordan.",
  );
  expect(await page.locator("body").textContent()).not.toContain(shown);
});

test("a question is a centred dialog over the sheet; Delete needs the email and then removes the person", async ({
  page,
}) => {
  const calls = await open(page, 390);
  await rowFor(page, /Jordan Lee/).click();
  await settled(sheet(page));
  await sheet(page)
    .getByRole("button", { name: /Delete user/ })
    .click();
  const ask = question(page);
  await expect(ask).toBeVisible();
  const at = await settled(ask);
  // Centred on the screen, with room either side, not a sheet.
  expect(at.x + at.width / 2).toBeCloseTo(195, -1);
  expect(at.y + at.height / 2).toBeCloseTo(450, -2);
  expect(at.width).toBeLessThan(390);
  await expect(ask.getByRole("heading")).toHaveText(
    "Delete Jordan and their ledger?",
  );
  const confirm = ask.getByRole("button", { name: "Delete", exact: true });
  await expect(confirm).toBeDisabled();
  const typed = ask.getByLabel("Type their email to confirm");
  await expect(typed).toHaveAttribute("placeholder", "jordan@example.com");
  expect(await is44(page, typed)).toBe(true);
  await typed.fill("jordan@example.com");
  await expect(confirm).toBeEnabled();
  // The one filled red button on the screen.
  const bg = await confirm.evaluate((n) => getComputedStyle(n).backgroundColor);
  const cancel = await ask
    .getByRole("button", { name: "Cancel" })
    .evaluate((n) => getComputedStyle(n).backgroundColor);
  expect(bg).not.toBe(cancel);
  await confirm.click();
  await expect(question(page)).toBeHidden();
  await expect(sheet(page)).toBeHidden();
  expect(calls.others).toEqual([
    {
      method: "DELETE",
      url: `/api/v1/users/${jordan.id}`,
      body: expect.anything(),
    },
  ]);
  await expect(page.getByRole("status")).toContainText("User deleted.");
});

test("Stop sign-in and Sign out their devices each ask first and then write", async ({
  page,
}) => {
  const calls = await open(page, 1280);
  await rowFor(page, /Jordan Lee/).click();
  await settled(sheet(page));
  await sheet(page)
    .getByRole("button", { name: /Stop sign-in/ })
    .click();
  await expect(question(page).getByRole("heading")).toHaveText(
    "Stop Jordan signing in?",
  );
  expect(calls.others).toEqual([]);
  await question(page).getByRole("button", { name: "Stop sign-in" }).click();
  await expect(sheet(page)).toBeHidden();
  expect(calls.others.map((call) => [call.method, call.url])).toEqual([
    ["PATCH", `/api/v1/users/${jordan.id}`],
  ]);
  await expect(page.getByRole("status")).toContainText(
    "Jordan can no longer sign in.",
  );
});

for (const theme of ["light", "dark"] as const)
  for (const width of [320, 390, 1280])
    test(`has no accessibility violations at ${width} px in ${theme}: the page, Add user, a person and a question`, async ({
      page,
    }) => {
      await open(page, width, theme);
      const violations = async () =>
        (await new AxeBuilder({ page }).analyze()).violations.map(
          (item) => item.id,
        );
      expect(await violations()).toEqual([]);
      await openAdd(page);
      expect(await violations()).toEqual([]);
      await page.keyboard.press("Escape");
      await expect(sheet(page)).toBeHidden();
      await rowFor(page, /Jordan Lee/).click();
      await settled(sheet(page));
      expect(await violations()).toEqual([]);
      await sheet(page)
        .getByRole("button", { name: /Delete user/ })
        .click();
      await settled(question(page));
      expect(await violations()).toEqual([]);
    });

/* ---------- The first sign-in card ---------- */

async function mockFirstSignIn(page: Page, { temp = true } = {}) {
  const calls: { password: unknown[]; signOut: number } = {
    password: [],
    signOut: 0,
  };
  let mustChange = temp;
  await page.route(/\/api\/v1\/me$/, (route) =>
    route.fulfill({
      json: {
        id: newId(),
        name: "Riley Park",
        email: "riley@example.com",
        isAdmin: false,
        mustChangePassword: mustChange,
        twoFactorEnabled: false,
      },
    }),
  );
  await page.route(/\/api\/v1\/me\/password$/, (route) => {
    calls.password.push(route.request().postDataJSON());
    mustChange = false;
    return route.fulfill({ status: 204, body: "" });
  });
  await page.route(/\/api\/v1\/auth\/sign-out$/, (route) => {
    calls.signOut += 1;
    return route.fulfill({ status: 200, json: { success: true } });
  });
  return calls;
}
async function openCard(
  page: Page,
  width: number,
  theme: "light" | "dark" = "light",
) {
  const calls = await mockFirstSignIn(page);
  await page.emulateMedia({ reducedMotion: "reduce", colorScheme: theme });
  await page.setViewportSize({ width, height: 900 });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Choose a new password" }),
  ).toBeVisible();
  return calls;
}

for (const theme of ["light", "dark"] as const)
  for (const width of [320, 390, 1280])
    test(`the first-sign-in card at ${width} px in ${theme}: one centred card, no shell, rows and buttons are real targets`, async ({
      page,
    }) => {
      await openCard(page, width, theme);
      expect(await noSideways(page)).toBe(true);
      // No shell: nothing to navigate to.
      await expect(page.getByRole("navigation")).toHaveCount(0);
      await expect(page.locator(".ui-shell")).toHaveCount(0);
      const card = await box(page.locator(".au-box"));
      expect(card.width).toBeLessThanOrEqual(400.5);
      expect(card.x + card.width / 2).toBeCloseTo(width / 2, 0);
      for (const label of [
        "Temporary password",
        "New password",
        "Confirm New",
      ]) {
        const input = page.getByLabel(label, { exact: true });
        expect((await box(input)).height).toBeGreaterThanOrEqual(43.9);
        expect(await is44(page, input)).toBe(true);
        // The label is whole, never cut, even at 320 px.
        expect(
          await cut(
            page.locator(`label[for="${await input.getAttribute("id")}"]`),
          ),
        ).toBe(true);
      }
      for (const name of ["Save and continue", "Sign out"]) {
        const button = page.getByRole("button", { name });
        expect((await box(button)).height).toBeGreaterThanOrEqual(43.9);
        expect(await is44(page, button)).toBe(true);
      }
      // One heading, no visible subtitle.
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(
        "Choose a new password",
      );
      await expect(
        page.getByText("Your password was set by the admin."),
      ).toHaveClass(/sr-only/);
      expect(
        (await new AxeBuilder({ page }).analyze()).violations.map((v) => v.id),
      ).toEqual([]);
    });

test("saving the new password sends the temporary one as the current one, then opens the app on Home", async ({
  page,
}) => {
  const calls = await openCard(page, 390);
  await expect(page.getByLabel("Temporary password")).toBeFocused();
  await page.getByLabel("Temporary password").fill("maple-otter-1234-river");
  await page
    .getByLabel("New password", { exact: true })
    .fill("a brand new password");
  await page.getByLabel("Confirm New").fill("a brand new password");
  await page.getByRole("button", { name: "Save and continue" }).click();
  await expect(
    page.getByRole("heading", { name: "Home", exact: true }),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
  expect(calls.password).toEqual([
    {
      currentPassword: "maple-otter-1234-river",
      newPassword: "a brand new password",
      signOutOtherDevices: true,
    },
  ]);
  await expect(
    page.getByRole("heading", { name: "Choose a new password" }),
  ).toHaveCount(0);
});

test("a mistake shows on its own row and keeps the card", async ({ page }) => {
  const calls = await openCard(page, 390);
  await page.getByLabel("Temporary password").fill("maple-otter-1234-river");
  await page
    .getByLabel("New password", { exact: true })
    .fill("a brand new password");
  await page.getByLabel("Confirm New").fill("something else entirely");
  await page.getByRole("button", { name: "Save and continue" }).click();
  await expect(page.getByRole("alert")).toHaveText(
    "The two new passwords are different.",
  );
  await expect(page.getByLabel("Confirm New")).toBeFocused();
  expect(calls.password).toEqual([]);
});

test("Sign out is the one other way off the card", async ({ page }) => {
  const calls = await openCard(page, 390);
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(
    page.getByRole("heading", { name: "Welcome back" }),
  ).toBeVisible();
  expect(calls.signOut).toBe(1);
});

test("a person who has their own password never sees the card", async ({
  page,
}) => {
  await mockFirstSignIn(page, { temp: false });
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Home", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Choose a new password" }),
  ).toHaveCount(0);
});

test("any page's refusal for a required password change shows the card in the middle of a session", async ({
  page,
}) => {
  const calls = await mockFirstSignIn(page, { temp: false });
  await page.setViewportSize({ width: 390, height: 900 });
  await signIn(page);
  // From now on the server says a new password is needed, whatever page asks.
  await page.route(/\/api\/v1\/ledgers\/[^/]+\/tags\?/, (route) =>
    route.fulfill({
      status: 403,
      contentType: "application/problem+json",
      json: {
        type: "urn:ledgerline:problem:password-change-required",
        title: "Forbidden",
        status: 403,
        detail: "Choose a new password first.",
      },
    }),
  );
  await page.goto("/tags");
  await expect(
    page.getByRole("heading", { name: "Choose a new password" }),
  ).toBeVisible();
  await expect(page.getByRole("navigation")).toHaveCount(0);
  expect(calls.password).toEqual([]);
});
