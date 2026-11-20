import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, normalize, relative, resolve, sep } from "node:path";
import { describe, expect, it } from "vitest";

// A feature does not import another feature's files to reuse a helper: what several features share lives in `lib/` or
// `components/` (CONTRIBUTING.md, WP-14). These read the source, like `query-keys-contract.test.ts`. Both lists below can only
// shrink: an entry that no longer matches anything fails the test, so it has to be deleted, and a new one needs a reason.
const src = resolve(__dirname);
const walk = (dir: string, out: string[] = []): string[] => {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist") continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else out.push(path);
  }
  return out;
};
const sources = walk(src).filter(
  (file) =>
    /\.tsx?$/.test(file) &&
    !/\.test\.tsx?$/.test(file) &&
    !/[\\/](gallery|test-support)[\\/]/.test(file),
);
const text = (file: string) => readFileSync(file, "utf8");
const slash = (path: string) => path.split(sep).join("/");

/** The module a local import points at, as a path under src without its extension (or undefined for a package). */
function target(from: string, specifier: string) {
  if (!specifier.startsWith(".")) return undefined;
  const base = normalize(join(dirname(from), specifier));
  for (const ending of ["", ".ts", ".tsx", ".css", "/index.ts", "/index.tsx"])
    if (existsSync(base + ending) && statSync(base + ending).isFile())
      return slash(relative(src, base + ending)).replace(/\.(tsx?)$/, "");
  return slash(relative(src, base));
}
const importsOf = (file: string) =>
  [
    ...text(file).matchAll(
      /(?:from|import|vi\.mock)\s*\(?\s*["'](\.[^"']+)["']/g,
    ),
  ].flatMap((match) => {
    const found = target(file, match[1] as string);
    return found ? [found] : [];
  });

/** Imports from one feature into another, as "importer -> target", both without `features/` or an extension. */
const crossFeature = new Set<string>();
for (const file of sources) {
  const own = slash(relative(src, file));
  if (!own.startsWith("features/")) continue;
  const feature = own.split("/")[1];
  for (const found of importsOf(file)) {
    const parts = found.split("/");
    if (parts[0] === "features" && parts.length > 2 && parts[1] !== feature)
      crossFeature.add(
        `${own.replace(/^features\//, "").replace(/\.tsx?$/, "")} -> ${parts.slice(1).join("/")}`,
      );
  }
}

/** The few places where one feature legitimately builds on another, each with the reason. */
const allowed: Record<string, string[]> = {
  "the Shell mounts the transaction workspace and the Add sheet": [
    "shell/shell -> transactions/quick-add",
    "shell/shell -> transactions/workspace",
  ],
  "the three workspaces lock each other both ways and share the selected transaction, so one component nests them":
    [
      "transactions/workspace -> categories/merge-workspace",
      "transactions/workspace -> clients/workspace",
    ],
  "Home opens a transaction in the workspace the Shell mounts": [
    "home/sections -> transactions/workspace",
  ],
  "a page hosts another feature's card or button": [
    "imports/import-page -> exports/export-card",
    "transactions/transactions-page -> exports/export-button",
    "settings/settings-page -> ledger/time-zone-card",
    "settings/two-factor-card -> auth/two-factor-api",
    "settings/clear-ledger -> ledger/api",
  ],
};
const allowedList = Object.values(allowed).flat();

describe("features", () => {
  it("do not import each other's files: what is shared lives in lib/ or components/", () => {
    const unexpected = [...crossFeature].filter(
      (entry) => !allowedList.includes(entry),
    );
    expect(unexpected.sort()).toEqual([]);
  });

  it("keep no allowance that is no longer needed, so the list only shrinks", () => {
    const stale = allowedList.filter((entry) => !crossFeature.has(entry));
    expect(stale).toEqual([]);
  });
});

describe("lib and components", () => {
  it("never import a feature", () => {
    const offenders = sources
      .filter((file) => /^(lib|components)\//.test(slash(relative(src, file))))
      .filter((file) =>
        importsOf(file).some((found) => found.startsWith("features/")),
      )
      .map((file) => slash(relative(src, file)));
    expect(offenders).toEqual([]);
  });
});

/** Source files over 400 lines, with the most lines each may have. A file that gets longer fails; one that shrinks under 400 must leave. */
const long: Record<string, number> = {
  "features/clients/workspace.tsx": 647,
  "features/transactions/transfer-form.tsx": 462,
  "features/clients/client-detail.tsx": 446,
  "features/home/sections.tsx": 437,
  "features/recurring/editor/sections.tsx": 424,
  "features/categories/categories-page.tsx": 419,
  "features/settings/two-factor-card.tsx": 417,
  "features/clients/operations/prepare.ts": 410,
  "features/shell/shell.tsx": 409,
  "features/transactions/transactions-page.tsx": 401,
};
const lines = (file: string) => text(file).split("\n").length - 1;

describe("source files", () => {
  it("stay under 400 lines, unless they were over it before and get no longer", () => {
    const over = sources
      .map((file) => [slash(relative(src, file)), lines(file)] as const)
      .filter(([path, count]) => count > (long[path] ?? 400))
      .map(([path, count]) => `${path}: ${count}`);
    expect(over).toEqual([]);
  });

  it("keep no allowance for a file that is now short enough", () => {
    const stale = Object.keys(long).filter((path) => {
      const file = join(src, path);
      return !existsSync(file) || lines(file) <= 400;
    });
    expect(stale).toEqual([]);
  });
});
