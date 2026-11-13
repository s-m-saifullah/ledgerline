import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { before, describe, test } from "node:test";

// A server release tag must sit on main, like the Android one. The script is run in a real clone of a throwaway
// origin: a tag on a commit of main passes, a tag on a commit only a side branch has is refused.
const script = new URL("./tag-on-main.sh", import.meta.url).pathname;
const git = (cwd, ...args) => {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "t",
      GIT_AUTHOR_EMAIL: "t@example.com",
      GIT_COMMITTER_NAME: "t",
      GIT_COMMITTER_EMAIL: "t@example.com",
    },
  });
  assert.equal(result.status, 0, `git ${args.join(" ")}: ${result.stderr}`);
  return result.stdout.trim();
};
const commit = (cwd, name) => {
  writeFileSync(join(cwd, name), name);
  git(cwd, "add", name);
  git(cwd, "commit", "-q", "-m", name);
  return git(cwd, "rev-parse", "HEAD");
};

describe("tag-on-main.sh", () => {
  let origin;
  let work;
  const shas = {};
  before(() => {
    const root = mkdtempSync(join(tmpdir(), "tag-on-main-"));
    origin = join(root, "origin.git");
    git(root, "init", "-q", "--bare", "-b", "main", origin);
    const seed = join(root, "seed");
    git(root, "clone", "-q", origin, seed);
    git(seed, "checkout", "-q", "-b", "main");
    shas.first = commit(seed, "first");
    shas.second = commit(seed, "second");
    git(seed, "push", "-q", "origin", "main");
    git(seed, "checkout", "-q", "-b", "side");
    shas.side = commit(seed, "side-only");
    git(seed, "push", "-q", "origin", "side");
    git(seed, "checkout", "-q", "main");
    shas.third = commit(seed, "third");
    git(seed, "push", "-q", "origin", "main");
    work = join(root, "work");
    git(root, "clone", "-q", origin, work);
    git(work, "fetch", "-q", "origin", "side");
  });
  const run = (sha, extra = {}) =>
    spawnSync("bash", [script, sha], {
      cwd: work,
      encoding: "utf8",
      env: { ...process.env, ...extra },
    });

  test("passes for the newest commit of main and for an older one", () => {
    for (const sha of [shas.third, shas.first]) {
      const result = run(sha);
      assert.equal(result.status, 0, result.stderr + result.stdout);
      assert.match(result.stdout, /is on main/);
    }
  });

  test("refuses a commit that only a side branch has, and says why", () => {
    const result = run(shas.side);
    assert.notEqual(result.status, 0);
    assert.match(result.stdout + result.stderr, /not on main/);
  });

  test("refuses a commit that does not exist", () => {
    assert.notEqual(run("0".repeat(40)).status, 0);
  });

  test("needs a commit to check", () => {
    const result = spawnSync("bash", [script], { cwd: work, encoding: "utf8" });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /usage/i);
  });

  test("refuses when main cannot be fetched, instead of passing unseen", () => {
    git(
      work,
      "remote",
      "set-url",
      "origin",
      join(tmpdir(), "no-such-origin.git"),
    );
    try {
      assert.notEqual(run(shas.third).status, 0);
    } finally {
      git(work, "remote", "set-url", "origin", origin);
    }
  });
});
