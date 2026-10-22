import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { expect, request, test } from "@playwright/test";
import { signIn } from "./sign-in";

// ADR 0042: Settings lists the devices signed in as the owner and signs another one out. The "phone" is a real
// second session made through the API the way the Android app signs in.
const env = parseEnv(readFileSync(".env", "utf8"));

test("Settings lists a second device and signs it out, and its token stops working", async ({
  page,
  baseURL,
}, testInfo) => {
  // A name no earlier run used, so a leftover session can never be mistaken for this one.
  const model = `E2E phone ${testInfo.project.name} ${Date.now()}`;
  const phone = await request.newContext({ baseURL: baseURL as string });
  const response = await phone.post("/api/v1/auth/sign-in/email", {
    headers: {
      origin: baseURL as string,
      "user-agent": `Ledgerline-Android/1.0 (${model})`,
      "x-ledgerline-client": "android",
      "x-forwarded-for": `203.0.113.${60 + (testInfo.project.name === "mobile" ? 1 : 0)}`,
    },
    data: { email: env.OWNER_EMAIL, password: env.OWNER_PASSWORD },
  });
  expect(response.status()).toBe(200);
  const token = response.headers()["set-auth-token"] as string;
  expect(token).toBeTruthy();
  const asPhone = () =>
    phone.get("/api/v1/ledgers", {
      headers: { authorization: `Bearer ${token}`, origin: baseURL as string },
    });
  expect((await asPhone()).status()).toBe(200);

  await signIn(page);
  await page.goto("/settings");
  await expect(
    page.getByRole("heading", { name: "Signed-in devices" }),
  ).toBeVisible();
  const row = page
    .getByRole("listitem")
    .filter({ hasText: `Ledgerline Android app (${model})` });
  await expect(row).toBeVisible();
  await expect(
    page.locator(".account-badge", { hasText: "Current device" }),
  ).toBeVisible();

  // The confirmation for signing everything out can be cancelled and signs nobody out.
  await page
    .getByRole("button", { name: "Sign out all other devices" })
    .click();
  await expect(
    page.getByText(
      /Sign out all your other devices\? They will need to sign in again\./,
    ),
  ).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();
  expect((await asPhone()).status()).toBe(200);

  await page
    .getByRole("button", { name: `Sign out Ledgerline Android app (${model})` })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "Signed out" }),
  ).toBeVisible();
  await expect(row).toHaveCount(0);
  expect((await asPhone()).status()).toBe(401);
  // This device is still signed in.
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Signed-in devices" }),
  ).toBeVisible();
  await phone.dispose();
});
