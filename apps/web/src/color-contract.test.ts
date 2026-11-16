import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// One color for money in, and no green (WP-11d, ADR 0054): Home and Transactions draw money in in the accent like
// Insights, `--positive` is gone, and `--warning` means "almost at the limit" and nothing else. These read the
// stylesheets, so a screen cannot drift back to a second hue.
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
const repo = resolve(__dirname, "../../..");
const stylesheets = [
  ...walk(root),
  ...walk(resolve(repo, "packages/ui/src")),
].filter((file) => file.endsWith(".css"));

describe("one color for money in", () => {
  it("no stylesheet uses or defines --positive", () => {
    const users = stylesheets
      .filter((file) => /--positive\b/.test(readFileSync(file, "utf8")))
      .map((file) => relative(repo, file));
    expect(users).toEqual([]);
  });
  it("money in is drawn in the accent on Home, Transactions and Insights", () => {
    const rule = (file: string, selector: string) =>
      readFileSync(join(root, file), "utf8").match(
        new RegExp(`${selector.replace(".", "\\.")}\\s*\\{([^}]*)\\}`),
      )?.[1] ?? "";
    expect(rule("features/home/home.css", ".home-pos")).toMatch(
      /color:\s*var\(--accent\)/,
    );
    expect(rule("features/transactions/transactions.css", ".tx-pos")).toMatch(
      /color:\s*var\(--accent\)/,
    );
    expect(rule("features/insights/insights.css", ".ins-pos")).toMatch(
      /color:\s*var\(--accent\)/,
    );
  });
  it('the sync dot is never amber: --warning means "almost at the limit" and nothing else', () => {
    expect(
      readFileSync(join(root, "features/shell/shell.css"), "utf8"),
    ).not.toMatch(/--warning/);
  });
});
