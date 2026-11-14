import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Toasts and the states a screen can be in (loading, empty, failed, read-only) are each one shared piece, so a screen
// cannot drift into its own look or wording (WP-11a). These read the source, like `overlay-contract.test.ts`.
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

describe("toasts", () => {
  it("are all the shared Toast: nobody draws a transaction-toast by hand", () => {
    expect(
      offenders(/className=["'`{][^>]*transaction-toast/, [
        "components/toast.tsx",
      ]),
    ).toEqual([]);
  });
  it("last for one of two lengths from toastDuration, never a number of their own", () => {
    expect(offenders(/durationMs=\{\s*(\d|[^}]*\?\s*\d)/)).toEqual([]);
  });
  it("are dismissed by the Toast's own control: no Dismiss word or cross button written in a feature", () => {
    expect(offenders(/>\s*Dismiss[^<]*</, ["components/toast.tsx"])).toEqual(
      [],
    );
    expect(offenders(/aria-label=["']Dismiss [a-z]+ notification["']/)).toEqual(
      [],
    );
  });
  it("call their Undo just Undo, and write client in lower case", () => {
    expect(
      offenders(/Undo (deletion|Client action)|Retry deletion Undo/),
    ).toEqual([]);
    expect(offenders(/Client action/)).toEqual([]);
  });
});

describe("states", () => {
  it("loading is the shared Loading: no paragraph of its own says Loading or Opening your", () => {
    expect(
      offenders(/<(p|span)\b[^>]*>\s*(Loading|Opening your)\b/, [
        "components/loading.tsx",
      ]),
    ).toEqual([]);
  });
  it("a failed load is LoadError: Home, Transactions and Budgets draw no card of their own", () => {
    expect(offenders(/className=["']ui-card (home|tx|bud)-error["']/)).toEqual(
      [],
    );
  });
  it("an empty list is EmptyState: no card of its own, no 'Nothing here' or 'No one here'", () => {
    expect(offenders(/className=["']ui-card tx-empty["']/)).toEqual([]);
    expect(
      offenders(
        /["'>]\s*(Nothing here|No one here|No clients here|No tag matches)\.?/,
      ),
    ).toEqual([]);
  });
  it("the read-only sentence is written once, in ReadOnlyNote", () => {
    expect(
      offenders(
        /read-only access to this ledger|You can view (accounts|categories) in this ledger/,
        ["components/read-only-note.tsx"],
      ),
    ).toEqual([]);
  });
});
