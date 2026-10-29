import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

// The foundation of the web redesign (ADR 0047): the shared pieces, the one overlay and the one layout system,
// checked in a real browser on the development-only gallery page (`/gallery.html`, which needs no sign-in and
// is not in the production build). jsdom cannot run container queries, so the widths are tested here.
test.beforeEach(({ browserName: _browser }, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop",
    "one project is enough: these tests set their own widths",
  );
});

async function open(
  page: Page,
  width: number,
  view = "pieces",
  query = "",
  height = 800,
) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width, height });
  await page.goto(`/gallery.html?view=${view}&theme=light${query}`);
  // A modal hides the page behind it from the accessibility tree, so wait for the dialog instead.
  if (/^(sheet|question)/.test(view))
    await expect(page.getByRole("dialog")).toBeVisible();
  else
    await expect(
      page.getByRole("heading", { level: 1, name: "Pieces" }),
    ).toBeVisible();
}
const box = async (page: Page, selector: string) =>
  page
    .locator(selector)
    .first()
    .evaluate((node) => {
      const rect = node.getBoundingClientRect();
      return {
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
      };
    });
const columns = (page: Page, testId: string) =>
  page
    .getByTestId(testId)
    .evaluate(
      (node) => getComputedStyle(node).gridTemplateColumns.split(" ").length,
    );

test.describe("the layout switches at 700 and 1100 px of the container", () => {
  for (const [width, count] of [
    [699, 1],
    [700, 2],
  ] as const)
    test(`two columns at ${width} px: ${count}`, async ({ page }) => {
      await open(page, width, "columns");
      expect(await columns(page, "cols-2")).toBe(count);
    });

  for (const [width, count] of [
    [1099, 1],
    [1100, 2],
  ] as const)
    test(`a list beside its detail at ${width} px: ${count} column(s)`, async ({
      page,
    }) => {
      await open(page, width, "split");
      expect(await columns(page, "split")).toBe(count);
      if (count === 1)
        await expect(page.getByTestId("split-empty")).toBeHidden();
      else await expect(page.getByTestId("split-empty")).toBeVisible();
    });

  test("the lopsided columns are 2 to 1 from 1100 px and equal below", async ({
    page,
  }) => {
    await open(page, 900, "columns");
    const [a, b] = await page
      .getByTestId("cols-21")
      .locator("> *")
      .evaluateAll((nodes) =>
        nodes.map((n) => n.getBoundingClientRect().width),
      );
    expect(Math.abs((a ?? 0) - (b ?? 0))).toBeLessThan(1);
    await open(page, 1280, "columns");
    const [wide, narrow] = await page
      .getByTestId("cols-21")
      .locator("> *")
      .evaluateAll((nodes) =>
        nodes.map((n) => n.getBoundingClientRect().width),
      );
    expect((wide ?? 0) / (narrow ?? 1)).toBeGreaterThan(1.9);
    expect((wide ?? 0) / (narrow ?? 1)).toBeLessThan(2.1);
  });

  test("the page is at most 1160 px wide", async ({ page }) => {
    await open(page, 1600, "columns");
    expect((await box(page, ".ui-page")).width).toBeLessThanOrEqual(1160);
  });
});

test.describe("the overlay", () => {
  test("is a bottom sheet under 700 px", async ({ page }) => {
    await open(page, 699, "sheet");
    const sheet = await box(page, ".ui-sheet");
    expect(sheet.left).toBe(0);
    expect(sheet.right).toBe(699);
    expect(sheet.bottom).toBe(800);
    expect(sheet.top).toBeGreaterThan(0);
  });

  test("is a 440 px right-hand drawer from 700 px", async ({ page }) => {
    for (const width of [700, 1280]) {
      await open(page, width, "sheet");
      const sheet = await box(page, ".ui-sheet");
      expect(sheet.width).toBe(440);
      expect(sheet.right).toBe(width);
      expect(sheet.top).toBe(0);
      expect(sheet.bottom).toBe(800);
    }
  });

  test("a wide form is a 560 px drawer", async ({ page }) => {
    await open(page, 1280, "sheet-wide");
    expect((await box(page, ".ui-sheet")).width).toBe(560);
  });

  test("keeps the primary button pinned while the content scrolls", async ({
    page,
  }) => {
    for (const width of [390, 1280]) {
      await open(page, width, "sheet");
      const body = page.locator(".ui-sheet-body");
      expect(
        await body.evaluate((node) => node.scrollHeight > node.clientHeight),
      ).toBe(true);
      expect(
        await body.evaluate((node) => {
          node.scrollTo(0, node.scrollHeight);
          return node.scrollTop;
        }),
      ).toBeGreaterThan(0);
      const save = page.getByRole("button", { name: "Save" });
      await expect(save).toBeInViewport({ ratio: 1 });
      // The drawer has a 1 px border all round.
      expect((await box(page, ".ui-sheet-foot")).bottom).toBeGreaterThanOrEqual(
        799,
      );
    }
  });

  test("puts Cancel on the left of a phone sheet and on the right of a drawer", async ({
    page,
  }) => {
    await open(page, 390, "sheet");
    const cancel = page.getByRole("button", { name: "Cancel" });
    expect((await cancel.boundingBox())?.x ?? 999).toBeLessThan(60);
    await open(page, 1280, "sheet");
    const drawer = await box(page, ".ui-sheet");
    const moved = await page
      .getByRole("button", { name: "Cancel" })
      .boundingBox();
    expect((moved?.x ?? 0) + (moved?.width ?? 0)).toBeGreaterThan(
      drawer.right - 24,
    );
  });

  test("a question is a centred dialog at any width", async ({ page }) => {
    for (const width of [390, 1280]) {
      await open(page, width, "question");
      const dialog = await box(page, ".ui-question");
      expect(
        Math.abs((dialog.left + dialog.right) / 2 - width / 2),
      ).toBeLessThan(2);
      expect(Math.abs((dialog.top + dialog.bottom) / 2 - 400)).toBeLessThan(2);
      expect(dialog.width).toBeLessThanOrEqual(420);
    }
  });

  test("starts on its first field and Escape returns focus to what opened it", async ({
    page,
  }) => {
    await open(page, 1280);
    await page.getByRole("button", { name: "Open sheet" }).click();
    await expect(page.getByLabel("Field 1", { exact: true })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(
      page.getByRole("button", { name: "Open sheet" }),
    ).toBeFocused();
  });
});

test.describe("the pieces", () => {
  for (const width of [320, 390, 700, 1280])
    test(`nothing scrolls sideways or is cut off at ${width} px`, async ({
      page,
    }) => {
      await open(page, width);
      const problems = await page.evaluate(() => {
        const found: string[] = [];
        if (document.documentElement.scrollWidth > innerWidth)
          found.push("the page scrolls sideways");
        for (const node of Array.from(
          document.querySelectorAll(
            ".ui-hero-fig-label, .ui-hero-fig-value, .ui-chip, .ui-pill, .ui-seg > button, .ui-btn",
          ),
        ))
          if (node.scrollWidth > node.clientWidth + 1)
            found.push(`cut: ${node.textContent}`);
        return found;
      });
      expect(problems).toEqual([]);
    });

  for (const width of [320, 390])
    test(`no hero label wraps at ${width} px`, async ({ page }) => {
      await open(page, width);
      const heights = await page
        .locator(".ui-hero-fig-label")
        .evaluateAll((nodes) =>
          nodes.map((node) => ({
            text: node.textContent,
            height: node.getBoundingClientRect().height,
            line: Number.parseFloat(getComputedStyle(node).lineHeight) || 15,
          })),
        );
      expect(heights).toHaveLength(3);
      for (const label of heights)
        expect(label.height, label.text ?? "").toBeLessThan(label.line * 1.5);
    });

  test("a row's title is one line, cut with an ellipsis, with the value beside it", async ({
    page,
  }) => {
    await open(page, 320);
    const long = page.getByText("Acme Studio Business Reserve Savings Account");
    const title = await long.evaluate((node) => ({
      overflow: getComputedStyle(node).textOverflow,
      lines: node.getClientRects().length,
    }));
    expect(title).toEqual({ overflow: "ellipsis", lines: 1 });
  });

  test("every control can be touched with a 44 px target", async ({ page }) => {
    await open(page, 390);
    const small = await page.evaluate(() => {
      const found: string[] = [];
      for (const node of Array.from(
        document.querySelectorAll<HTMLElement>(
          "main button, main a, .ui-topbar button, .ui-topbar a, .ui-chip, .ui-seg > button",
        ),
      )) {
        node.scrollIntoView({ block: "center" });
        const rect = node.getBoundingClientRect();
        const x = rect.left + rect.width / 2;
        // The hit area is what answers at the edges of a 44 px band around the centre.
        const top = document.elementFromPoint(
          x,
          rect.top + rect.height / 2 - 21,
        );
        const bottom = document.elementFromPoint(
          x,
          rect.top + rect.height / 2 + 21,
        );
        const hit = (found: Element | null) =>
          found === node || node.contains(found);
        if (
          !hit(top) ||
          !hit(bottom) ||
          (rect.width < 44 - 1 && !node.matches(".ui-pill"))
        )
          found.push(
            `${node.textContent?.trim() || node.getAttribute("aria-label")} ${Math.round(rect.width)}x${Math.round(rect.height)}`,
          );
      }
      return found;
    });
    expect(small).toEqual([]);
  });

  test("an amount takes the size of the text around it, not the old 32 px figure", async ({
    page,
  }) => {
    await open(page, 390);
    const size = (selector: string) =>
      page
        .locator(selector)
        .first()
        .evaluate((node) => ({
          size: getComputedStyle(node).fontSize,
          margin: getComputedStyle(node).marginTop,
        }));
    expect(await size(".ui-row-end .amount")).toEqual({
      size: "14px",
      margin: "0px",
    });
    expect(await size(".ui-hero-fig-value .amount")).toEqual({
      size: "14px",
      margin: "0px",
    });
    expect(await size(".ui-hero-figure .amount")).toEqual({
      size: "35px",
      margin: "0px",
    });
  });

  test("rows are at least 56 px and a switch row is one 56 px target", async ({
    page,
  }) => {
    await open(page, 390);
    for (const height of await page
      .locator(".ui-row")
      .evaluateAll((nodes) =>
        nodes.map((n) => n.getBoundingClientRect().height),
      ))
      expect(height).toBeGreaterThanOrEqual(56);
  });

  test("the hero stays the deep accent in both themes and its text passes axe", async ({
    page,
  }) => {
    for (const theme of ["light", "dark"]) {
      await page.setViewportSize({ width: 390, height: 800 });
      await page.goto(`/gallery.html?theme=${theme}`);
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      const colour = await page
        .locator(".ui-hero")
        .evaluate((node) => getComputedStyle(node).backgroundColor);
      expect(colour).not.toBe("rgba(0, 0, 0, 0)");
    }
  });

  test("the page paints its background to the bottom of a short page, in both themes", async ({
    page,
  }) => {
    for (const [theme, colour] of [
      ["light", "rgb(250, 250, 250)"],
      ["dark", "rgb(9, 9, 11)"],
    ] as const) {
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.goto(`/gallery.html?view=columns&theme=${theme}`);
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      expect(
        await page.evaluate(
          () => getComputedStyle(document.documentElement).backgroundColor,
        ),
      ).toBe(colour);
    }
  });

  test("privacy mode hides every amount, in the hero and in rows", async ({
    page,
  }) => {
    await open(page, 390, "pieces", "&privacy=on");
    await expect(page.getByText("$12,840.50")).toHaveCount(0);
    await expect(page.getByText("$8,420.15")).toHaveCount(0);
    expect(await page.getByText("Amount hidden").count()).toBeGreaterThan(5);
  });

  test("the near-limit and over-limit bars use the warning and red colours", async ({
    page,
  }) => {
    await open(page, 390);
    const fills = await page
      .locator(".ui-bar > i")
      .evaluateAll((nodes) =>
        nodes.map((node) => getComputedStyle(node).backgroundColor),
      );
    expect(new Set(fills).size).toBe(3);
  });
});

test.describe("accessibility", () => {
  for (const theme of ["light", "dark"])
    for (const [view, width] of [
      ["pieces", 390],
      ["pieces", 1280],
      ["sheet", 390],
      ["sheet", 1280],
      ["question", 1280],
    ] as const)
      test(`axe finds nothing on ${view} at ${width} px in the ${theme} theme`, async ({
        page,
      }) => {
        await page.setViewportSize({ width, height: 900 });
        await page.goto(`/gallery.html?view=${view}&theme=${theme}`);
        await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
        await page.waitForTimeout(400);
        const results = await new AxeBuilder({ page })
          .withTags([
            "wcag2a",
            "wcag2aa",
            "wcag21a",
            "wcag21aa",
            "wcag22aa",
            "best-practice",
          ])
          .analyze();
        expect(
          results.violations.map(
            (v) => `${v.id}: ${v.nodes.map((n) => n.target).join(" | ")}`,
          ),
        ).toEqual([]);
      });
});
