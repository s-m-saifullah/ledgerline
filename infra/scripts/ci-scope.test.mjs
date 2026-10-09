import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { classifyChanges } from "./ci-scope.mjs";

const base = "a".repeat(40);
const head = "b".repeat(40);
const pr = { pull_request: { base: { sha: base } } };
function classify(paths, options = {}) {
  return classifyChanges({
    eventName: "pull_request",
    event: pr,
    head,
    runGit: () => paths.map((path) => `${path}\0`).join(""),
    ...options,
  });
}

test("Markdown plans, ADRs and root instructions use lightweight checks", () => {
  assert.equal(
    classify([
      "docs/PLAN.md",
      "docs/adr/0010-test.md",
      "README.md",
      "AGENTS.md",
      "CLAUDE.md",
    ]).application,
    false,
  );
});
test("contracts, configuration, dependencies and unknown paths require full checks", () => {
  for (const path of [
    "docs/openapi.json",
    ".github/workflows/ci.yml",
    "pnpm-lock.yaml",
    "apps/web/README.md",
    "infra/scripts/ci-scope.mjs",
    "docs/example.ts",
  ])
    assert.equal(classify(["docs/PLAN.md", path]).application, true, path);
});
test("release checks cannot take the documentation shortcut", () => {
  assert.equal(classify(["README.md"], { forceFull: true }).application, true);
  assert.equal(
    classify(["README.md"], { eventName: "workflow_dispatch" }).application,
    true,
  );
  assert.equal(
    classify(["README.md"], {
      eventName: "push",
      event: { ref: "refs/tags/v0.0.6", before: base },
    }).application,
    true,
  );
});
test("main pushes compare the entire pushed range", () => {
  const result = classify(["docs/HANDOFF.md"], {
    eventName: "push",
    event: { ref: "refs/heads/main", before: base },
  });
  assert.equal(result.application, false);
  assert.equal(result.base, base);
});
test("missing or invalid comparison, empty diff and git failures run full checks", () => {
  assert.equal(classify([]).application, true);
  for (const value of [undefined, "0".repeat(40), "--anything", "bad\nsha"])
    assert.equal(
      classify(["README.md"], {
        event: { pull_request: { base: { sha: value } } },
      }).application,
      true,
    );
  assert.equal(classify(["README.md"], { head: "bad" }).application, true);
  assert.equal(
    classify(["README.md"], {
      runGit: () => {
        throw new Error("Missing base commit");
      },
    }).application,
    true,
  );
});

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), "ledgerline-ci-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const runGit = (args) =>
    execFileSync("git", args, { cwd: directory, encoding: "utf8" });
  runGit(["init", "-q", "-b", "main"]);
  function commit(path, content) {
    mkdirSync(dirname(join(directory, path)), { recursive: true });
    writeFileSync(join(directory, path), content);
    runGit(["add", "--all"]);
    runGit([
      "-c",
      "user.name=CI fixture",
      "-c",
      "user.email=ci@example.invalid",
      "commit",
      "-qm",
      "fixture",
    ]);
    return runGit(["rev-parse", "HEAD"]).trim();
  }
  const initial = commit("README.md", "Initial documentation\n");
  return { directory, runGit, commit, initial };
}
test("a final documentation commit cannot hide earlier code changes in a PR or push", (t) => {
  const f = fixture(t);
  f.commit("apps/api/example.ts", "export const changed = true;\n");
  const latest = f.commit("docs/HANDOFF.md", "Updated handoff\n");
  for (const eventName of ["pull_request", "push"])
    assert.equal(
      classifyChanges({
        eventName,
        head: latest,
        runGit: f.runGit,
        event: {
          ref: "refs/heads/main",
          before: f.initial,
          pull_request: { base: { sha: f.initial } },
        },
      }).application,
      true,
    );
});
test("renaming code into documentation cannot hide its old application path", (t) => {
  const f = fixture(t);
  const previous = f.commit("docs/openapi.json", "{}\n");
  renameSync(
    join(f.directory, "docs/openapi.json"),
    join(f.directory, "docs/contract.md"),
  );
  const latest = f.commit("README.md", "Changed documentation\n");
  assert.equal(
    classifyChanges({
      eventName: "pull_request",
      event: { pull_request: { base: { sha: previous } } },
      head: latest,
      runGit: f.runGit,
    }).application,
    true,
  );
});
test("deleting application files cannot be classified as documentation-only", (t) => {
  const f = fixture(t);
  const previous = f.commit("apps/api/example.ts", "export {};\n");
  rmSync(join(f.directory, "apps/api/example.ts"));
  const latest = f.commit("README.md", "Changed documentation\n");
  assert.equal(
    classifyChanges({
      eventName: "pull_request",
      event: { pull_request: { base: { sha: previous } } },
      head: latest,
      runGit: f.runGit,
    }).application,
    true,
  );
});
test("CLI emits a completed documentation decision and forces release checks", (t) => {
  const f = fixture(t);
  f.commit("docs/odd\nfilename.md", "Documentation with an unusual filename\n");
  const eventFile = join(f.directory, "event.json");
  const outputFile = join(f.directory, "output.txt");
  const summaryFile = join(f.directory, "summary.md");
  writeFileSync(
    eventFile,
    JSON.stringify({ pull_request: { base: { sha: f.initial } } }),
  );
  const script = fileURLToPath(new URL("./ci-scope.mjs", import.meta.url));
  const env = {
    ...process.env,
    GITHUB_EVENT_NAME: "pull_request",
    GITHUB_EVENT_PATH: eventFile,
    GITHUB_OUTPUT: outputFile,
    GITHUB_STEP_SUMMARY: summaryFile,
    FORCE_FULL_CHECKS: "false",
  };
  execFileSync(process.execPath, [script], { cwd: f.directory, env });
  assert.equal(
    readFileSync(outputFile, "utf8"),
    `application=false\nbase=${f.initial}\n`,
  );
  assert.match(readFileSync(summaryFile, "utf8"), /application checks skipped/);
  writeFileSync(outputFile, "");
  execFileSync(process.execPath, [script], {
    cwd: f.directory,
    env: { ...env, FORCE_FULL_CHECKS: "true" },
  });
  assert.equal(readFileSync(outputFile, "utf8"), "application=true\n");
});
