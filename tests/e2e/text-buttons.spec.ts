import { expect, test } from "@playwright/test";
import { newId } from "../../packages/shared/src/index";
import {
  connectLocalDatabase,
  createOwnerLedger,
  prepareBrowser,
} from "./ledger-setup";
import { signIn } from "./sign-in";

// ADR 0039: a control that can be pressed must not look like plain text. The text button shares the accent
// colour with the filled button, is underlined on hover and keeps the red of Delete.
const { env, pool } = connectLocalDatabase("Text button browser tests");
let ledgerId = "";

test.beforeEach(async ({ page }, testInfo) => {
  ledgerId = newId();
  await createOwnerLedger(pool, env, ledgerId, "E2E text button ledger");
  await pool.query(
    "INSERT INTO tags (id,ledger_id,name) VALUES ($1,$2,'E2E trip')",
    [newId(), ledgerId],
  );
  await prepareBrowser(page, testInfo, {
    ledgerId,
    name: "E2E text button ledger",
    forwarded: [230, 20],
  });
  await signIn(page);
});
test.afterEach(async () => {
  await pool.query("DELETE FROM tags WHERE ledger_id=$1", [ledgerId]);
  await pool.query("DELETE FROM ledger_members WHERE ledger_id=$1", [ledgerId]);
  await pool.query("DELETE FROM ledgers WHERE id=$1", [ledgerId]);
});

test("row actions are accent text with an icon, underlined on hover, and Delete is red", async ({
  page,
}) => {
  // The Tags page still has them; each screen that moves to the redesign leaves this spec with one page fewer.
  await page.goto("/tags");
  const archive = page.getByRole("button", { name: "Archive", exact: true });
  const remove = page.getByRole("button", { name: "Delete", exact: true });
  await expect(archive).toBeVisible();
  const accent = await page
    .locator(".button")
    .first()
    .evaluate((element) => getComputedStyle(element).backgroundColor);
  const colour = (locator: typeof archive) =>
    locator.evaluate((element) => getComputedStyle(element).color);
  expect(await colour(archive)).toBe(accent);
  expect(await colour(remove)).not.toBe(accent);
  await expect(archive.locator("svg")).toHaveCount(1);
  expect((await archive.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
  await archive.hover();
  await expect(archive).toHaveCSS("text-decoration-line", "underline");
});
