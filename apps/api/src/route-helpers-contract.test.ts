import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// Reads the sources, as the other source-scan tests do: the shared route helpers are used, not copied again.
const root = import.meta.dirname;
function files(folder: string): string[] {
  return readdirSync(folder).flatMap((name) => {
    const path = join(folder, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}
const sources = files(root).filter((path) => path.endsWith(".ts"));
const name = (path: string) => relative(root, path).replaceAll("\\", "/");
const routeFiles = sources.filter(
  (path) =>
    /(^|\/)[\w-]*routes\.ts$/.test(name(path)) &&
    !name(path).endsWith(".test.ts"),
);
const offenders = (pattern: RegExp, among = sources, allowed: string[] = []) =>
  among
    .filter((path) => !allowed.includes(name(path)))
    .filter((path) => pattern.test(readFileSync(path, "utf8")))
    .map(name);

describe("the route helpers", () => {
  it("finds the sources", () => {
    expect(routeFiles.length).toBeGreaterThan(15);
    expect(sources.length).toBeGreaterThan(200);
  });

  it("are the only place an error map is written", () => {
    expect(
      offenders(/^\s*(?:const|export const) errors\s*=\s*\{/m, [
        ...routeFiles,
        join(root, "app.ts"),
      ]),
    ).toEqual([]);
  });

  it("are the only place the security schemes are written", () => {
    expect(
      offenders(/\{\s*(?:sessionCookie|bearerAuth):\s*\[\]\s*\}/, sources, [
        "lib/route-helpers.ts",
      ]).filter((path) => !path.endsWith(".test.ts")),
    ).toEqual([]);
  });

  it("are the only readers of the session besides the account guard", () => {
    expect(
      offenders(/\b(?:getSession|requestSession)\(/, sources, [
        "lib/route-helpers.ts",
        "modules/auth/guard.ts",
        "modules/auth/request-session.ts",
      ]).filter((path) => !path.endsWith(".test.ts")),
    ).toEqual([]);
  });

  it("leave app.ts with no query of its own and no hand-built problem for a ledger", () => {
    expect(offenders(/from "\.\/db\/schema"/, [join(root, "app.ts")])).toEqual(
      [],
    );
    expect(readFileSync(join(root, "app.ts"), "utf8")).not.toMatch(
      /"\/api\/v1\/ledgers/,
    );
  });

  it("are not skipped by a test file that builds its own database guard", () => {
    expect(
      offenders(/endsWith\("\/ledgerline_test"\)/, sources, [
        "test-support/harness.ts",
        "route-helpers-contract.test.ts",
      ]),
    ).toEqual([]);
  });

  it("keep the API version in one place", () => {
    expect(
      offenders(/["']0\.1\.\d+["']/, sources, ["lib/api-version.ts"]).filter(
        (path) => !path.includes("migrat"),
      ),
    ).toEqual([]);
  });
});
