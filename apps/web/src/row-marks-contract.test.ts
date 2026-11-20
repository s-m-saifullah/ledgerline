import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// A row's leading mark is one of the shared pieces (WP-11e): an initials `Avatar` or an icon `IconTile`/`ui-tile`.
// The old 40 px `category-mark` and the eyebrow and welcome card of the page that is not found are gone, so a
// screen cannot bring a second kind of mark or a promise-page back.
const walk = (dir: string, out: string[] = []): string[] => {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist") continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else out.push(path);
  }
  return out;
};
const root = resolve(__dirname);
const files = walk(root).filter(
  (file) =>
    /\.(tsx?|css)$/.test(file) &&
    !/\.test\.tsx?$/.test(file) &&
    !/[\\/]gallery[\\/]/.test(file),
);
const using = (pattern: RegExp) =>
  files
    .filter((file) => pattern.test(readFileSync(file, "utf8")))
    .map((file) => relative(root, file).replaceAll("\\", "/"));

describe("row marks and the page that is not found", () => {
  it("no category-mark or category-swatch: a category's mark is the shared tile", () => {
    expect(using(/category-(mark|swatch)/)).toEqual([]);
  });
  it("no welcome card, small mark or eyebrow: nothing promises a page that is not there", () => {
    expect(using(/welcome-card|small-mark|\beyebrow\b/)).toEqual([]);
  });
});
