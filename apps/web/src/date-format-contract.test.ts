import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// A date is written one way on the web: `formatDay`, `formatDayTime`, `formatMonthShort`, `formatMonthLong` and
// `formatDayHead` in `lib/time.ts` (WP-11b). A screen that formats its own date drifts into its own words, its own
// year rule and its own locale. These read the source, like `toast-states-contract.test.ts`.
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

describe("dates", () => {
  it("are formatted in lib/time.ts: nobody calls toLocaleDateString or toLocaleTimeString", () => {
    expect(offenders(/toLocale(Date|Time)String\s*\(/)).toEqual([]);
  });
  it("are formatted in lib/time.ts: no toLocaleString with date or time options", () => {
    expect(
      offenders(
        /toLocaleString\s*\([^)]*\{[^}]*\b(year|month|day|weekday|hour|minute|dateStyle|timeStyle)\b/,
      ),
    ).toEqual([]);
  });
  it("are formatted in lib/time.ts: Intl.DateTimeFormat is used there and for a month label in lib/month.ts only", () => {
    expect(
      offenders(/Intl\.DateTimeFormat/, ["lib/time.ts", "lib/month.ts"]),
    ).toEqual([]);
  });
  it("are never a locale of their own: no en-GB or en-CA in a feature", () => {
    expect(offenders(/["'](en-GB|en-CA)["']/)).toEqual([]);
  });
  it("are never shown raw: no row hint, list item or span prints an entry's own YYYY-MM-DD", () => {
    expect(
      offenders(
        /(hint=\{|<li[^>]*>\{|<span[^>]*>\{)\s*[A-Za-z]+\.(date|serviceDate|dueDate)\s*\}/,
      ),
    ).toEqual([]);
  });
});
