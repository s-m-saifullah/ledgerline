import { randomUUID } from "node:crypto";
import { expect, type Page, test } from "@playwright/test";
import { type Account, accountSchema } from "../../packages/shared/src/index";
import { accountRow, clickAccountAction, openAccount } from "./account-actions";
import { connectLocalDatabase } from "./ledger-setup";
import { expectMorePageCurrent, openMorePage } from "./more-nav";
import { signIn } from "./sign-in";
import { setTheme } from "./theme";

const { env, pool } = connectLocalDatabase("Account browser tests");
const created = new Map<string, Set<string>>();
test.beforeEach(async ({ page }, testInfo) => {
  // Model independent clients without weakening the real auth rate limits.
  await page.setExtraHTTPHeaders({
    "x-forwarded-for": `198.51.100.${10 + (testInfo.workerIndex % 200)}`,
  });
  await page.emulateMedia({ colorScheme: "light" });
});
function track(value: unknown): Account {
  const account = accountSchema.parse(value);
  if (!account.name.startsWith("E2E "))
    throw new Error("Unexpected browser-test fixture");
  const ids = created.get(account.ledgerId) ?? new Set<string>();
  ids.add(account.id);
  created.set(account.ledgerId, ids);
  return account;
}
test.afterEach(async () => {
  // Only tombstone the exact synthetic IDs created by this test worker.
  for (const [ledgerId, ids] of created)
    await pool.query(
      "UPDATE accounts SET deleted_at = $1, updated_at = $1 WHERE ledger_id = $2 AND id = ANY($3::uuid[]) AND name LIKE 'E2E %'",
      [new Date(), ledgerId, [...ids]],
    );
  created.clear();
});
test.afterAll(async () => {
  await pool.end();
});

async function add(page: Page, name: string, type: string, amount: string) {
  await page
    .getByRole("button", { name: /Add (your first )?account/, exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "Add account" });
  await expect(dialog.getByLabel("Account name")).toBeFocused();
  await dialog.getByLabel("Account name").fill(name);
  await dialog.getByLabel("Account type").selectOption(type);
  await dialog.getByLabel("Opening balance (USD)").fill(amount);
  const response = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      /\/accounts$/.test(response.url()),
  );
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  const saved = await response;
  expect(saved.status()).toBe(201);
  return track(await saved.json());
}

test("creates, retries, edits and archives real accounts with privacy and conflict handling", async ({
  page,
}, testInfo) => {
  test.setTimeout(60000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await signIn(page);
  await openMorePage(page, "Accounts");
  await expect(page).toHaveURL(/\/accounts$/);
  await expect(
    page.getByRole("heading", { name: "Accounts", exact: true }),
  ).toBeVisible();
  await expectMorePageCurrent(page, "Accounts");
  const name = `E2E ${testInfo.project.name} bank ${randomUUID().slice(0, 8)}`;
  const attempts: string[] = [];
  let dropped = false;
  let original: Account | undefined;
  await page.route(/\/api\/v1\/ledgers\/[^/]+\/accounts$/, async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    attempts.push(route.request().headers()["idempotency-key"] ?? "");
    if (!dropped) {
      dropped = true;
      const response = await route.fetch();
      expect(response.status()).toBe(201);
      original = track(await response.json());
      // The server committed, but the browser never receives the response.
      await route.abort("failed");
    } else await route.continue();
  });
  await page
    .getByRole("button", { name: /Add (your first )?account/, exact: true })
    .click();
  const createDialog = page.getByRole("dialog", { name: "Add account" });
  await createDialog.getByLabel("Account name").fill(name);
  await createDialog.getByLabel("Opening balance (USD)").fill("1234.56");
  await createDialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(createDialog.getByRole("alert")).toContainText(
    "couldn't confirm the save",
  );
  await expect(createDialog.getByLabel("Account name")).toBeDisabled();
  await createDialog.getByRole("button", { name: "Close for now" }).click();
  await page.getByRole("button", { name: "Resume action" }).click();
  const retriedResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      /\/accounts$/.test(response.url()),
  );
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Retry save" })
    .click();
  const retry = await retriedResponse;
  const account = track(await retry.json());
  expect(account.id).toBe(original?.id);
  expect(retry.headers()["idempotency-replayed"]).toBe("true");
  expect(attempts[0]).toBe(attempts[1]);
  expect(
    (
      await pool.query(
        "SELECT count(*)::int AS count FROM accounts WHERE ledger_id = $1 AND name = $2 AND deleted_at IS NULL",
        [account.ledgerId, name],
      )
    ).rows[0]?.count,
  ).toBe(1);
  const card = accountRow(page, name);
  await expect(card.getByText("$1,234.56", { exact: true })).toBeVisible();
  await page.reload();
  await expect(accountRow(page, name)).toBeVisible();
  await openAccount(page, name);
  const editDialog = page.getByRole("dialog", { name: "Edit account" });
  const externalName = `${name} latest`;
  const external = await page.request.patch(
    `/api/v1/ledgers/${account.ledgerId}/accounts/${account.id}`,
    {
      headers: {
        origin: env.APP_URL ?? "http://localhost:5173",
        "idempotency-key": randomUUID(),
      },
      data: { name: externalName, expectedVersion: account.version },
    },
  );
  expect(external.status()).toBe(200);
  await editDialog.getByLabel("Account name").fill(`${name} draft`);
  await editDialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(editDialog.getByRole("alert")).toContainText(
    "This account changed",
  );
  await editDialog
    .getByRole("button", { name: "Reload latest details" })
    .click();
  await expect(editDialog.getByLabel("Account name")).toHaveValue(externalName);
  await editDialog.getByLabel("Account name").fill(name);
  await editDialog.getByLabel("Opening balance (USD)").fill("1200.29");
  await editDialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(card.getByText("$1,200.29", { exact: true })).toBeVisible();
  const debtName = `E2E ${testInfo.project.name} card ${randomUUID().slice(0, 8)}`;
  const debt = await add(page, debtName, "card", "987.65");
  expect(debt.openingBalance.amount).toBe(-98765);
  const debtCard = accountRow(page, debtName);
  await expect(
    debtCard.getByText("Credit card · USD · Owed", { exact: true }),
  ).toBeVisible();
  await expect(debtCard.getByText("-$987.65", { exact: true })).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("accounts-light.png"),
    fullPage: true,
  });
  await setTheme(page, "dark");
  await page.screenshot({
    path: testInfo.outputPath("accounts-dark.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Hide amounts", exact: true }).click();
  await expect(debtCard.getByText("Amount hidden")).toBeAttached();
  await expect(debtCard.getByText("-$987.65", { exact: true })).toHaveCount(0);
  await openAccount(page, debtName);
  await expect(page.getByLabel("Opening balance (USD)")).toHaveAttribute(
    "type",
    "password",
  );
  await page.keyboard.press("Escape");
  await expect(debtCard).toBeFocused();
  await page.getByRole("button", { name: "Show amounts", exact: true }).click();
  await clickAccountAction(page, "archive", debtName);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Archive", exact: true })
    .click();
  // An archived account leaves the groups for the fold under them.
  const fold = page.locator(".ac-fold");
  await expect(fold).toBeVisible();
  await expect(debtCard).toBeHidden();
  await fold.locator("summary").click();
  await expect(debtCard).toBeVisible();
  await expect(debtCard.getByText("-$987.65", { exact: true })).toBeVisible();
  // A mis-tapped archive can be undone from the fold.
  await clickAccountAction(page, "unarchive", debtName);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Unarchive", exact: true })
    .click();
  await expect(
    page.getByText(
      "Account unarchived. It is available for new entries again.",
    ),
  ).toBeVisible();
  await expect(fold.getByText(debtName)).toHaveCount(0);
  await expect(debtCard).toBeVisible();
  await expect(debtCard.getByText("-$987.65", { exact: true })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});

test("account setup works with the keyboard and fits a narrow phone", async ({
  page,
}, testInfo) => {
  if (testInfo.project.name === "mobile")
    await page.setViewportSize({ width: 320, height: 740 });
  await signIn(page);
  await page.getByRole("link", { name: "Set up accounts" }).click();
  await expect(
    page.getByRole("heading", { name: "Accounts", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: /Add (your first )?account/, exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("Account name")).toBeFocused();
  await dialog.getByLabel("Account name").fill("E2E keyboard preview");
  await expect(page.locator(".skip-link")).not.toBeInViewport();
  await page.screenshot({
    path: testInfo.outputPath("account-dialog.png"),
    fullPage: false,
  });
  for (let i = 0; i < 10; i++) {
    await page.keyboard.press("Tab");
    expect(
      await page.evaluate(
        () => !!document.activeElement?.closest('[role="dialog"]'),
      ),
    ).toBe(true);
  }
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  // The sheet slides in over a fifth of a second (up from the bottom on a phone, in from the right as a drawer): measure it
  // once it has stopped in both directions (a slow runner, or a run with no frame to draw, is still moving).
  await expect
    .poll(async () => {
      const moving = await dialog.boundingBox();
      return (moving?.y ?? 0) + (moving?.height ?? 0);
    })
    .toBeLessThanOrEqual(page.viewportSize()?.height ?? 0);
  await expect
    .poll(async () => {
      const moving = await dialog.boundingBox();
      return (moving?.x ?? 0) + (moving?.width ?? 0);
    })
    .toBeLessThanOrEqual(page.viewportSize()?.width ?? 0);
  const bounds = await dialog.boundingBox();
  expect(bounds?.x).toBeGreaterThanOrEqual(0);
  expect(bounds?.y).toBeGreaterThanOrEqual(0);
  expect((bounds?.y ?? 0) + (bounds?.height ?? 0)).toBeLessThanOrEqual(
    page.viewportSize()?.height ?? 0,
  );
  expect((bounds?.x ?? 0) + (bounds?.width ?? 0)).toBeLessThanOrEqual(
    page.viewportSize()?.width ?? 0,
  );
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Accounts", exact: true }),
  ).toBeFocused();
});
