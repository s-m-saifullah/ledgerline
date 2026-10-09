import { expect, type Page } from "@playwright/test";

export async function setTheme(page: Page, theme: "light" | "dark") {
  if ((await page.locator("html").getAttribute("data-theme")) !== theme)
    await page
      .getByRole("button", { name: `Switch to ${theme} theme`, exact: true })
      .click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
}
