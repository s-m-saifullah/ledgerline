import AxeBuilder from "@axe-core/playwright";
import { expect, type Locator, type Page, test } from "@playwright/test";

// Sign-in and the code step in a real browser (ADR 0047, PR 14), against the approved prototype: jsdom cannot
// measure a centred column, so its width, its centring, the rows and buttons as targets and the look of the code
// field are measured here. Nothing is signed in and the sign-in is mocked, so no account is touched.
test.beforeEach(({ browser }, testInfo) => {
  void browser;
  test.skip(
    testInfo.project.name !== "desktop",
    "one project is enough: these tests set their own widths",
  );
});

const box = async (locator: Locator) => {
  const found = await locator.boundingBox();
  if (!found) throw new Error("not on screen");
  return found;
};
const noSideways = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
/** An element is a real 44 px target when a click 21 px out from its centre still lands on it. */
async function is44(page: Page, locator: Locator) {
  const found = await box(locator);
  const x = found.x + found.width / 2;
  const y = found.y + found.height / 2;
  return page.evaluate(
    ({ x, y }) => {
      const target = document.elementFromPoint(x, y);
      const control = target?.closest("button, a, label, input");
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

/** A signed-out page at a width and theme; `code` goes on to the code step, which the mocked sign-in asks for. */
async function open(
  browser: import("@playwright/test").Browser,
  width: number,
  theme: "light" | "dark",
  step: "password" | "code" = "password",
) {
  const context = await browser.newContext({
    storageState: { cookies: [], origins: [] },
    viewport: { width, height: 900 },
    colorScheme: theme,
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  await page.route("**/api/v1/auth/sign-in/email", (route) =>
    route.fulfill({ json: { twoFactorRedirect: true } }),
  );
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Welcome back" }),
  ).toBeVisible();
  if (step === "code") {
    await page.getByLabel("Email address").fill("you@example.com");
    await page
      .getByLabel("Password", { exact: true })
      .fill("a-long-password-12");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Two-factor code" }),
    ).toBeVisible();
  }
  return { page, context };
}

for (const step of ["password", "code"] as const)
  for (const theme of ["light", "dark"] as const)
    for (const width of [320, 390, 1280])
      test(`the ${step} step fits ${width} px in ${theme}: one centred card of at most 400 px, real targets`, async ({
        browser,
      }) => {
        const { page, context } = await open(browser, width, theme, step);
        expect(await noSideways(page)).toBe(true);
        // One h1, the page's heading; the marketing half is gone.
        await expect(page.getByRole("heading")).toHaveCount(1);
        await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
        for (const text of [
          "Your money.",
          "A LITTLE CLARITY",
          "Private by design",
        ])
          await expect(page.getByText(text)).toHaveCount(0);
        await expect(
          page.getByText("Your ledger is only open to you."),
        ).toHaveCount(0);
        // The column is centred and no wider than 400 px; on a phone it keeps its 16 px gutters.
        const column = await box(page.locator(".au-box"));
        expect(column.width).toBeLessThanOrEqual(400.5);
        expect(Math.abs(column.x + column.width / 2 - width / 2)).toBeLessThan(
          1.5,
        );
        if (width < 432) expect(column.x).toBeGreaterThanOrEqual(15.5);
        // The mark is 48 px and sits above the heading in the middle.
        const mark = await box(page.locator(".au-mark"));
        expect(Math.abs(mark.width - 48)).toBeLessThan(0.5);
        expect(Math.abs(mark.height - 48)).toBeLessThan(0.5);
        expect(
          Math.abs(mark.x + mark.width / 2 - (column.x + column.width / 2)),
        ).toBeLessThan(1.5);
        const title = await box(page.getByRole("heading", { level: 1 }));
        expect(title.y).toBeGreaterThan(mark.y + mark.height - 1);
        // Rows and boxes are real targets; the button is as wide as the card.
        for (const row of await page.locator(".au-row").all())
          expect((await box(row)).height).toBeGreaterThanOrEqual(55.9);
        for (const input of await page.locator(".au-row > input").all()) {
          expect((await box(input)).height).toBeGreaterThanOrEqual(43.9);
          expect(await is44(page, input)).toBe(true);
        }
        const card = await box(page.locator(".au-card"));
        const primary = page.locator('.au-form button[type="submit"]');
        const wide = await box(primary);
        expect(Math.abs(wide.width - card.width)).toBeLessThan(1);
        expect(wide.height).toBeGreaterThanOrEqual(43.9);
        expect(await is44(page, primary)).toBe(true);
        // The column sits in the middle of the page, top to bottom as well.
        const centre = column.y + column.height / 2;
        expect(Math.abs(centre - 450)).toBeLessThan(40);
        // The whole card is on screen at once, with room to spare.
        const links = page.locator(".au-links");
        const last = (await links.count()) ? links : primary;
        const end = await box(last);
        expect(end.y + end.height).toBeLessThanOrEqual(900);
        expect(card.y).toBeGreaterThan(0);
        await context.close();
      });

test("the password step: a long address stays usable at 320 px, and a wrong field shows its words inside the card", async ({
  browser,
}) => {
  const { page, context } = await open(browser, 320, "light");
  const email = page.getByLabel("Email address");
  expect((await box(email)).width).toBeGreaterThanOrEqual(130);
  await email.fill("a.very.long.name.indeed@subdomain.example.com");
  await expect(email).toHaveValue(
    "a.very.long.name.indeed@subdomain.example.com",
  );
  expect(await noSideways(page)).toBe(true);
  await email.fill("nobody");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  const message = page.getByText("Enter a valid email address.");
  await expect(message).toBeVisible();
  await expect(page.getByText("Use at least 12 characters.")).toBeVisible();
  const [card, said] = await Promise.all([
    box(page.locator(".au-card")),
    box(message),
  ]);
  expect(said.x).toBeGreaterThanOrEqual(card.x);
  expect(said.x + said.width).toBeLessThanOrEqual(card.x + card.width + 0.5);
  expect(await noSideways(page)).toBe(true);
  // No card clips its rows: a clip would cut a field's focus ring at the corners.
  expect(
    await page
      .locator(".au-card")
      .evaluate((n) => getComputedStyle(n).overflow),
  ).toBe("visible");
  await context.close();
});

for (const width of [320, 1280])
  test(`the code step at ${width} px: six large centred digits fit their field, focus is in it, the links are real targets`, async ({
    browser,
  }) => {
    const { page, context } = await open(browser, width, "light", "code");
    const code = page.getByLabel("6-digit code");
    await expect(code).toBeFocused();
    await expect(code).toHaveAttribute("placeholder", "000000");
    const style = await code.evaluate((n) => {
      const css = getComputedStyle(n);
      return {
        size: Number.parseFloat(css.fontSize),
        weight: Number(css.fontWeight),
        align: css.textAlign,
        spacing: Number.parseFloat(css.letterSpacing),
      };
    });
    expect(style.size).toBeGreaterThanOrEqual(19);
    expect(style.weight).toBeGreaterThanOrEqual(600);
    expect(style.align).toBe("center");
    expect(style.spacing).toBeGreaterThan(5);
    await code.pressSequentially("123456");
    // Six digits and the spacing between them fit without scrolling inside the field.
    expect(await code.evaluate((n) => n.scrollWidth <= n.clientWidth)).toBe(
      true,
    );
    const links = page.locator(".au-links .ui-btn");
    await expect(links).toHaveCount(2);
    const first = await box(links.nth(0));
    const second = await box(links.nth(1));
    expect(second.y).toBeGreaterThan(first.y + first.height - 1);
    const column = await box(page.locator(".au-box"));
    for (const link of [first, second]) {
      expect(link.height).toBeGreaterThanOrEqual(43.9);
      expect(
        Math.abs(link.x + link.width / 2 - (column.x + column.width / 2)),
      ).toBeLessThan(1.5);
    }
    await expect(links.nth(0)).toHaveText("Use a backup code instead");
    await expect(links.nth(1)).toHaveText("Back to sign in");
    for (const link of await links.all())
      expect(await is44(page, link)).toBe(true);
    await context.close();
  });

test("the backup-code field is plain: no spacing between letters, no digits placeholder", async ({
  browser,
}) => {
  const { page, context } = await open(browser, 390, "light", "code");
  await page.getByRole("button", { name: "Use a backup code instead" }).click();
  const backup = page.getByLabel("Backup code");
  await expect(backup).toBeFocused();
  await expect(backup).not.toHaveAttribute("placeholder", /.+/);
  const style = await backup.evaluate((n) => {
    const css = getComputedStyle(n);
    return {
      spacing: css.letterSpacing,
      align: css.textAlign,
    };
  });
  // Normal spacing, and like the other rows it reads from the right.
  expect(["normal", "0px"]).toContain(style.spacing);
  expect(style.align).not.toBe("center");
  await backup.fill("abcd-efgh-ijkl");
  expect(await noSideways(page)).toBe(true);
  await expect(
    page.getByRole("button", { name: "Use my authenticator app" }),
  ).toBeVisible();
  await context.close();
});

test("each step has its own page title, and Back to sign in returns with the address kept", async ({
  browser,
}) => {
  const { page, context } = await open(browser, 390, "light");
  await expect(page).toHaveTitle("Sign in · Ledgerline");
  await page.getByLabel("Email address").fill("you@example.com");
  await page.getByLabel("Password", { exact: true }).fill("a-long-password-12");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveTitle("Two-factor code · Ledgerline");
  await page.getByRole("button", { name: "Back to sign in" }).click();
  await expect(page).toHaveTitle("Sign in · Ledgerline");
  await expect(page.getByLabel("Email address")).toHaveValue("you@example.com");
  await context.close();
});

for (const theme of ["light", "dark"] as const)
  for (const step of ["password", "code"] as const)
    test(`the ${step} step passes axe in ${theme}`, async ({ browser }) => {
      const { page, context } = await open(browser, 390, theme, step);
      const result = await new AxeBuilder({ page }).analyze();
      expect(result.violations).toEqual([]);
      await context.close();
    });
