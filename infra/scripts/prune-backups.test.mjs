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

function setup(ages) {
  const dir = mkdtempSync(join(tmpdir(), "prune-test-"));
  mkdirSync(join(dir, "backups"));
  ages.forEach((days, i) => {
    const stamp = `ledgerline-2026100${i + 1}T000000Z-1.dump`;
    for (const suffix of ["", ".manifest", ".sha256"]) {
      const file = join(dir, "backups", stamp + suffix);
      writeFileSync(file, "x");
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
