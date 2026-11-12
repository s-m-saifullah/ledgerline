import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

// ages: days old, oldest first. missing: 1-based numbers of dumps with no checksum file;
// empty: numbers of dumps whose checksum file is empty (the disk filled while it was written).
function setup(ages, { missing = [], empty = [] } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "prune-test-"));
  mkdirSync(join(dir, "backups"));
  ages.forEach((days, i) => {
    const stamp = `ledgerline-2026100${i + 1}T000000Z-1.dump`;
    for (const suffix of ["", ".manifest", ".sha256"]) {
      if (suffix === ".sha256" && missing.includes(i + 1)) continue;
      const file = join(dir, "backups", stamp + suffix);
      writeFileSync(
        file,
        suffix === ".sha256" && empty.includes(i + 1) ? "" : "x",
      );
      const when = new Date(Date.now() - days * 86400000);
      utimesSync(file, when, when);
    }
  });
  return dir;
}
const prune = (dir, env = {}) =>
  spawnSync("bash", [new URL("./prune-backups.sh", import.meta.url).pathname], {
    env: { ...process.env, LEDGERLINE_DIR: dir, ...env },
    encoding: "utf8",
  });
const has = (dir, n) =>
  existsSync(join(dir, "backups", `ledgerline-2026100${n}T000000Z-1.dump`));

test("prunes only dumps older than seven days, with their manifest and checksum", () => {
  // Oldest first: 30, 20, 9, 3, 1 days old.
  const dir = setup([30, 20, 9, 3, 1]);
  const result = prune(dir, { KEEP_MIN: "0" });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(
    [1, 2, 3, 4, 5].map((n) => has(dir, n)),
    [false, false, false, true, true],
  );
  assert.equal(
    existsSync(
      join(dir, "backups", "ledgerline-20261001T000000Z-1.dump.manifest"),
    ),
    false,
  );
  assert.equal(
    existsSync(
      join(dir, "backups", "ledgerline-20261001T000000Z-1.dump.sha256"),
    ),
    false,
  );
});
test("always keeps the newest three even when they are all old", () => {
  const dir = setup([40, 30, 20, 15, 10]);
  assert.equal(prune(dir).status, 0);
  assert.deepEqual(
    [1, 2, 3, 4, 5].map((n) => has(dir, n)),
    [false, false, true, true, true],
  );
});
test("rejects non-numeric settings", () => {
  const dir = setup([1]);
  assert.equal(prune(dir, { KEEP_DAYS: "7; rm -rf /" }).status, 1);
  assert.ok(has(dir, 1));
});
test("a dump without a checksum is not one of the newest three, and goes when old", () => {
  // Newest (5) is unfinished and 10 days old; 4, 3 and 2 are the three kept; 1 is the oldest.
  const dir = setup([40, 30, 20, 15, 10], { missing: [5] });
  assert.equal(prune(dir).status, 0);
  assert.deepEqual(
    [1, 2, 3, 4, 5].map((n) => has(dir, n)),
    [false, true, true, true, false],
  );
});
test("a recent dump without a checksum is left alone and still not counted", () => {
  // Dump 5 may still be written; it stays, and the three newest finished dumps are 4, 3 and 2.
  const dir = setup([40, 30, 20, 15, 1], { missing: [5] });
  assert.equal(prune(dir).status, 0);
  assert.deepEqual(
    [1, 2, 3, 4, 5].map((n) => has(dir, n)),
    [false, true, true, true, true],
  );
});
test("an empty checksum file counts as no checksum", () => {
  const dir = setup([40, 30, 20, 15, 10], { empty: [5] });
  assert.equal(prune(dir).status, 0);
  assert.deepEqual(
    [1, 2, 3, 4, 5].map((n) => has(dir, n)),
    [false, true, true, true, false],
  );
});
