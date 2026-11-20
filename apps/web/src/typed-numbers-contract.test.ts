import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// A number a person types ("," in 1,000, ".8", "8.") is read through one rule (WP-15, ADR 0055): `typedMinor` in
// `lib/amount-input.ts` for money, `rateFromTyped` and `hoursFromTyped` from the shared package for rates and hours.
// The strict readers stay for numbers that come from the server. Nothing outside `lib/amount-input.ts` may call them on
// text from a box, or a new sheet refuses ".8" again. These read the source, like `query-keys-contract.test.ts`.
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
const offenders = (pattern: RegExp, allowed: string[] = []) =>
  files
    .filter(
      (file) =>
        !allowed.includes(rel(file)) &&
        pattern.test(readFileSync(file, "utf8")),
    )
    .map(rel);

describe("typed numbers", () => {
  it("money is read by typedMinor, never by parseMinorUnits on typed text", () => {
    expect(offenders(/\bparseMinorUnits\(/, ["lib/amount-input.ts"])).toEqual(
      [],
    );
  });
  it("a typed rate is read by rateFromTyped, not rateFromInverse", () => {
    expect(offenders(/\brateFromInverse\(/)).toEqual([]);
  });
  it("typed hours are read by hoursFromTyped, not hoursToHundredths", () => {
    expect(offenders(/\bhoursToHundredths\(/)).toEqual([]);
  });
});
