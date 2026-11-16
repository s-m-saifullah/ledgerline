import type { Page } from "@playwright/test";

/** The accent as the browser draws it (a probe element, because `--accent` is an unresolved relative color). */
export function accentColor(page: Page): Promise<string> {
  return page.evaluate(() => {
    const probe = document.createElement("span");
    probe.style.color = "var(--accent)";
    document.body.append(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();
    return color;
  });
}
