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

// Settings in a real browser (ADR 0047, PR 6b), against the approved prototype: jsdom cannot run container queries,
// so the columns, the row and target sizes, the two-factor sheet (a bottom sheet on a phone, a drawer from 700 px)
// and the Sign-out-others question are measured here. The two-factor and devices answers are mocked, so the shared
// owner account is never changed.
const { env, pool } = connectLocalDatabase("Settings layout browser tests");
const fixtures: string[] = [];
test.beforeEach(async ({ page }, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop",
    "one project is enough: these tests set their own widths",
  );
  const ledgerId = newId();
  fixtures.push(ledgerId);
  await createOwnerLedger(pool, env, ledgerId, "E2E settings layout ledger");
  await prepareBrowser(page, testInfo, {
    ledgerId,
    name: "Synthetic settings layout ledger",
    forwarded: [226, 20],
  });
});
test.afterEach(async () => {
  for (const id of fixtures) {
    await pool.query(
      "UPDATE ledger_members SET deleted_at=now(), updated_at=now() WHERE ledger_id=$1",
      [id],
    );
    await pool.query(
      "UPDATE ledgers SET deleted_at=now(), updated_at=now() WHERE id=$1 AND name LIKE 'E2E settings layout ledger%'",
      [id],
    );
  }
  fixtures.length = 0;
});
test.afterAll(async () => {
  await pool.end();
});

const URI =
  "otpauth://totp/Ledgerline:you%40example.com?secret=JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP&issuer=Ledgerline";
const CODES = [
  "k4m2-9xqa",
  "7tpd-3wnb",
  "h8cv-2rzl",
  "q5ye-6sgm",
  "d9fj-1uxk",
  "b3na-8pwt",
  "x7ra-4ymh",
  "e2lc-5vdg",
  "z6hu-9kqn",
  "m1ts-7bje",
];
const device = (name: string, current: boolean) => ({
  id: newId(),
  current,
  device: name,
  createdAt: "2026-10-01T10:00:00.000Z",
  lastUsedAt: "2026-10-21T15:04:00.000Z",
  expiresAt: "2026-10-28T10:00:00.000Z",
});
/** Two-factor setup answers, and a second signed-in device so the Sign-out-others row is there. */
async function mockAccount(page: Page, twoFactor: boolean) {
  await page.route("**/api/v1/auth/get-session", async (route) => {
    // A request that is cut off by a navigation or the end of the test has nothing left to answer.
    try {
      const response = await route.fetch();
      const body = await response.json();
      body.user = { ...body.user, twoFactorEnabled: twoFactor };
      await route.fulfill({ response, json: body });
    } catch {
      await route.abort().catch(() => {});
    }
  });
  await page.route("**/api/v1/auth/two-factor/enable", (route) =>
    route.fulfill({ json: { totpURI: URI, backupCodes: CODES } }),
  );
  await page.route("**/api/v1/auth/two-factor/verify-totp", (route) =>
    route.fulfill({ json: { status: true } }),
  );
  await page.route("**/api/v1/auth/two-factor/generate-backup-codes", (route) =>
    route.fulfill({ json: { backupCodes: CODES } }),
  );
  await page.route("**/api/v1/sessions", (route) =>
    route.request().method() === "GET"
      ? route.fulfill({
          json: {
            items: [
              device("Chrome on macOS", true),
              device("Ledgerline Android app (Pixel 8)", false),
            ],
          },
        })
      : route.fulfill({ status: 204, body: "" }),
  );
}
async function open(
  page: Page,
  width: number,
  theme?: "light" | "dark",
  twoFactor = false,
) {
  await mockAccount(page, twoFactor);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width, height: 900 });
  await signIn(page);
  await page.goto("/settings");
  await page.waitForFunction(
    () => getComputedStyle(document.body).containerType === "inline-size",
  );
  if (theme) await setTheme(page, theme);
  await expect(
    page.getByRole("button", { name: "Sign out all other devices" }),
  ).toBeVisible();
}
const main = (page: Page) => page.getByRole("main");
const group = (page: Page, name: string) =>
  main(page).getByRole("region", { name });
const box = async (locator: Locator) => {
  const found = await locator.boundingBox();
  if (!found) throw new Error("not on screen");
  return found;
};
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
      const control = target?.closest(
        "button, a, label, select, [role=switch], [role=radio]",
      );
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
const dialog = (page: Page) => page.getByRole("dialog");
const axe = async (page: Page) =>
  (await new AxeBuilder({ page }).analyze()).violations.map(
    (item) =>
      `${item.id}: ${item.nodes.map((node) => node.target.join(" ")).join(" | ")}`,
  );

for (const theme of ["light", "dark"] as const)
  for (const width of [320, 390, 1280])
    test(`fits ${width} px in ${theme}: grouped rows, nothing wrapped or cut, every control a real target`, async ({
      page,
    }) => {
      await open(page, width, theme, true);
      expect(await noSideways(page)).toBe(true);
      // The theme control is one segmented track of three; the switches and rows are real targets.
      const theme3 = group(page, "Appearance").getByRole("radiogroup", {
        name: "Theme",
      });
      for (const name of ["Light", "Dark", "System"])
        expect(await is44(page, theme3.getByRole("radio", { name }))).toBe(
          true,
        );
      for (const control of [
        group(page, "Privacy and input").getByRole("switch", {
          name: "Hide amounts",
        }),
        group(page, "Privacy and input").getByRole("switch", {
          name: "Type amounts from the cents",
        }),
        group(page, "Ledger").getByLabel("Time zone"),
        group(page, "Your data").getByRole("link", {
          name: /^Import and export/,
        }),
        page.getByRole("button", { name: "Make new backup codes" }),
        page.getByRole("button", { name: "Turn off two-factor" }),
        page.getByRole("button", { name: "Sign out all other devices" }),
        page.getByRole("button", { name: /^Sign out Ledgerline Android/ }),
        main(page).getByRole("button", { name: "Sign out", exact: true }),
      ])
        expect(await is44(page, control)).toBe(true);
      // No row is shorter than 44 px, and no title or hint is cut off (on a narrow phone they wrap instead).
      for (const row of await main(page).locator(".ui-row").all()) {
        expect((await box(row)).height).toBeGreaterThanOrEqual(44);
        for (const part of ["ui-row-title", "ui-row-hint"])
          for (const line of await row.locator(`.${part}`).all())
            expect(
              await line.evaluate(
                (node) => node.scrollWidth <= node.clientWidth + 1,
              ),
            ).toBe(true);
      }
      // The time zone's select is a bordered control at the end of its row, never over the label or wider than 200 px
      const row = group(page, "Ledger").locator(".ui-row");
      const label = await box(row.locator(".ui-row-main"));
      const value = await box(row.locator(".set-zone"));
      // At the end of its row, or under the label when the row is too narrow for both.
      expect(
        value.x >= label.x + label.width - 1 ||
          value.y >= label.y + label.height - 1,
      ).toBe(true);
      expect(value.width).toBeLessThanOrEqual(201);
      // Wide enough to read a zone name: the select never shrinks to a sliver beside its label.
      expect(value.width).toBeGreaterThanOrEqual(140);
      // Red is only Turn off and Sign out.
      const red = await main(page)
        .getByRole("button", { name: "Turn off two-factor" })
        .locator(".ui-row-title")
        .evaluate((node) => getComputedStyle(node).color);
      const plain = await main(page)
        .getByRole("button", { name: "Make new backup codes" })
        .locator(".ui-row-title")
        .evaluate((node) => getComputedStyle(node).color);
      expect(red).not.toBe(plain);
    });

test("a phone stacks the groups in one column; from a 700 px page the left and right columns start on one line", async ({
  page,
}) => {
  await open(page, 390, undefined, true);
  const names = [
    "Appearance",
    "Privacy and input",
    "Ledger",
    "Your data",
    "Security",
    "Signed-in devices",
  ];
  let last = -1;
  const x0 = (await box(group(page, names[0] as string))).x;
  for (const name of names) {
    const found = await box(group(page, name));
    expect(found.y).toBeGreaterThan(last);
    expect(Math.abs(found.x - x0)).toBeLessThan(1);
    last = found.y + found.height - 1;
  }
  const signOut = await box(
    main(page).getByRole("button", { name: "Sign out", exact: true }),
  );
  expect(signOut.y).toBeGreaterThan(last);

  await page.setViewportSize({ width: 1280, height: 900 });
  const appearance = await box(group(page, "Appearance"));
  const security = await box(group(page, "Security"));
  expect(security.x).toBeGreaterThan(appearance.x + appearance.width - 1);
  expect(Math.abs(security.y - appearance.y)).toBeLessThan(1);
  expect(Math.abs(security.width - appearance.width)).toBeLessThan(2);
  const devices = await box(group(page, "Signed-in devices"));
  expect(devices.x).toBeCloseTo(security.x, 0);
  expect(await noSideways(page)).toBe(true);
});

for (const width of [390, 1280])
  test(`the two-factor setup is one sheet that changes step (${width} px): ${width < 700 ? "a bottom sheet" : "a drawer"}, Continue and Turn on pinned, the code and the key readable`, async ({
    page,
  }) => {
    await open(page, width);
    await page.getByRole("button", { name: "Set up two-factor" }).click();
    const sheet = dialog(page);
    await expect(sheet).toBeVisible();
    await settled(sheet);
    const view = page.viewportSize() as { width: number; height: number };
    let found = await box(sheet);
    if (width < 700) {
      expect(Math.abs(found.width - view.width)).toBeLessThan(2);
      expect(Math.abs(found.y + found.height - view.height)).toBeLessThan(2);
    } else {
      expect(found.width).toBeLessThanOrEqual(561);
      expect(Math.abs(found.x + found.width - view.width)).toBeLessThan(2);
    }
    // The password field has focus, and Continue is pinned inside the sheet and a real target.
    await expect(page.locator("#two-factor-password")).toBeFocused();
    const next = sheet.getByRole("button", { name: "Continue" });
    expect(await is44(page, next)).toBe(true);
    await page.locator("#two-factor-password").fill("anything-12345");
    await next.click();
    // Same sheet, now the scan.
    await expect(
      sheet.getByRole("img", { name: "QR code for your authenticator app" }),
    ).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(1);
    await expect(sheet).toHaveAccessibleName("Scan the code");
    const qr = await box(sheet.getByRole("img", { name: /QR code/ }));
    expect(qr.width).toBeGreaterThan(150);
    expect(qr.width).toBeLessThanOrEqual(221);
    found = await box(sheet);
    expect(qr.x).toBeGreaterThanOrEqual(found.x);
    expect(qr.x + qr.width).toBeLessThanOrEqual(found.x + found.width);
    // The key wraps inside its tile instead of widening the sheet.
    const key = sheet.locator(".two-factor-key");
    const keyBox = await box(key);
    expect(keyBox.x + keyBox.width).toBeLessThanOrEqual(
      found.x + found.width + 1,
    );
    expect(
      await sheet.evaluate((node) => node.scrollWidth <= node.clientWidth),
    ).toBe(true);
    const turnOn = sheet.getByRole("button", { name: "Turn on" });
    expect(await is44(page, turnOn)).toBe(true);
    expect(
      await is44(
        page,
        sheet.getByRole("link", { name: "Open in my authenticator app" }),
      ),
    ).toBe(true);
    await page.getByLabel("6-digit code from the app").fill("123456");
    await turnOn.click();
    // The codes: two columns, a Done that stays off until the box is ticked, and nothing to cancel with.
    const list = sheet.getByRole("list", { name: "Backup codes" });
    await expect(list.getByRole("listitem")).toHaveCount(10);
    await expect(sheet).toHaveAccessibleName("Backup codes");
    await expect(sheet.getByRole("button", { name: "Cancel" })).toHaveCount(0);
    const items = await list.getByRole("listitem").all();
    const first = await box(items[0] as Locator);
    const second = await box(items[1] as Locator);
    expect(Math.abs(first.y - second.y)).toBeLessThan(1);
    expect(second.x).toBeGreaterThan(first.x + first.width - 1);
    const done = sheet.getByRole("button", { name: "Done" });
    await expect(done).toBeDisabled();
    await page.keyboard.press("Escape");
    await expect(sheet).toBeVisible();
    const saved = sheet.getByLabel("I saved these codes");
    expect(await is44(page, sheet.locator("label.set-check"))).toBe(true);
    await saved.check();
    await expect(done).toBeEnabled();
    await done.click();
    await expect(sheet).toBeHidden();
    await expect(page.getByRole("status")).toContainText("Two-factor is on.");
  });

test("Sign out all other devices asks in a centred question with real targets, and Cancel returns to the row", async ({
  page,
}) => {
  await open(page, 390);
  const row = page.getByRole("button", { name: "Sign out all other devices" });
  await row.click();
  const question = dialog(page);
  await expect(question).toBeVisible();
  await settled(question);
  await expect(question).toHaveAccessibleName("Sign out all other devices?");
  await expect(question).toContainText("They will need to sign in again.");
  const view = page.viewportSize() as { width: number; height: number };
  const found = await box(question);
  expect(Math.abs(found.x + found.width / 2 - view.width / 2)).toBeLessThan(2);
  expect(Math.abs(found.y + found.height / 2 - view.height / 2)).toBeLessThan(
    view.height / 4,
  );
  for (const name of ["Cancel", "Sign out all"])
    expect(await is44(page, question.getByRole("button", { name }))).toBe(true);
  await question.getByRole("button", { name: "Cancel" }).click();
  await expect(question).toBeHidden();
  await expect(row).toBeFocused();
});

test("the end of the page is clear of the phone's bottom bar", async ({
  page,
}) => {
  await open(page, 390);
  const signOut = main(page).getByRole("button", {
    name: "Sign out",
    exact: true,
  });
  await signOut.scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  const bar = await box(
    page.getByRole("navigation", { name: "Mobile navigation" }),
  );
  const found = await box(signOut);
  expect(found.y + found.height).toBeLessThanOrEqual(bar.y + 1);
});

test("choosing a time zone saves it at once and says so", async ({ page }) => {
  await open(page, 1280);
  await group(page, "Ledger")
    .getByLabel("Time zone")
    .selectOption("Asia/Dhaka");
  await expect(page.getByRole("status")).toContainText("Time zone saved.");
  // The ledger list is mocked by prepareBrowser, so ask the database what was saved.
  const saved = await pool.query("SELECT time_zone FROM ledgers WHERE id=$1", [
    fixtures[0],
  ]);
  expect(saved.rows[0]?.time_zone).toBe("Asia/Dhaka");
});

for (const theme of ["light", "dark"] as const)
  test(`has no accessibility violations in ${theme} on the page, the setup steps and the question`, async ({
    page,
  }) => {
    await open(page, 390, theme);
    expect(await axe(page)).toEqual([]);
    await page.getByRole("button", { name: "Set up two-factor" }).click();
    await settled(dialog(page));
    expect(await axe(page)).toEqual([]);
    await page.locator("#two-factor-password").fill("anything-12345");
    await dialog(page).getByRole("button", { name: "Continue" }).click();
    await expect(
      dialog(page).getByRole("img", { name: /QR code/ }),
    ).toBeVisible();
    expect(await axe(page)).toEqual([]);
    await page.getByLabel("6-digit code from the app").fill("123456");
    await dialog(page).getByRole("button", { name: "Turn on" }).click();
    await expect(
      dialog(page).getByRole("list", { name: "Backup codes" }),
    ).toBeVisible();
    expect(await axe(page)).toEqual([]);
    await dialog(page).getByLabel("I saved these codes").check();
    await dialog(page).getByRole("button", { name: "Done" }).click();
    await expect(dialog(page)).toBeHidden();
    await page
      .getByRole("button", { name: "Sign out all other devices" })
      .click();
    await settled(dialog(page));
    expect(await axe(page)).toEqual([]);
  });

/* ---------- Clear ledger and Restore cleared ledger (ADR 0049) ---------- */

const DAY = 24 * 60 * 60 * 1000;
/** Answers the ledger list with the owner's ledger (or another role), cleared `daysAgo` days ago when given. */
async function mockLedger(
  page: Page,
  { daysAgo, role = "owner" }: { daysAgo?: number; role?: string } = {},
) {
  const calls: {
    method: string;
    url: string;
    body: unknown;
    key: string | null;
  }[] = [];
  const ledger = {
    id: fixtures[0],
    name: "Synthetic settings layout ledger",
    timeZone: null,
    version: 1,
    baseCurrency: "USD",
    role,
    clearedAt:
      daysAgo === undefined
        ? null
        : new Date(Date.now() - daysAgo * DAY).toISOString(),
  };
  await page.route("**/api/v1/ledgers", (route) =>
    route.fulfill({ json: { items: [ledger] } }),
  );
  await page.route(/\/api\/v1\/ledgers\/[^/]+\/(clear|restore)$/, (route) => {
    const request = route.request();
    calls.push({
      method: request.method(),
      url: new URL(request.url()).pathname,
      body: request.postDataJSON(),
      key: request.headers()["idempotency-key"] ?? null,
    });
    return route.fulfill({ json: ledger });
  });
  return calls;
}
const dataRows = (page: Page) => group(page, "Your data").locator(".ui-row");

for (const theme of ["light", "dark"] as const)
  for (const width of [320, 390, 1280])
    test(`Your data at ${width} px in ${theme}: Clear ledger and, while an undo waits, Restore cleared ledger, as real targets`, async ({
      page,
    }) => {
      await mockLedger(page, { daysAgo: 12.5 });
      await open(page, width, theme);
      expect(await noSideways(page)).toBe(true);
      await expect(dataRows(page).locator(".ui-row-title")).toHaveText([
        "Import and export",
        "Restore cleared ledger",
        "Clear ledger",
      ]);
      await expect(group(page, "Your data")).toContainText("18 days left");
      await expect(group(page, "Your data")).toContainText("Undo for 30 days");
      for (const row of await dataRows(page).all()) {
        expect((await box(row)).height).toBeGreaterThanOrEqual(56);
        expect(await is44(page, row)).toBe(true);
        for (const part of ["ui-row-title", "ui-row-hint"])
          for (const line of await row.locator(`.${part}`).all())
            expect(
              await line.evaluate(
                (node) => node.scrollWidth <= node.clientWidth + 1,
              ),
            ).toBe(true);
      }
      // One hint at most per row, and red only on Clear ledger.
      for (const row of await dataRows(page).all())
        expect(await row.locator(".ui-row-hint").count()).toBeLessThanOrEqual(
          1,
        );
      const colors = await dataRows(page)
        .locator(".ui-row-title")
        .evaluateAll((nodes) => nodes.map((n) => getComputedStyle(n).color));
      expect(colors[2]).not.toBe(colors[0]);
      expect(colors[1]).toBe(colors[0]);
    });

test("with nothing to undo, Your data has Import and export and Clear ledger, and no restore row", async ({
  page,
}) => {
  await mockLedger(page);
  await open(page, 390);
  await expect(dataRows(page).locator(".ui-row-title")).toHaveText([
    "Import and export",
    "Clear ledger",
  ]);
  await expect(group(page, "Your data")).not.toContainText("Restore");
});

test("an editor or a viewer sees neither row", async ({ page }) => {
  await mockLedger(page, { role: "editor" });
  await open(page, 390);
  await expect(dataRows(page)).toHaveCount(1);
  await expect(group(page, "Your data")).not.toContainText("Clear ledger");
});

test("Clear ledger is a centred question that needs the word CLEAR, then writes once with a key and returns to its row", async ({
  page,
}) => {
  const calls = await mockLedger(page);
  await open(page, 390, "light");
  const row = page.getByRole("button", { name: /Clear ledger/ });
  await row.click();
  const ask = dialog(page);
  await expect(ask).toBeVisible();
  await settled(ask);
  const at = await box(ask);
  const view = page.viewportSize() as { width: number; height: number };
  expect(Math.abs(at.x + at.width / 2 - view.width / 2)).toBeLessThan(2);
  expect(at.width).toBeLessThan(view.width);
  await expect(ask).toHaveAccessibleName("Clear your ledger?");
  const confirm = ask.getByRole("button", { name: "Clear", exact: true });
  await expect(confirm).toBeDisabled();
  const typed = ask.getByLabel("Type CLEAR to confirm");
  await expect(typed).toHaveAttribute("placeholder", "CLEAR");
  // This file's target check has no input in its list: measure the box itself.
  expect((await box(typed)).height).toBeGreaterThanOrEqual(43.9);
  for (const name of ["Cancel", "Clear"])
    expect(
      await is44(page, ask.getByRole("button", { name, exact: true })),
    ).toBe(true);
  await typed.fill("clear");
  await expect(confirm).toBeEnabled();
  // The one filled red button on the screen.
  const bg = await confirm.evaluate((n) => getComputedStyle(n).backgroundColor);
  const cancel = await ask
    .getByRole("button", { name: "Cancel" })
    .evaluate((n) => getComputedStyle(n).backgroundColor);
  expect(bg).not.toBe(cancel);
  await confirm.click();
  await expect(ask).toBeHidden();
  expect(calls).toHaveLength(1);
  expect(calls[0]).toMatchObject({
    method: "POST",
    url: `/api/v1/ledgers/${fixtures[0]}/clear`,
    body: { confirm: "CLEAR" },
  });
  expect(calls[0]?.key).toMatch(/^[0-9a-f-]{36}$/);
  await expect(page.getByRole("status")).toContainText("Ledger cleared.");
  await expect(row).toBeFocused();
});

test("Cancel on the Clear question writes nothing and returns to its row", async ({
  page,
}) => {
  const calls = await mockLedger(page);
  await open(page, 390);
  const row = page.getByRole("button", { name: /Clear ledger/ });
  await row.click();
  await dialog(page).getByLabel("Type CLEAR to confirm").fill("CLEAR");
  await dialog(page).getByRole("button", { name: "Cancel" }).click();
  await expect(dialog(page)).toBeHidden();
  await expect(row).toBeFocused();
  expect(calls).toEqual([]);
});

test("Restore cleared ledger asks with no typing and then writes", async ({
  page,
}) => {
  const calls = await mockLedger(page, { daysAgo: 5 });
  await open(page, 1280, "dark");
  await page.getByRole("button", { name: /Restore cleared ledger/ }).click();
  const ask = dialog(page);
  await expect(ask).toHaveAccessibleName("Restore your cleared ledger?");
  await settled(ask);
  await expect(ask.getByLabel(/Type/)).toHaveCount(0);
  await ask.getByRole("button", { name: "Restore", exact: true }).click();
  await expect(ask).toBeHidden();
  expect(calls).toHaveLength(1);
  expect(calls[0]).toMatchObject({
    method: "POST",
    url: `/api/v1/ledgers/${fixtures[0]}/restore`,
  });
  await expect(page.getByRole("status")).toContainText("Ledger restored.");
});

for (const theme of ["light", "dark"] as const)
  for (const width of [320, 390, 1280])
    test(`has no accessibility violations at ${width} px in ${theme}: the Clear and Restore questions`, async ({
      page,
    }) => {
      await mockLedger(page, { daysAgo: 5 });
      await open(page, width, theme);
      expect(await axe(page)).toEqual([]);
      await page.getByRole("button", { name: /Clear ledger/ }).click();
      await settled(dialog(page));
      expect(await axe(page)).toEqual([]);
      await dialog(page).getByRole("button", { name: "Cancel" }).click();
      await page
        .getByRole("button", { name: /Restore cleared ledger/ })
        .click();
      await settled(dialog(page));
      expect(await axe(page)).toEqual([]);
    });
