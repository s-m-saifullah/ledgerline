import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const HOUR = 3600 * 1000;

function age(file, hours) {
  const when = new Date(Date.now() - hours * HOUR);
  utimesSync(file, when, when);
}

// A server folder in a temporary directory. dumpHours is the age of the newest finished dump (null: none);
// offsite is null (not configured), "none" (configured, never ran) or { result, hours }; diskPct is what a stub
// `df` reports as used (null makes `df` fail).
function run({
  dumpHours = 5,
  checksum = true,
  olderDumpHours = null,
  offsite = null,
  diskPct = 40,
  env = {},
  originalCommand,
  backupsFolder = true,
}) {
  const dir = mkdtempSync(join(tmpdir(), "health-test-"));
  if (backupsFolder) mkdirSync(join(dir, "backups"));
  mkdirSync(join(dir, "bin"));
  copyFileSync(
    new URL("./health-report.sh", import.meta.url),
    join(dir, "health-report.sh"),
  );
  const dump = (name, hours, finished) => {
    const path = join(dir, "backups", name);
    writeFileSync(path, "dump");
    writeFileSync(`${path}.manifest`, "manifest");
    if (finished) writeFileSync(`${path}.sha256`, "abc  dump\n");
    else writeFileSync(`${path}.sha256`, "");
    age(path, hours);
  };
  if (olderDumpHours !== null)
    dump("ledgerline-20261110T030000Z-1.dump", olderDumpHours, true);
  if (dumpHours !== null)
    dump("ledgerline-20261112T030000Z-2.dump", dumpHours, checksum);
  if (offsite !== null) writeFileSync(join(dir, "offsite.env"), "x=1\n");
  if (offsite && offsite !== "none") {
    const status = join(dir, "backups", "offsite.status");
    writeFileSync(
      status,
      `last_attempt=2026-11-12T03:15:00Z\nresult=${offsite.result}\nlast_ok=2026-11-12T03:15:00Z\narchive=a.tar.age\n`,
    );
    age(status, offsite.hours);
  }
  writeFileSync(
    join(dir, "bin", "df"),
    diskPct === null
      ? "#!/usr/bin/env bash\nexit 1\n"
      : `#!/usr/bin/env bash\nprintf 'Filesystem 1024-blocks Used Available Capacity Mounted on\\n/dev/stub 9000 4000 5000 ${diskPct}%% /\\n'\n`,
  );
  chmodSync(join(dir, "bin", "df"), 0o755);
  const before = backupsFolder
    ? readdirSync(join(dir, "backups"), { recursive: true }).sort()
    : [];
  const childEnv = {
    ...process.env,
    LEDGERLINE_DIR: dir,
    PATH: `${join(dir, "bin")}:${process.env.PATH}`,
    ...env,
  };
  delete childEnv.SSH_ORIGINAL_COMMAND;
  if (originalCommand !== undefined)
    childEnv.SSH_ORIGINAL_COMMAND = originalCommand;
  const result = spawnSync("bash", ["health-report.sh"], {
    cwd: dir,
    env: childEnv,
    encoding: "utf8",
  });
  const after = backupsFolder
    ? readdirSync(join(dir, "backups"), { recursive: true }).sort()
    : [];
  return { result, dir, before, after };
}

test("everything fresh passes and says so line by line", () => {
  const { result } = run({
    offsite: { result: "ok", hours: 5 },
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /^ok +newest backup/m);
  assert.match(result.stdout, /^ok +off-site copy/m);
  assert.match(result.stdout, /^ok +disk/m);
  assert.doesNotMatch(result.stdout, /^FAIL/m);
});

test("no backup at all fails", () => {
  const { result } = run({ dumpHours: null });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /^FAIL +newest backup/m);
});

test("a newest backup older than 26 hours fails; 25 hours passes", () => {
  const stale = run({ dumpHours: 27 });
  assert.equal(stale.result.status, 1);
  assert.match(stale.result.stdout, /^FAIL +newest backup/m);
  const fresh = run({ dumpHours: 25 });
  assert.equal(fresh.result.status, 0, fresh.result.stdout);
});

test("a fresh dump with no checksum is not a backup", () => {
  const { result } = run({
    dumpHours: 1,
    checksum: false,
    olderDumpHours: 40,
  });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /^FAIL +newest backup/m);
});

test("the newest finished dump counts even when an older one exists", () => {
  const { result } = run({ dumpHours: 2, olderDumpHours: 80 });
  assert.equal(result.status, 0, result.stdout);
});

test("MAX_DUMP_HOURS changes the limit", () => {
  const { result } = run({ dumpHours: 5, env: { MAX_DUMP_HOURS: "1" } });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /^FAIL +newest backup/m);
});

test("a failed off-site copy fails", () => {
  const { result } = run({ offsite: { result: "failed", hours: 2 } });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /^FAIL +off-site copy/m);
});

test("an off-site result older than 48 hours fails even when it said ok", () => {
  const { result } = run({ offsite: { result: "ok", hours: 50 } });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /^FAIL +off-site copy/m);
  const fine = run({ offsite: { result: "ok", hours: 47 } });
  assert.equal(fine.result.status, 0, fine.result.stdout);
});

test("off-site configured but never run fails", () => {
  const { result } = run({ offsite: "none" });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /^FAIL +off-site copy/m);
});

test("off-site not configured is skipped, not failed", () => {
  const { result } = run({ offsite: null });
  assert.equal(result.status, 0, result.stdout);
  assert.match(result.stdout, /^skip +off-site copy/m);
});

test("disk use of 85% or more fails; 84% passes", () => {
  const full = run({ diskPct: 85 });
  assert.equal(full.result.status, 1);
  assert.match(full.result.stdout, /^FAIL +disk/m);
  const fine = run({ diskPct: 84 });
  assert.equal(fine.result.status, 0, fine.result.stdout);
});

test("MAX_DISK_PCT changes the limit", () => {
  const { result } = run({ diskPct: 40, env: { MAX_DISK_PCT: "30" } });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /^FAIL +disk/m);
});

test("a disk figure that cannot be read fails", () => {
  const { result } = run({ diskPct: null });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /^FAIL +disk/m);
});

test("a missing backups folder fails without crashing", () => {
  const { result } = run({ backupsFolder: false, dumpHours: null });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /^FAIL +newest backup/m);
});

test("every failing check is reported, not just the first", () => {
  const { result } = run({
    dumpHours: 90,
    offsite: { result: "failed", hours: 90 },
    diskPct: 95,
  });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /^FAIL +newest backup/m);
  assert.match(result.stdout, /^FAIL +off-site copy/m);
  assert.match(result.stdout, /^FAIL +disk/m);
});

test("it only reads: the backups folder is unchanged", () => {
  const { before, after } = run({ offsite: { result: "ok", hours: 3 } });
  assert.deepEqual(after, before);
});

test("the report names no path, file or host", () => {
  const { result, dir } = run({
    dumpHours: 90,
    offsite: { result: "failed", hours: 90 },
    diskPct: 95,
  });
  const text = result.stdout + result.stderr;
  assert.ok(!text.includes(dir), "the folder path was printed");
  assert.doesNotMatch(text, /ledgerline-2026|\.dump|\.tar\.age|\//);
});

test("a threshold that is not a number is refused", () => {
  for (const env of [
    { MAX_DUMP_HOURS: "soon" },
    { MAX_DISK_PCT: "" },
    { MAX_OFFSITE_HOURS: "1; ls" },
  ]) {
    const { result } = run({ env });
    assert.equal(result.status, 2, JSON.stringify(env));
  }
});

test("over SSH, 'check HOURS PERCENT' sets the limits", () => {
  const { result } = run({
    dumpHours: 5,
    diskPct: 40,
    originalCommand: "check 1 90",
  });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /^FAIL +newest backup/m);
  const loose = run({
    dumpHours: 30,
    diskPct: 40,
    originalCommand: "check 48 90",
  });
  assert.equal(loose.result.status, 0, loose.result.stdout);
});

test("over SSH, any other command is refused and nothing is checked", () => {
  for (const originalCommand of [
    "rm -rf /",
    "check 1",
    "check 1 90; ls",
    "check a b",
    "check 1 90 extra",
    "bash",
  ]) {
    const { result } = run({ originalCommand });
    assert.equal(result.status, 2, originalCommand);
    assert.equal(result.stdout, "", originalCommand);
  }
});

test("over SSH, an empty command runs the default checks", () => {
  const { result } = run({ originalCommand: "" });
  assert.equal(result.status, 0, result.stdout);
});

test("the limits are exact: 26 whole hours fails, 25 passes; 48 for off-site", () => {
  const dump = run({ dumpHours: 26.2 });
  assert.equal(dump.result.status, 1);
  const offsite = run({ offsite: { result: "ok", hours: 48.2 } });
  assert.equal(offsite.result.status, 1);
  assert.match(offsite.result.stdout, /^FAIL +off-site copy/m);
});

test("a dump with nothing in it is not a backup", () => {
  const { result, dir } = run({ dumpHours: 1, olderDumpHours: 80 });
  writeFileSync(join(dir, "backups", "ledgerline-20261112T030000Z-2.dump"), "");
  const again = spawnSync("bash", ["health-report.sh"], {
    cwd: dir,
    env: {
      ...process.env,
      LEDGERLINE_DIR: dir,
      PATH: `${join(dir, "bin")}:${process.env.PATH}`,
    },
    encoding: "utf8",
  });
  assert.equal(result.status, 0);
  assert.equal(again.status, 1, again.stdout);
});

test("over SSH, text before 'check' is refused too", () => {
  const { result } = run({ originalCommand: "x check 1 90" });
  assert.equal(result.status, 2);
});

test("a file dated in the future reads as 0 hours, never a negative age", () => {
  const { result } = run({ dumpHours: -2 });
  assert.equal(result.status, 0, result.stdout);
  assert.match(result.stdout, /newest backup: 0 h old/);
});
