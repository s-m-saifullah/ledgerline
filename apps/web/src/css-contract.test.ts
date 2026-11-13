import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// The rules of the web redesign (ADR 0047) that a stylesheet can break without any test noticing:
// the two layout widths, the type scale, the shapes, no shadows. They apply to the new files; the old
// `styles.css` is brought in one rule at a time (below).
const files = [
  "../../../packages/ui/src/pieces.css",
  "layout.css",
  "components/overlay.css",
  "features/shell/shell.css",
  "features/shell/palette.css",
  "components/amount-text.css",
  "components/pick-row.css",
  "components/delete-trigger.css",
  "components/entry-amount.css",
  "components/month-head.css",
  "features/home/home.css",
  "features/transactions/transactions.css",
  "features/transactions/entry-sheet.css",
  "features/imports/import.css",
  "features/shell/more.css",
  "features/settings/settings.css",
  "features/budgets/budgets.css",
  "features/insights/insights.css",
  "features/clients/clients.css",
  "features/clients/operations/editors.css",
  "features/loans/loans.css",
  "features/categories/categories.css",
  "features/accounts/accounts.css",
  "features/recurring/recurring.css",
  "features/tags/tags.css",
  "features/auth/auth.css",
  "features/currencies/currencies.css",
  "features/profile/profile.css",
  "features/users/users.css",
];
const css = (file: string) =>
  readFileSync(resolve(__dirname, file), "utf8").replace(
    /\/\*[\s\S]*?\*\//g,
    "",
  );

const typeScale = [10, 12, 14, 19, 27, 31, 35];
// Every font size is a step of the scale. The one other value is the size of a form field, `--field-text`
// (16 px, ADR 0052). `inherit` takes the size from outside, so it adds none.
const expectTypeScale = (source: string) => {
  const sizes = [...source.matchAll(/font-size:\s*([^;}]+)[;}]/g)].map(
    (match) => (match[1] ?? "").trim(),
  );
  for (const size of sizes) {
    if (size === "inherit" || size === "var(--field-text)") continue;
    expect(size).toMatch(/^[\d.]+px$/);
    expect(typeScale).toContain(Number.parseFloat(size));
  }
  // The `font:` shorthand hides a size from the check above.
  const shorthands = [
    ...source.matchAll(/(?:^|[;{\s])font:\s*([^;}]+)[;}]/g),
  ].map((match) => (match[1] ?? "").replace(/\s+/g, " ").trim());
  for (const value of shorthands) expect(value).toBe("inherit");
};
// A page title has one rule (the global `h1` in `styles.css`): a feature does not set its own size.
const expectNoTitleSize = (source: string) =>
  expect(source).not.toMatch(/h1[^{}]*\{[^}]*font-size/);

const expectNoShadows = (source: string) =>
  expect(source).not.toMatch(/box-shadow|drop-shadow|text-shadow/);
const expectShapeRadii = (source: string) => {
  const radii = [...source.matchAll(/border-radius:\s*([^;]+);/g)].map(
    (match) => (match[1] ?? "").trim(),
  );
  for (const radius of radii)
    expect(radius).toMatch(
      /^((var\(--shape-(field|card|hero|sheet)\)|0)(\s+|$)){1,4}$|^(calc\(var\(--shape-field\) - 3px\)|999px|999px 0 0 999px|0 999px 999px 0|50%|0)$/,
    );
};

describe.each(files)("%s", (file) => {
  const source = css(file);

  it("switches layout at 700 and 1100 px only", () => {
    const widths = [...source.matchAll(/@(?:container|media)[^{]*\{/g)].flatMap(
      (match) => [...match[0].matchAll(/([\d.]+)px/g)].map((m) => m[1]),
    );
    for (const width of widths)
      expect(["699.98", "700", "1099.98", "1100"]).toContain(width);
  });

  it("uses only the type scale", () => {
    expectTypeScale(source);
  });

  it("sets no page-title size of its own", () => {
    expectNoTitleSize(source);
  });

  it("draws borders, never shadows", () => {
    expectNoShadows(source);
  });

  it("takes its corner radii from the shape tokens", () => {
    expectShapeRadii(source);
  });
});

// The old `styles.css` is brought under the contract one rule at a time, as its screens move: shadows,
// corner radii and the type scale now; the two widths follow with the page frame.
describe("styles.css", () => {
  const source = css("styles.css");

  it("uses only the type scale", () => {
    expectTypeScale(source);
  });

  it("draws borders, never shadows", () => {
    expectNoShadows(source);
  });

  it("takes its corner radii from the shape tokens", () => {
    expectShapeRadii(source);
  });
});
