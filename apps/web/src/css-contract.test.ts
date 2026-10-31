import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// The rules of the web redesign (ADR 0047) that a stylesheet can break without any test noticing:
// the two layout widths, the type scale, the shapes, no shadows. They apply to the new files only; the old
// `styles.css` loses its own rules as each screen moves.
const files = [
  "../../../packages/ui/src/pieces.css",
  "layout.css",
  "components/overlay.css",
  "features/shell/shell.css",
  "features/shell/palette.css",
  "components/amount-text.css",
  "components/pick-row.css",
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
];
const css = (file: string) =>
  readFileSync(resolve(__dirname, file), "utf8").replace(
    /\/\*[\s\S]*?\*\//g,
    "",
  );

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
    const sizes = [...source.matchAll(/font-size:\s*([\d.]+)px/g)].map(
      (match) => Number(match[1]),
    );
    for (const size of sizes)
      expect([10, 12, 14, 19, 27, 31, 35]).toContain(size);
  });

  it("draws borders, never shadows", () => {
    expect(source).not.toMatch(/box-shadow|drop-shadow|text-shadow/);
  });

  it("takes its corner radii from the shape tokens", () => {
    const radii = [...source.matchAll(/border-radius:\s*([^;]+);/g)].map(
      (match) => (match[1] ?? "").trim(),
    );
    for (const radius of radii)
      expect(radius).toMatch(
        /^((var\(--shape-(field|card|hero|sheet)\)|0)(\s+|$)){1,4}$|^(calc\(var\(--shape-field\) - 3px\)|999px|50%|0)$/,
      );
  });
});
