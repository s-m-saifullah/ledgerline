import { expect, test } from "@playwright/test";
import { newId } from "../../packages/shared/src/index";
import {
  connectLocalDatabase,
  createOwnerLedger,
  prepareBrowser,
} from "./ledger-setup";
import { signIn } from "./sign-in";

const { env, pool } = connectLocalDatabase("Disclosures browser tests");
const fixtures: string[] = [];

// The Add dialog shows its form only once the ledger has accounts (two for a transfer), which a fresh database (CI) lacks.
test.beforeEach(async ({ page }, testInfo) => {
  const ledgerId = newId();
  fixtures.push(ledgerId);
  await createOwnerLedger(
    pool,
    env,
    ledgerId,
    `E2E disclosures ledger ${testInfo.project.name}`,
  );
  await pool.query(
    "INSERT INTO accounts (id,ledger_id,name,type,opening_balance) VALUES ($1,$3,'Checking','bank',0),($2,$3,'Savings','bank',0)",
    [newId(), newId(), ledgerId],
  );
  await prepareBrowser(page, testInfo, {
    ledgerId,
    name: "Synthetic disclosures ledger",
    forwarded: [200, 20],
  });
  await signIn(page);
});
test.afterEach(async () => {
  for (const id of fixtures) {
    await pool.query(
      "UPDATE accounts SET deleted_at=now(), updated_at=now() WHERE ledger_id=$1",
      [id],
    );
    await pool.query(
      "UPDATE ledger_members SET deleted_at=now(), updated_at=now() WHERE ledger_id=$1",
      [id],
    );
    await pool.query(
      "UPDATE ledgers SET deleted_at=now(), updated_at=now() WHERE id=$1 AND name LIKE 'E2E disclosures ledger %'",
      [id],
    );
  }
  fixtures.length = 0;
});
test.afterAll(async () => {
  await pool.end();
});

// ADR 0039: a collapsible section must look pressable (a chevron, at least 44 px tall) and open and close from
// the keyboard. The Transactions page lost its two disclosures to the Filters sheet and the Add sheet lost "More
// details" (ADR 0047), so this checks the one left in a transfer's fee and bonus categories.
test("disclosures show a marker, are tall enough and work from the keyboard", async ({
  page,
}) => {
  await page
    .getByRole("button", { name: "Add transaction", exact: true })
    .filter({ visible: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "Add transaction" });
  await dialog.getByRole("radio", { name: "Transfer", exact: true }).click();
  const more = dialog.locator("details > summary").first();
  await expect(more).toBeVisible();

  const summaries = dialog.locator("details > summary");
  expect(await summaries.count()).toBeGreaterThanOrEqual(1);
  for (const summary of await summaries.all()) {
    // The sheet may still be sliding in (the mobile project does not reduce motion): wait for it to settle.
    await expect
      .poll(async () => (await summary.boundingBox())?.height ?? 0)
      .toBeGreaterThanOrEqual(44);
    const style = await summary.evaluate((element) => ({
      marker: getComputedStyle(element, "::before").content,
      listStyle: getComputedStyle(element).listStyleType,
    }));
    expect(style.marker).not.toBe("none");
    expect(style.listStyle).toBe("none");
  }

  const details = more.locator("xpath=..");
  await more.focus();
  await expect(details).not.toHaveAttribute("open", "");
  await page.keyboard.press("Enter");
  await expect(details).toHaveAttribute("open", "");
  await page.keyboard.press("Space");
  await expect(details).not.toHaveAttribute("open", "");
  await page.keyboard.press("Space");
  await expect(details).toHaveAttribute("open", "");
});
