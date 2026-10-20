import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

// Stub every step so the order and exit status of the daily job can be checked without Docker.
function run({ uploadExit = 0, drill = false }) {
  const dir = mkdtempSync(join(tmpdir(), "scheduled-test-"));
  mkdirSync(join(dir, "backups"));
  copyFileSync(
    new URL("./scheduled-backup.sh", import.meta.url),
    join(dir, "scheduled-backup.sh"),
  );
  const stub = (name, body) => {
    writeFileSync(
      join(dir, name),
      `#!/usr/bin/env bash\necho ${name} >> "${dir}/calls"\n${body}\n`,
    );
    chmodSync(join(dir, name), 0o755);
  };
  stub(
    "backup.sh",
    `touch "${dir}/backups/ledgerline-20261020T000000Z-1.dump"`,
  );
  stub("offsite-upload.sh", `exit ${uploadExit}`);
  stub("restore-drill.sh", "exit 0");
  stub("prune-backups.sh", "exit 0");
  const result = spawnSync(
    "bash",
    ["scheduled-backup.sh", ...(drill ? ["drill"] : [])],
    {
      cwd: dir,
      env: { ...process.env, LEDGERLINE_DIR: dir },
      encoding: "utf8",
    },
  );
  const calls = readFileSync(join(dir, "calls"), "utf8").trim().split("\n");
  return { result, calls };
}

test("backs up, uploads off-site, then prunes", () => {
  const { result, calls } = run({});
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(calls, [
    "backup.sh",
    "offsite-upload.sh",
    "prune-backups.sh",
  ]);
});

test("the weekly run uploads before the drill so a drill failure cannot skip the copy", () => {
  const { result, calls } = run({ drill: true });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(calls, [
    "backup.sh",
    "offsite-upload.sh",
    "restore-drill.sh",
    "prune-backups.sh",
  ]);
});

test("a failed upload still runs the drill and the prune, then exits 1", () => {
  const { result, calls } = run({ uploadExit: 1, drill: true });
  assert.equal(result.status, 1);
  assert.deepEqual(calls, [
    "backup.sh",
    "offsite-upload.sh",
    "restore-drill.sh",
    "prune-backups.sh",
  ]);
});
