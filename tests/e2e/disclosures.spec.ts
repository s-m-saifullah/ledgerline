import { expect, test } from "@playwright/test";
import { signIn } from "./sign-in";

// ADR 0039: a collapsible section must look pressable (a chevron, at least 44 px tall) and open and close from
// the keyboard. The Transactions page lost its two disclosures to the Filters sheet (ADR 0047), so this checks
// the one in the Add transaction dialog.
test("disclosures show a marker, are tall enough and work from the keyboard", async ({
  page,
}) => {
  await signIn(page);
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
