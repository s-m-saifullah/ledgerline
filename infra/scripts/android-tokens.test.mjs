import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import {
  generate,
  oklchToHex,
  outputPath,
  palettes,
  tokensPath,
} from "./android-tokens.mjs";

const css = readFileSync(tokensPath, "utf8");

test("OKLCH greys and white convert to the known sRGB values", () => {
  assert.equal(oklchToHex(1, 0, 0), "#ffffff");
  assert.equal(oklchToHex(0, 0, 0), "#000000");
  assert.equal(oklchToHex(0.5, 0, 0), "#636363");
});

test("the accent shades come from the one seed in both themes", () => {
  const { light, dark } = palettes(css);
  assert.notEqual(light.accent, dark.accent);
  for (const hex of [light.accent, dark.accent, light["accent-soft"]])
    assert.match(hex, /^#[0-9a-f]{6}$/);
  // The light accent is dark enough for white text (WCAG AA 4.5:1).
  const luminance = (hex) => {
    const [r, g, b] = [1, 3, 5].map((i) => {
      const v = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
      return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const ratio = 1.05 / (luminance(light.accent) + 0.05);
  assert.ok(ratio >= 4.5, `accent contrast ${ratio.toFixed(2)}`);
});

test("plain tokens are carried over unchanged", () => {
  const { light, dark } = palettes(css);
  assert.equal(light.background, "#fafafa");
  assert.equal(dark.background, "#09090b");
  assert.equal(light["accent-foreground"], "#ffffff");
  assert.equal(light.danger, "#b91c1c");
});

test("the committed Android palette matches the web tokens", () => {
  assert.ok(existsSync(outputPath), "LedgerlinePalette.kt is missing");
  assert.equal(
    readFileSync(outputPath, "utf8"),
    generate(css),
    "out of date: run node infra/scripts/android-tokens.mjs",
  );
});

test("the hero fill and the chart ramp are tints of the seed, five distinct steps per theme", () => {
  const { light, dark } = palettes(css);
  for (const theme of [light, dark]) {
    const ramp = [1, 2, 3, 4, 5].map((n) => theme[`chart-${n}`]);
    assert.equal(new Set(ramp).size, 5);
    for (const hex of [theme["accent-deep"], ...ramp])
      assert.match(hex, /^#[0-9a-f]{6}$/);
  }
  assert.notEqual(light["accent-deep"], dark["accent-deep"]);
  assert.equal(light["accent-deep-foreground"], "#ffffff");
});
