import { expect, type Page, test } from "@playwright/test";
import { hashPassword } from "../../apps/api/src/modules/auth/password";
import { totpCode } from "../../infra/scripts/totp.mjs";
import { newId } from "../../packages/shared/src/index";
import { connectLocalDatabase } from "./ledger-setup";

// Two-factor (ADR 0038) on its own synthetic user, so the shared owner session used by every other spec is
// never touched. Each run starts signed out.
test.use({ storageState: { cookies: [], origins: [] } });

const { pool } = connectLocalDatabase("Two-factor browser tests");
const password = "e2e-two-factor-password-1";
const created: { userId: string; ledgerId: string }[] = [];
let address = 20;

test.afterAll(async () => {
  for (const { userId, ledgerId } of created) {
    await pool.query("DELETE FROM two_factor WHERE user_id=$1", [userId]);
    await pool.query("DELETE FROM auth_sessions WHERE user_id=$1", [userId]);
    await pool.query("DELETE FROM auth_accounts WHERE user_id=$1", [userId]);
    await pool.query("DELETE FROM ledger_members WHERE ledger_id=$1", [
      ledgerId,
    ]);
    await pool.query("DELETE FROM ledgers WHERE id=$1", [ledgerId]);
    await pool.query("DELETE FROM users WHERE id=$1", [userId]);
  }
  await pool.end();
});

async function createUser(name: string) {
  const userId = newId();
  const ledgerId = newId();
  const email = `e2e-2fa-${userId}@example.com`;
  await pool.query("INSERT INTO users(id,email,name) VALUES ($1,$2,$3)", [
    userId,
    email,
    name,
  ]);
  await pool.query(
    "INSERT INTO auth_accounts(id,user_id,account_id,provider_id,password) VALUES ($1,$2,$3,'credential',$4)",
    [newId(), userId, userId, await hashPassword(password)],
  );
  await pool.query(
    "INSERT INTO ledgers(id,name) VALUES ($1,'E2E two-factor ledger')",
    [ledgerId],
  );
  await pool.query(
    "INSERT INTO ledger_members(id,ledger_id,user_id,role) VALUES ($1,$2,$3,'owner')",
    [newId(), ledgerId, userId],
  );
  created.push({ userId, ledgerId });
  return email;
}

/** Each sign-in comes from its own address, so the auth limiter (3 per 10 s) never gets in the way. */
async function freshAddress(page: Page, projectIndex: number) {
  address += 1;
  await page.setExtraHTTPHeaders({
    "x-forwarded-for": `198.51.100.${((projectIndex * 100 + address) % 250) + 1}`,
  });
}
async function passwordStep(page: Page, email: string) {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Welcome back" }),
  ).toBeVisible();
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}
const home = (page: Page) =>
  page.getByRole("heading", { name: "Home", exact: true });
const codeStep = (page: Page) =>
  page.getByRole("heading", { name: "Two-factor code" });

test("set up two-factor, sign in with a code and a backup code, then turn it off", async ({
  page,
}, testInfo) => {
  const projectIndex = testInfo.project.name === "mobile" ? 1 : 0;
  await page.emulateMedia({ colorScheme: "light" });
  const email = await createUser("Two-factor tester");

  // Without two-factor the password alone signs in, as before.
  await freshAddress(page, projectIndex);
  await passwordStep(page, email);
  await expect(home(page)).toBeVisible();

  // Set it up: password, then the first code from the "app".
  await page.goto("/settings");
  await expect(page.getByText(/^Off\./)).toBeVisible();
  await page.getByRole("button", { name: "Set up two-factor" }).click();
  await page.getByLabel("Your password").fill(password);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(
    page.getByRole("img", { name: "QR code for your authenticator app" }),
  ).toBeVisible();
  const key = (
    (await page.locator(".two-factor-key").textContent()) ?? ""
  ).replace(/\s+/g, "");
  expect(key).toMatch(/^[A-Z2-7]{16,}$/);
  await page.getByLabel("6-digit code from the app").fill("000000");
  await page.getByRole("button", { name: "Turn on" }).click();
  await expect(page.getByRole("alert")).toContainText("That code didn't work.");
  await page.getByLabel("6-digit code from the app").fill(totpCode(key));
  await page.getByRole("button", { name: "Turn on" }).click();
  const codes = page
    .getByRole("list", { name: "Backup codes" })
    .getByRole("listitem");
  await expect(codes).toHaveCount(10);
  const backup = ((await codes.allTextContents()) as string[]).slice(0, 2);
  await expect(page.getByRole("button", { name: "Done" })).toBeDisabled();
  await page.getByLabel("I saved these codes").check();
  await page.getByRole("button", { name: "Done" }).click();
  await expect(page.getByRole("status")).toContainText("Two-factor is on.");
  await expect(page.getByText(/^On\./)).toBeVisible();
  await expect(page.getByRole("list", { name: "Backup codes" })).toHaveCount(0);

  // A new sign-in now needs a code: the password alone does not open the app.
  await page.context().clearCookies();
  await freshAddress(page, projectIndex);
  await passwordStep(page, email);
  await expect(codeStep(page)).toBeVisible();
  await expect(home(page)).toHaveCount(0);
  await page.getByLabel("6-digit code").fill("000000");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("alert")).toContainText("That code didn't work.");
  await page.getByLabel("6-digit code").fill(totpCode(key));
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(home(page)).toBeVisible();

  // A backup code signs in once.
  await page.context().clearCookies();
  await freshAddress(page, projectIndex);
  await passwordStep(page, email);
  await page.getByRole("button", { name: "Use a backup code instead" }).click();
  await page.getByLabel("Backup code").fill(backup[0] as string);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(home(page)).toBeVisible();
  await page.context().clearCookies();
  await freshAddress(page, projectIndex);
  await passwordStep(page, email);
  await page.getByRole("button", { name: "Use a backup code instead" }).click();
  await page.getByLabel("Backup code").fill(backup[0] as string);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("alert")).toContainText("didn't work");
  await page.getByLabel("Backup code").fill(backup[1] as string);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(home(page)).toBeVisible();

  // Turn it off with the password; sign-in is password-only again.
  await page.goto("/settings");
  await page.getByText("Manage").click();
  await page.getByRole("button", { name: "Turn off two-factor" }).click();
  await page.getByLabel("Your password").fill(password);
  await page.getByRole("button", { name: "Turn off two-factor" }).click();
  await expect(page.getByRole("status")).toContainText("Two-factor is off.");
  await page.context().clearCookies();
  await freshAddress(page, projectIndex);
  await passwordStep(page, email);
  await expect(home(page)).toBeVisible();
});
