import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

// A fake `docker` stands in for the tool image: `age` passes data through and `rclone` succeeds or fails on
// demand, and every call is logged so the tests can check that no key reaches a command line.
const RECIPIENT = `age1${"q".repeat(58)}`;
const SECRET = "test-secret-value-never-printed";
const DUMP = "ledgerline-20261020T000000Z-1.dump";

function setup({ config = true, tamper = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "offsite-test-"));
  mkdirSync(join(dir, "backups"));
  mkdirSync(join(dir, "bin"));
  const dump = join(dir, "backups", DUMP);
  writeFileSync(dump, "pretend dump");
  writeFileSync(`${dump}.manifest`, "users|0|x");
  const sum = createHash("sha256")
    .update(tamper ? "different" : "pretend dump")
    .digest("hex");
  writeFileSync(`${dump}.sha256`, `${sum}  ${DUMP}\n`);
  const docker = join(dir, "bin", "docker");
  writeFileSync(
    docker,
    `#!/bin/bash
echo "$*" >> "$FAKE_DOCKER_LOG"
if [[ "$1 $2" == "image inspect" ]]; then exit 0; fi
if [[ "$*" == *" age -r "* ]]; then cat; exit 0; fi
if [[ "$*" == *" rclone "* ]]; then [[ -n "\${FAKE_UPLOAD_FAIL:-}" ]] && exit 1; exit 0; fi
exit 0
`,
  );
  chmodSync(docker, 0o755);
  if (config)
    writeFileSync(
      join(dir, "offsite.env"),
      [
        `OFFSITE_AGE_RECIPIENT=${RECIPIENT}`,
        "OFFSITE_S3_ENDPOINT=https://s3.example.com",
        "OFFSITE_BUCKET=example-bucket",
        "OFFSITE_KEY_ID=test-key-id",
        `OFFSITE_APP_KEY=${SECRET}`,
      ].join("\n"),
    );
  return dir;
}
const upload = (dir, env = {}) =>
  spawnSync(
    "bash",
    [new URL("./offsite-upload.sh", import.meta.url).pathname],
    {
      env: {
        ...process.env,
        PATH: `${join(dir, "bin")}:${process.env.PATH}`,
        LEDGERLINE_DIR: dir,
        FAKE_DOCKER_LOG: join(dir, "docker.log"),
        ...env,
      },
      encoding: "utf8",
    },
  );
const dockerLog = (dir) =>
  existsSync(join(dir, "docker.log"))
    ? readFileSync(join(dir, "docker.log"), "utf8")
    : "";
const status = (dir) =>
  readFileSync(join(dir, "backups/offsite.status"), "utf8");

test("is off, and succeeds quietly, without offsite.env", () => {
  const dir = setup({ config: false });
  const result = upload(dir);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /not configured/);
  assert.equal(existsSync(join(dir, "backups/offsite.status")), false);
  assert.equal(dockerLog(dir), "");
});

test("uploads one encrypted archive and records success without printing keys", () => {
  const dir = setup();
  const result = upload(dir);
  assert.equal(result.status, 0, result.stderr);
  assert.match(status(dir), /result=ok/);
  assert.match(status(dir), /archive=ledgerline-20261020T000000Z-1\.tar\.age/);
  const log = dockerLog(dir);
  assert.match(
    log,
    /off:example-bucket\/ledgerline\/ledgerline-20261020T000000Z-1\.tar\.age/,
  );
  assert.match(log, /age -r age1/);
  assert.ok(!log.includes(SECRET), "the key must not be on a command line");
  assert.ok(!result.stdout.includes(SECRET) && !result.stderr.includes(SECRET));
  assert.equal(existsSync(join(dir, "backups", DUMP)), true);
  assert.deepEqual(
    readFileSync(join(dir, "backups", DUMP), "utf8"),
    "pretend dump",
  );
});

test("a failed upload exits 1, keeps the last good time and leaves local files alone", () => {
  const dir = setup();
  assert.equal(upload(dir).status, 0);
  const okTime = /last_ok=(\S+)/.exec(status(dir))[1];
  const result = upload(dir, { FAKE_UPLOAD_FAIL: "1" });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /Off-site upload failed: upload step/);
  assert.match(status(dir), /result=failed/);
  assert.equal(/last_ok=(\S+)/.exec(status(dir))[1], okTime);
  assert.ok(!result.stdout.includes(SECRET) && !result.stderr.includes(SECRET));
  assert.equal(existsSync(join(dir, "backups", DUMP)), true);
  assert.equal(existsSync(join(dir, "backups", `${DUMP}.manifest`)), true);
  assert.equal(existsSync(join(dir, "backups", `${DUMP}.sha256`)), true);
});

test("refuses a backup that does not match its checksum before anything is encrypted or sent", () => {
  const dir = setup({ tamper: true });
  const result = upload(dir);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /does not match its checksum/);
  assert.ok(!dockerLog(dir).includes("rclone"));
  assert.ok(!dockerLog(dir).includes("age -r"));
  assert.match(status(dir), /result=failed/);
});

test("rejects a recipient that is not an age public key and a missing setting", () => {
  const dir = setup();
  const cfg = join(dir, "offsite.env");
  writeFileSync(cfg, readFileSync(cfg, "utf8").replace(RECIPIENT, "not-a-key"));
  const bad = upload(dir);
  assert.equal(bad.status, 1);
  assert.match(bad.stdout, /not an age public key/);

  const dir2 = setup();
  const cfg2 = join(dir2, "offsite.env");
  writeFileSync(
    cfg2,
    readFileSync(cfg2, "utf8").replace(/OFFSITE_BUCKET=.*\n/, ""),
  );
  const missing = upload(dir2);
  assert.equal(missing.status, 1);
  assert.match(missing.stdout, /OFFSITE_BUCKET is missing/);
  assert.ok(!dockerLog(dir2).includes("rclone"));
});

test("fails cleanly when there is no complete local backup", () => {
  const dir = setup();
  writeFileSync(join(dir, "backups", `${DUMP}.sha256`), "");
  const result = upload(dir);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /no complete local backup/);
});
