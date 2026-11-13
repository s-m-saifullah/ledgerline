import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";

// A third-party action on a floating tag (`@v7`) can change under us: the Android release job runs actions beside
// the signing key and the image job runs them with `packages: write`. Every external action is pinned to a full
// commit, with the version in a comment so Dependabot can keep both current.
const dir = new URL("../../.github/workflows/", import.meta.url);
const files = readdirSync(dir).filter((name) => name.endsWith(".yml"));

const usesLines = (text) =>
  text
    .split("\n")
    .map((line, index) => ({ line: line.trim(), number: index + 1 }))
    .filter(({ line }) => /^(- )?uses:/.test(line));

test("there are workflows to check", () => {
  assert.ok(files.length >= 4, files.join(", "));
});

test("every external action is pinned to a full commit, with its version in a comment", () => {
  let checked = 0;
  for (const name of files) {
    const text = readFileSync(new URL(name, dir), "utf8");
    for (const { line, number } of usesLines(text)) {
      const target = line.replace(/^(- )?uses:\s*/, "");
      if (target.startsWith("./")) continue;
      checked += 1;
      assert.match(
        target,
        /^[\w.-]+\/[\w.-]+(\/[\w./-]+)?@[0-9a-f]{40} # v\d+(\.\d+){1,2}$/,
        `${name}:${number} is not pinned to a commit with a version comment`,
      );
    }
  }
  assert.ok(checked >= 20, `only ${checked} external actions found`);
});

test("a reusable workflow of this repository is called by path, not by a moving ref", () => {
  for (const name of files) {
    const text = readFileSync(new URL(name, dir), "utf8");
    for (const { line, number } of usesLines(text)) {
      const target = line.replace(/^(- )?uses:\s*/, "");
      if (target.startsWith("./"))
        assert.doesNotMatch(target, /@/, `${name}:${number}`);
    }
  }
});

test("Dependabot keeps the pinned actions current", () => {
  const config = readFileSync(
    new URL("../../.github/dependabot.yml", import.meta.url),
    "utf8",
  );
  assert.match(config, /package-ecosystem: github-actions\n\s+directory: \//);
});
