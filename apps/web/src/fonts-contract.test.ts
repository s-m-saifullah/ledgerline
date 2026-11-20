import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

// The text font is two files per weight (Latin, and Latin extended for ₹, ł, ş and the like), woff2 only, with the
// ranges the package itself defines, so a release carries and caches about 100 KB of fonts and not 56 files (WP-13).
// These read the source, like `toast-states-contract.test.ts`.
const read = (path: string) => readFileSync(join(__dirname, path), "utf8");
const css = read("fonts.css");
const require = createRequire(import.meta.url);
const inter = dirname(require.resolve("@fontsource/inter/package.json"));
const ranges = JSON.parse(
  readFileSync(join(inter, "unicode.json"), "utf8"),
) as Record<string, string>;
const faces = [...css.matchAll(/@font-face\s*\{([^}]*)\}/g)].map(
  (match) => match[1] as string,
);
const field = (block: string, name: string) =>
  new RegExp(`${name}:\\s*([^;]+);`).exec(block)?.[1]?.trim();

describe("the text font", () => {
  it("is the Latin and Latin extended faces of the four weights in use, and nothing else", () => {
    const found = faces.map((block) => {
      const file = /inter-([a-z-]+)-(\d+)-normal\.woff2/.exec(block);
      return `${file?.[1]} ${file?.[2]}`;
    });
    expect(found.sort()).toEqual(
      ["latin", "latin-ext"]
        .flatMap((set) => [400, 500, 600, 700].map((w) => `${set} ${w}`))
        .sort(),
    );
  });

  it("is woff2 only, swapped in, with the weight its file is named for", () => {
    for (const block of faces) {
      expect(block).not.toMatch(/\.woff[^2]|format\(['"]woff['"]\)/);
      expect(field(block, "font-display")).toBe("swap");
      expect(field(block, "font-family")).toMatch(/Inter/);
      const named = /-(\d+)-normal/.exec(block)?.[1];
      expect(field(block, "font-weight")).toBe(named);
    }
  });

  it("gives each face the range the package defines for its set", () => {
    for (const block of faces) {
      const set = /inter-([a-z-]+)-\d+-normal/.exec(block)?.[1] as string;
      // The formatter may put a space after each comma; the list is the same.
      expect(field(block, "unicode-range")?.replace(/\s+/g, ""), set).toBe(
        ranges[set],
      );
    }
  });

  it("is imported by the app and by the gallery, and nothing imports the package's all-scripts style sheets", () => {
    for (const entry of ["main.tsx", "gallery/main.tsx"]) {
      const source = read(entry);
      expect(source, entry).toMatch(/import ["'](\.\.?\/)+fonts\.css["']/);
      expect(source, entry).not.toMatch(/@fontsource\/inter\/\d+\.css/);
    }
  });
});
