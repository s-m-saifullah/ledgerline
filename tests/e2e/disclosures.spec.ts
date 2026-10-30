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

// The Add dialog shows "More details" only once the ledger has an account, which a fresh database (CI) lacks.
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
    "INSERT INTO accounts (id,ledger_id,name,type,opening_balance) VALUES ($1,$2,'Checking','bank',0)",
    [newId(), ledgerId],
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
// the keyboard. The Transactions page lost its two disclosures to the Filters sheet (ADR 0047), so this checks
// the one in the Add transaction dialog.
test("disclosures show a marker, are tall enough and work from the keyboard", async ({
  page,
}) => {
  await page
    .getByRole("button", { name: "Add transaction", exact: true })
    .filter({ visible: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "Add transaction" });
  const more = dialog.getByText("More details", { exact: true });
  await expect(more).toBeVisible();

  const summaries = dialog.locator("details > summary");
  expect(await summaries.count()).toBeGreaterThanOrEqual(1);
  for (const summary of await summaries.all()) {
    const box = await summary.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    const style = await summary.evaluate((element) => ({
      marker: getComputedStyle(element, "::before").content,
      listStyle: getComputedStyle(element).listStyleType,
    }));
    expect(style.marker).not.toBe("none");
    expect(style.listStyle).toBe("none");
  }

  const details = page.locator("details", {
    has: page.getByText("More details", { exact: true }),
  });
  await more.focus();
  await expect(details).not.toHaveAttribute("open", "");
  await page.keyboard.press("Enter");
  await expect(details).toHaveAttribute("open", "");
  await page.keyboard.press("Space");
  await expect(details).not.toHaveAttribute("open", "");
  await page.keyboard.press("Space");
  await expect(details).toHaveAttribute("open", "");
});
