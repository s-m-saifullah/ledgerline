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

const printedPath = "backups/ledgerline-20261020T000000Z-7.dump";

// Stub backup.sh and restore-drill.sh so what the helper hands from one to the other can be checked.
function run({ backupExit = 0, printed = printedPath, drillExit = 0 }) {
  const dir = mkdtempSync(join(tmpdir(), "backup-and-drill-test-"));
  mkdirSync(join(dir, "backups"));
  copyFileSync(
    new URL("./backup-and-drill.sh", import.meta.url),
    join(dir, "backup-and-drill.sh"),
  );
  // A newer dump than the one backup.sh reports: "the newest file" would pick this one.
  writeFileSync(
    join(dir, "backups", "ledgerline-20261021T000000Z-9.dump"),
    "x",
  );
  const stub = (name, body) => {
    writeFileSync(join(dir, name), `#!/usr/bin/env bash\n${body}\n`);
    chmodSync(join(dir, name), 0o755);
  };
  const saved = printed
    ? `printf 'Backup saved to %s (with snapshot manifest and checksum)\\n' '${printed}'`
    : "echo 'something else was printed'";
  stub(
    "backup.sh",
    `echo backup >> "${dir}/calls"\n${backupExit === 0 ? saved : "echo 'disk full' >&2"}\nexit ${backupExit}`,
  );
  stub(
    "restore-drill.sh",
    `echo "drill $1" >> "${dir}/calls"\nexit ${drillExit}`,
  );
  const result = spawnSync("bash", ["backup-and-drill.sh"], {
    cwd: dir,
    env: { ...process.env, LEDGERLINE_DIR: dir },
    encoding: "utf8",
  });
  let calls = [];
  try {
    calls = readFileSync(join(dir, "calls"), "utf8").trim().split("\n");
  } catch {}
  return { result, calls };
}

test("drills the dump backup.sh reported, not the newest file", () => {
  const { result, calls } = run({});
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.deepEqual(calls, ["backup", `drill ${printedPath}`]);
});

test("passes the backup's own output through", () => {
  const { result } = run({});
  assert.match(result.stdout, /Backup saved to backups\/ledgerline-/);
});

test("a failed backup stops before any drill and exits 1", () => {
  const { result, calls } = run({ backupExit: 1 });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /Backup failed/);
  assert.deepEqual(calls, ["backup"]);
});

test("a failed drill exits 1 and names the dump", () => {
  const { result, calls } = run({ drillExit: 1 });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /Restore drill failed/);
  assert.match(result.stdout, /ledgerline-20261020T000000Z-7\.dump/);
  assert.equal(calls.length, 2);
});

test("a backup that reports no path is a failure, never a drill of some other file", () => {
  const { result, calls } = run({ printed: "" });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /could not find the dump/i);
  assert.deepEqual(calls, ["backup"]);
});
