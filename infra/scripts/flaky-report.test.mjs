import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const script = new URL("./flaky-report.mjs", import.meta.url).pathname;
const run = (reportText, env = {}, extraArgs = []) => {
  const dir = mkdtempSync(join(tmpdir(), "flaky-"));
  const file = join(dir, "results.json");
  if (reportText !== null) writeFileSync(file, reportText);
  return spawnSync("node", [script, file, ...extraArgs], {
    encoding: "utf8",
    env: { ...process.env, GITHUB_STEP_SUMMARY: "", ...env },
  });
};
const spec = (title, file, line, status) => ({
  title,
  file,
  line,
  tests: [{ projectName: "desktop", status, results: [] }],
});
const report = (suites) => JSON.stringify({ suites });

test("lists a test that failed first and then passed, with an annotation, and still exits 0", () => {
  const result = run(
    report([
      {
        title: "budgets.spec.ts",
        specs: [spec("adds a limit", "budgets.spec.ts", 12, "flaky")],
        suites: [
          {
            title: "nested",
            specs: [spec("deep one", "deep/x.spec.ts", 3, "flaky")],
          },
        ],
      },
    ]),
  );
  assert.equal(result.status, 0, result.stderr);
  assert.match(
    result.stdout,
    /::warning file=budgets\.spec\.ts,line=12::.*adds a limit.*desktop/,
  );
  assert.match(
    result.stdout,
    /::warning file=deep\/x\.spec\.ts,line=3::.*deep one/,
  );
  assert.match(result.stdout, /2 flaky test/);
});

test("says so when nothing was flaky, and ignores passed, failed and skipped tests", () => {
  const result = run(
    report([
      {
        title: "a.spec.ts",
        specs: [
          spec("ok", "a.spec.ts", 1, "expected"),
          spec("broken", "a.spec.ts", 2, "unexpected"),
          spec("later", "a.spec.ts", 3, "skipped"),
        ],
      },
    ]),
  );
  assert.equal(result.status, 0);
  assert.doesNotMatch(result.stdout, /::warning/);
  assert.match(result.stdout, /No flaky tests/);
});

test("writes the list to the step summary when GitHub gives one", () => {
  const dir = mkdtempSync(join(tmpdir(), "flaky-summary-"));
  const summary = join(dir, "summary.md");
  writeFileSync(summary, "");
  const result = run(
    report([
      { title: "a", specs: [spec("slow one", "a.spec.ts", 5, "flaky")] },
    ]),
    {
      GITHUB_STEP_SUMMARY: summary,
    },
  );
  assert.equal(result.status, 0);
  assert.match(
    spawnSync("cat", [summary], { encoding: "utf8" }).stdout,
    /slow one/,
  );
});

test("a missing or unreadable report is a note, never a failure", () => {
  for (const text of [null, "not json", "{}"]) {
    const result = run(text);
    assert.equal(result.status, 0, String(text));
    assert.doesNotMatch(result.stdout, /::warning file/);
  }
  assert.match(run(null).stdout, /no report/i);
});

test("puts the spec folder in front of the file name so the annotation lands on the file", () => {
  const text = report([
    { title: "a", specs: [spec("slow one", "budgets.spec.ts", 5, "flaky")] },
  ]);
  assert.match(
    run(text, {}, ["tests/e2e"]).stdout,
    /::warning file=tests\/e2e\/budgets\.spec\.ts,line=5::/,
  );
  assert.match(
    run(text, {}, ["tests/e2e/"]).stdout,
    /::warning file=tests\/e2e\/budgets\.spec\.ts,line=5::/,
  );
});

test("a title with a percent sign or a line break cannot break out of the annotation", () => {
  const text = report([
    {
      title: "a",
      specs: [spec("50% done\nand ::error::more", "a.spec.ts", 1, "flaky")],
    },
  ]);
  const line = run(text)
    .stdout.split("\n")
    .find((item) => item.startsWith("::warning"));
  assert.ok(line);
  assert.match(line, /50%25 done%0Aand ::error::more/);
  assert.doesNotMatch(run(text).stdout, /^::error::/m);
});
