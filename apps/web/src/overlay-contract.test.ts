import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { expect, it } from "vitest";

// Every sheet, drawer and question is the shared `Overlay` (ADR 0047), the date and time picker included. A feature
// that opens its own Radix dialog brings back a second set of corners, buttons and focus rules, so only these files may
// import it: the overlay itself and the command palette (a search box, not a sheet).
const allowed = new Set([
  "components/overlay.tsx",
  "features/shell/palette.tsx",
]);
const walk = (dir: string, out: string[] = []): string[] => {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist") continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else out.push(path);
  }
  return out;
};

it("only the overlay and the command palette import the Radix dialog", () => {
  const importers = walk(resolve(__dirname))
    .filter((file) => /\.tsx?$/.test(file) && !/\.test\.tsx?$/.test(file))
    .filter((file) =>
      /from\s+["']@radix-ui\/react-dialog["']/.test(readFileSync(file, "utf8")),
    )
    .map((file) => relative(__dirname, file).replaceAll("\\", "/"))
    .sort();
  expect(importers.filter((file) => !allowed.has(file))).toEqual([]);
});
