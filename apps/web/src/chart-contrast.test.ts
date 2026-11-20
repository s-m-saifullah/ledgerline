import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// A chart's colors must be told apart from the card they sit on (WCAG 1.4.11 asks 3:1 for a graphic that carries
// meaning). The accent ramp (`--chart-1` to `--chart-5`) and the neutral color for every part past the fifth
// (`--neutral-chart`) are computed here from the tokens, the way the browser mixes them, in both themes (WP-11e-2).
const repo = resolve(__dirname, "../../..");
const tokens = readFileSync(
  resolve(repo, "packages/ui/src/tokens.css"),
  "utf8",
);
const pieces = readFileSync(
  resolve(repo, "packages/ui/src/pieces.css"),
  "utf8",
);

type Rgb = [number, number, number]; // linear sRGB
const toLinear = (c: number) =>
  c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
const hexToLinear = (hex: string): Rgb => {
  const h = hex.replace("#", "");
  return [0, 2, 4].map((i) =>
    toLinear(Number.parseInt(h.slice(i, i + 2), 16) / 255),
  ) as Rgb;
};
const linearToOklab = ([r, g, b]: Rgb): Rgb => {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
};
const oklabToLinear = ([L, a, b]: Rgb): Rgb => {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
};
const oklchToLinear = (L: number, C: number, h: number): Rgb =>
  oklabToLinear([
    L,
    C * Math.cos((h * Math.PI) / 180),
    C * Math.sin((h * Math.PI) / 180),
  ]);
const luminance = (rgb: Rgb) => {
  const [r, g, b] = rgb.map((c) => Math.min(1, Math.max(0, c))) as Rgb;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: Rgb, b: Rgb) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [
    number,
    number,
  ];
  return (hi + 0.05) / (lo + 0.05);
};
/** `color-mix(in oklab, A p%, B)`: p of A, the rest of B. */
const mix = (a: Rgb, b: Rgb, share: number): Rgb => {
  const [x, y] = [linearToOklab(a), linearToOklab(b)];
  return oklabToLinear(
    x.map((v, i) => share * v + (1 - share) * (y[i] as number)) as Rgb,
  );
};

/** The block of tokens.css for one theme: the light `:root` or the dark one. */
const block = (theme: "light" | "dark") => {
  const start =
    theme === "light"
      ? tokens.indexOf(":root {")
      : tokens.indexOf(':root[data-theme="dark"] {');
  return tokens.slice(start, tokens.indexOf("}", start));
};
const hexToken = (css: string, name: string) => {
  const match = css.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`));
  if (!match) throw new Error(`--${name} is not a hex color`);
  return hexToLinear(match[1] as string);
};
const seed = tokens.match(
  /--accent-seed:\s*oklch\(([\d.]+)\s+([\d.]+)\s+([\d.]+)\)/,
);
const [seedC, seedH] = [Number(seed?.[2]), Number(seed?.[3])];
const neutral = pieces.match(
  /--neutral-chart:\s*color-mix\(in oklab,\s*var\(--muted\)\s*(\d+)%,\s*var\(--surface\)\)/,
);

describe("chart colors against the card they sit on", () => {
  for (const theme of ["light", "dark"] as const) {
    it(`the neutral color is at least 3:1 on the surface in ${theme}`, () => {
      expect(neutral).not.toBeNull();
      const css = block(theme);
      const surface = hexToken(css, "surface");
      const color = mix(
        hexToken(css, "muted"),
        surface,
        Number(neutral?.[1]) / 100,
      );
      expect(contrast(color, surface)).toBeGreaterThanOrEqual(3);
    });
    it(`each of the five accent steps is at least 3:1 on the surface in ${theme}`, () => {
      const css = block(theme);
      const surface = hexToken(css, "surface");
      for (let n = 1; n <= 5; n++) {
        const step = css.match(
          new RegExp(
            `--chart-${n}:\\s*oklch\\(from var\\(--accent-seed\\)\\s+([\\d.]+)`,
          ),
        );
        expect(step, `--chart-${n} in ${theme}`).not.toBeNull();
        const color = oklchToLinear(Number(step?.[1]), seedC, seedH);
        expect(
          contrast(color, surface),
          `--chart-${n} in ${theme}`,
        ).toBeGreaterThanOrEqual(3);
      }
    });
  }
});
