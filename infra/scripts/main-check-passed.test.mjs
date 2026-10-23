import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

/** Runs the script with a stand-in `gh` that answers the check-runs call with the given runs. */
function run(checkRuns) {
  const dir = mkdtempSync(join(tmpdir(), "main-check-"));
  const gh = join(dir, "gh");
  // The stand-in applies the script's own --jq filter with node, so the filter itself is under test.
  writeFileSync(
    gh,
    `#!/usr/bin/env node
const args = process.argv.slice(2);
if (!args[1].includes("/commits/abc123/check-runs")) { console.error("unexpected call " + args[1]); process.exit(2); }
const filter = args[args.indexOf("--jq") + 1];
const data = ${JSON.stringify({ check_runs: checkRuns })};
if (filter !== '.check_runs[] | select(.name == "check") | (.conclusion // "pending")') { console.error("unexpected filter"); process.exit(2); }
for (const run of data.check_runs) if (run.name === "check") console.log(run.conclusion ?? "pending");
`,
  );
  chmodSync(gh, 0o755);
  return spawnSync("bash", ["infra/scripts/main-check-passed.sh", "abc123"], {
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${dir}:${process.env.PATH}`,
      GITHUB_REPOSITORY: "owner/repo",
    },
  });
}

test("passes when the check run succeeded (other jobs are ignored)", () => {
  const result = run([
    { name: "unit", conclusion: "failure" },
    { name: "check", conclusion: "success" },
  ]);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /passed for abc123/);
});

test("fails when there is no check run for the commit", () => {
  const result = run([{ name: "unit", conclusion: "success" }]);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /No finished 'check' run/);
});

test("fails when the check failed, was cancelled or is still running", () => {
  for (const conclusion of ["failure", "cancelled", "skipped", null]) {
    const result = run([{ name: "check", conclusion }]);
    assert.equal(result.status, 1, String(conclusion));
    assert.match(result.stdout, /not a success/);
  }
});

test("fails when any check run for the commit is not a success", () => {
  const result = run([
    { name: "check", conclusion: "success" },
    { name: "check", conclusion: "failure" },
  ]);
  assert.equal(result.status, 1);
});
