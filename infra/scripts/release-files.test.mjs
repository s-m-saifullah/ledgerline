import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";

// The release copies these files to the server. A name that does not exist fails the deploy after the images are built.
const workflow = readFileSync(
  new URL("../../.github/workflows/release.yml", import.meta.url),
  "utf8",
);
const copied = workflow
  .split("\n")
  .filter((line) => line.trim().startsWith("scp "))
  .flatMap((line) => line.match(/infra\/[\w./-]+/g) ?? []);

test("every file the release copies to the server exists", () => {
  assert.ok(copied.length >= 10, "the scp lines were not found");
  for (const file of copied)
    assert.ok(
      existsSync(new URL(`../../${file}`, import.meta.url)),
      `${file} is copied by release.yml but does not exist`,
    );
});

test("the recovery commands are copied to the server", () => {
  assert.ok(copied.includes("infra/scripts/reset-two-factor.sh"));
  assert.ok(copied.includes("infra/scripts/reset-password.sh"));
});

test("the recovery scripts are valid shell and ask for RESET first", () => {
  for (const name of ["reset-two-factor.sh", "reset-password.sh"]) {
    const path = new URL(`./${name}`, import.meta.url).pathname;
    const syntax = spawnSync("bash", ["-n", path], { encoding: "utf8" });
    assert.equal(syntax.status, 0, `${name}: ${syntax.stderr}`);
    const text = readFileSync(path, "utf8");
    assert.match(text, /Type RESET to continue/);
    assert.match(
      text,
      /\[\[ "\$answer" == RESET \]\] \|\| \{ echo 'Nothing changed\.'; exit 1; \}/,
    );
  }
});
