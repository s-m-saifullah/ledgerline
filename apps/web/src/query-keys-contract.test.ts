import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Every cached answer has its key from `lib/query-keys.ts`, and every ledger write refreshes the screen through
// `invalidateLedger` (WP-12), so a new screen cannot go back to a hand-kept list that forgets Budgets or Reports. These
// read the source, like `toast-states-contract.test.ts`.
const walk = (dir: string, out: string[] = []): string[] => {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist") continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else out.push(path);
  }
  return out;
};
const files = walk(resolve(__dirname))
  .filter((file) => /\.tsx?$/.test(file) && !/\.test\.tsx?$/.test(file))
  .filter((file) => !/[\\/](gallery|test-support)[\\/]/.test(file));
const rel = (file: string) => relative(__dirname, file).replaceAll("\\", "/");
const text = (file: string) => readFileSync(file, "utf8");
const offenders = (pattern: RegExp, allowed: string[] = []) =>
  files
    .filter((file) => !allowed.includes(rel(file)) && pattern.test(text(file)))
    .map(rel);

describe("query keys", () => {
  it("are never written out as an array in a screen: they come from queryKeys", () => {
    expect(
      offenders(/queryKey:\s*\[/, ["lib/query-keys.ts", "lib/api.ts"]),
    ).toEqual([]);
  });
  it("are never an array in a cache call either", () => {
    expect(
      offenders(
        /\.(setQueryData|getQueryData|removeQueries|prefetchQuery|fetchQuery|cancelQueries)(<[^>]*>)?\(\s*\[/,
      ),
    ).toEqual([]);
  });
  it("name the ledger once, through useLedger: no screen picks the first ledger itself", () => {
    expect(
      offenders(/ledgers\.data\?\.items\[0\]/, ["lib/use-ledger.ts"]),
    ).toEqual([]);
  });
});

describe("refreshing after a write", () => {
  it("is invalidateLedger: nobody invalidates a ledger area by hand", () => {
    expect(
      offenders(
        /invalidateQueries\(\s*\{\s*queryKey:\s*queryKeys\.[a-zA-Z]+\(/,
        ["lib/ledger-cache.ts"],
      ),
    ).toEqual([]);
  });
  it("is never a loop over area names", () => {
    expect(
      offenders(
        /for \(const (key|name) of \[\s*"(accounts|home|loans|categories|contacts)"/,
      ),
    ).toEqual([]);
  });
});
