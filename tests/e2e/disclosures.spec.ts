import { expect, test } from "@playwright/test";
import { signIn } from "./sign-in";

// ADR 0039: a collapsible section must look pressable (a chevron, at least 44 px tall) and open and close from
// the keyboard.
test("disclosures show a marker, are tall enough and work from the keyboard", async ({
  page,
}) => {
  await signIn(page);
  await page.goto("/transactions");
  const filter = page.getByText("Filter entries", { exact: true });
  await expect(filter).toBeVisible();

  const summaries = page.locator("details > summary");
  expect(await summaries.count()).toBeGreaterThanOrEqual(2);
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

  const details = page.locator("details", { has: filter });
  await filter.focus();
  await expect(details).not.toHaveAttribute("open", "");
  await page.keyboard.press("Enter");
  await expect(details).toHaveAttribute("open", "");
  await page.keyboard.press("Space");
  await expect(details).not.toHaveAttribute("open", "");
  await page.keyboard.press("Space");
  await expect(details).toHaveAttribute("open", "");
});
