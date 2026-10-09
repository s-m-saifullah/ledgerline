import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseEnv } from "node:util";
import { chromium, expect } from "@playwright/test";
import { compareHome } from "./home-consistency.mjs";
import { readSmokeConfig } from "./smoke-config.mjs";

// Settings come from SMOKE_* environment variables (see smoke-config.mjs); credentials are never printed.
let browser;
try {
  const { baseURL, credentials } = readSmokeConfig(process.env);
  // Over SSH, read only the two owner lines from the server's private env file.
  const env =
    credentials.kind === "direct"
      ? { OWNER_EMAIL: credentials.email, OWNER_PASSWORD: credentials.password }
      : parseEnv(
          execFileSync(
            "ssh",
            [
              "-o",
              "BatchMode=yes",
              credentials.target,
              `sudo -n -u ${credentials.user} sed -n '/^OWNER_EMAIL=/p;/^OWNER_PASSWORD=/p' ${credentials.envFile}`,
            ],
            { encoding: "utf8" },
          ),
        );
  if (!env.OWNER_EMAIL || !env.OWNER_PASSWORD)
    throw new Error("Missing owner credentials");
  browser = await chromium.launch();
  const context = await browser.newContext({
    baseURL,
    viewport: { width: 1440, height: 1000 },
  });
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", () => pageErrors.push(true));
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Welcome back" }),
  ).toBeVisible();
  await page.getByLabel("Email address").fill(env.OWNER_EMAIL);
  await page.getByLabel("Password", { exact: true }).fill(env.OWNER_PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Home", exact: true }),
  ).toBeVisible();
  const cookie = (await context.cookies()).find(
    (item) => item.name === "__Secure-better-auth.session_token",
  );
  if (!cookie?.secure || !cookie.httpOnly || cookie.sameSite !== "Lax")
    throw new Error("Cookie attributes failed");
  const ledgers = await page.request.get("/api/v1/ledgers");
  expect(ledgers.status()).toBe(200);
  const ledgerItems = (await ledgers.json()).items;
  expect(ledgerItems).toHaveLength(1);
  // Read-only checks: published API version, then Home against Accounts, People and Transactions.
  const spec = await (await page.request.get("/api/v1/openapi.json")).json();
  const expectedVersion = process.argv
    .find((argument) => argument.startsWith("--expect-version="))
    ?.slice("--expect-version=".length);
  if (expectedVersion) expect(spec.info.version).toBe(expectedVersion);
  const base = `/api/v1/ledgers/${ledgerItems[0].id}`;
  const readAll = async (path, query = "") => {
    const rows = [];
    let cursor = null;
    do {
      const separator = path.includes("?") || query ? "&" : "?";
      const url = `${base}${path}${query}${cursor ? `${separator}cursor=${encodeURIComponent(cursor)}` : ""}`;
      const response = await page.request.get(url);
      expect(response.status()).toBe(200);
      const body = await response.json();
      rows.push(...body.items);
      cursor = body.nextCursor;
    } while (cursor);
    return rows;
  };
  const now = new Date();
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const last = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const homeResponse = await page.request.get(`${base}/home?month=${month}`);
  expect(homeResponse.status()).toBe(200);
  const mismatches = compareHome({
    monthStart: `${month}-01`,
    monthEnd: `${month}-${String(last).padStart(2, "0")}`,
    home: await homeResponse.json(),
    accounts: await readAll("/accounts?status=all"),
    people: await readAll("/contacts?status=all"),
    transactions: await readAll("/transactions?limit=100"),
  });
  if (mismatches.length)
    throw new Error(
      `Home disagrees with its source screens: ${mismatches.join(", ")}`,
    );
  await page.screenshot({
    path: join(tmpdir(), "ledgerline-production.png"),
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Sign out", exact: true })
    .filter({ visible: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Welcome back" }),
  ).toBeVisible();
  expect((await page.request.get("/api/v1/ledgers")).status()).toBe(401);
  expect(
    (
      await page.request.post("/api/v1/auth/sign-up/email", { data: {} })
    ).status(),
  ).toBe(404);
  expect(pageErrors).toEqual([]);
  console.log(
    "Production HTTPS login, secure httpOnly session, Home matching Accounts, People and Transactions (read-only), logout and anonymous denial verified.",
  );
} catch (error) {
  // Only our own consistency message is safe to print; anything else may carry credentials or data.
  const safe =
    error instanceof Error &&
    (error.message.startsWith("Home disagrees") ||
      error.message.startsWith("Set SMOKE_"));
  console.error(
    safe
      ? error.message
      : "Production smoke check failed. Inspect TLS, health and authentication without printing credentials.",
  );
  process.exitCode = 1;
} finally {
  await browser?.close();
}
