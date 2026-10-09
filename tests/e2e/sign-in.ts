import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { expect, type Page } from "@playwright/test";

const env = parseEnv(readFileSync(".env", "utf8"));
/** The browser state saved by auth.setup.ts: one real sign-in shared by every test in a run. */
export const ownerSession = "tests/e2e/.auth/owner.json";

/**
 * Open the app signed in. Tests start from the saved owner session, so normally this only loads Home;
 * if the session is missing or has expired, it falls back to the real sign-in form.
 */
export async function signIn(page: Page) {
  await page.goto("/");
  const home = page.getByRole("heading", { name: "Home", exact: true });
  const form = page.getByRole("heading", { name: "Welcome back" });
  await expect(home.or(form)).toBeVisible();
  if (await home.isVisible()) return;
  await signInWithForm(page);
}

/** Sign in through the real form (used for the saved session and as the fallback). */
export async function signInWithForm(page: Page) {
  await page.goto("/");
  try {
    await expect(
      page.getByRole("heading", { name: "Welcome back" }),
    ).toBeVisible();
    await page.getByLabel("Email address").fill(env.OWNER_EMAIL ?? "");
    await page
      .getByLabel("Password", { exact: true })
      .fill(env.OWNER_PASSWORD ?? "");
    // Respect the local auth limiter when more browser flows share a worker IP.
    // Never record requests or response bodies: sign-in contains private credentials.
    for (let attempt = 0; attempt < 3; attempt++) {
      const response = page.waitForResponse(
        (response) =>
          response.url().endsWith("/api/v1/auth/sign-in/email") &&
          response.request().method() === "POST",
      );
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      const result = await response;
      if (result.status() !== 429 || attempt === 2) break;
      const retryAfter = Number(result.headers()["retry-after"]);
      const seconds =
        Number.isFinite(retryAfter) && retryAfter > 0
          ? Math.min(retryAfter, 15)
          : 10;
      await page.waitForTimeout(seconds * 1000 + 250);
    }
    await expect(
      page.getByRole("heading", { name: "Home", exact: true }),
    ).toBeVisible();
  } catch {
    const reason = await page
      .getByRole("alert")
      .textContent()
      .catch(() => null);
    await page
      .evaluate(() => {
        document
          .querySelectorAll<HTMLInputElement>(
            'input[type="password"], input[type="email"]',
          )
          .forEach((input) => {
            input.value = "";
          });
      })
      .catch(() => {});
    // Do not propagate fill errors: their call logs can include the credential value.
    throw new Error(
      `Browser test sign-in failed.${reason ? ` ${reason}` : ""}`,
    );
  }
}
