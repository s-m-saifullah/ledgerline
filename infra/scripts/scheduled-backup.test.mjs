import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

// Stub every step so the order and exit status of the daily job can be checked without Docker.
// freeMb is what a stub `df` reports as available; null makes `df` fail.
function run({
  uploadExit = 0,
  drill = false,
  backupExit = 0,
  drillExit = 0,
  pruneExit = 0,
  freeMb = 5000,
  env = {},
  backupsFolder = true,
}) {
  const dir = mkdtempSync(join(tmpdir(), "scheduled-test-"));
  if (backupsFolder) mkdirSync(join(dir, "backups"));
  mkdirSync(join(dir, "bin"));
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
    `touch "${dir}/backups/ledgerline-20261020T000000Z-1.dump"\nexit ${backupExit}`,
  );
  stub("offsite-upload.sh", `exit ${uploadExit}`);
  stub("restore-drill.sh", `exit ${drillExit}`);
  stub("prune-backups.sh", `exit ${pruneExit}`);
  writeFileSync(
    join(dir, "bin", "df"),
    freeMb === null
      ? "#!/usr/bin/env bash\nexit 1\n"
      : `#!/usr/bin/env bash\nprintf 'Filesystem 1048576-blocks Used Available Capacity Mounted on\\n/dev/stub 9000 4000 ${freeMb} 45%% /\\n'\n`,
  );
  chmodSync(join(dir, "bin", "df"), 0o755);
  const result = spawnSync(
    "bash",
    ["scheduled-backup.sh", ...(drill ? ["drill"] : [])],
    {
      cwd: dir,
      env: {
        ...process.env,
        LEDGERLINE_DIR: dir,
        PATH: `${join(dir, "bin")}:${process.env.PATH}`,
        ...env,
      },
      encoding: "utf8",
    },
  );
  let calls = [];
  try {
    calls = readFileSync(join(dir, "calls"), "utf8").trim().split("\n");
  } catch {}
  return { result, calls, dir };
}

test("prunes first, then backs up and uploads off-site", () => {
  const { result, calls } = run({});
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(calls, [
    "prune-backups.sh",
    "backup.sh",
    "offsite-upload.sh",
  ]);
});

test("the weekly run uploads before the drill so a drill failure cannot skip the copy", () => {
  const { result, calls } = run({ drill: true });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(calls, [
    "prune-backups.sh",
    "backup.sh",
    "offsite-upload.sh",
    "restore-drill.sh",
  ]);
});

test("a failed upload still runs the drill, then exits 1", () => {
  const { result, calls } = run({ uploadExit: 1, drill: true });
  assert.equal(result.status, 1);
  assert.deepEqual(calls, [
    "prune-backups.sh",
    "backup.sh",
    "offsite-upload.sh",
    "restore-drill.sh",
  ]);
});

test("a failed backup still leaves the prune done, uploads nothing and exits 1", () => {
  const { result, calls } = run({ backupExit: 1, drill: true });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /Backup failed/);
  assert.deepEqual(calls, ["prune-backups.sh", "backup.sh"]);
});

test("a failed drill exits 1 after the prune, the backup and the upload", () => {
  const { result, calls } = run({ drillExit: 1, drill: true });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /Restore drill failed/);
  assert.deepEqual(calls, [
    "prune-backups.sh",
    "backup.sh",
    "offsite-upload.sh",
    "restore-drill.sh",
  ]);
});

test("a failed prune does not stop the backup, but the run exits 1", () => {
  const { result, calls } = run({ pruneExit: 1 });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /pruning old backups failed/i);
  assert.deepEqual(calls, [
    "prune-backups.sh",
    "backup.sh",
    "offsite-upload.sh",
  ]);
});

test("low disk space is said loudly and fails the run, but the backup is still tried", () => {
  const { result, calls } = run({ freeMb: 50 });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /Low disk space: 50 MB free/);
  assert.match(result.stdout, /below 200 MB/);
  assert.deepEqual(calls, [
    "prune-backups.sh",
    "backup.sh",
    "offsite-upload.sh",
  ]);
});

test("the low-disk line sits between 199 and 200 MB", () => {
  const low = run({ freeMb: 199 });
  assert.equal(low.result.status, 1);
  const enough = run({ freeMb: 200 });
  assert.equal(enough.result.status, 0, enough.result.stdout);
  assert.doesNotMatch(enough.result.stdout, /Low disk space/);
});

test("MIN_FREE_MB moves the low-disk line", () => {
  const { result } = run({ freeMb: 50, env: { MIN_FREE_MB: "10" } });
  assert.equal(result.status, 0, result.stdout);
  const bad = run({ env: { MIN_FREE_MB: "ten" } });
  assert.equal(bad.result.status, 1);
  assert.match(bad.result.stdout, /MIN_FREE_MB must be a number/);
  assert.deepEqual(bad.calls, []);
});

test("when the free space cannot be read the backup still runs and the run still passes", () => {
  const { result, calls } = run({ freeMb: null });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /Could not read the free disk space/);
  assert.ok(calls.includes("backup.sh"));
});

test("a missing backups folder is created private, so the first run can still read the free space", () => {
  const { result, dir } = run({ backupsFolder: false });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(statSync(join(dir, "backups")).mode & 0o777, 0o700);
  assert.doesNotMatch(result.stdout, /Could not read the free disk space/);
});
