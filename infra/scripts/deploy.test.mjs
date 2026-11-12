import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const hasFlock = spawnSync("sh", ["-c", "command -v flock"]).status === 0;
const skip = hasFlock
  ? false
  : "flock is only available on the Linux deploy host and CI";

const oldRelease = "API_IMAGE=old-api\nWEB_IMAGE=old-web\n";
const olderRelease = "API_IMAGE=older-api\nWEB_IMAGE=older-web\n";
const newRelease = (repository) =>
  `API_IMAGE=${repository}-api:v9.9.9\nWEB_IMAGE=${repository}-web:v9.9.9\n`;

// Run deploy.sh against stub docker/curl and stub backup scripts so no real service is touched.
// volume: the database volume exists. container: a database container exists (running or stopped).
// dockerError: `docker volume ls` itself fails. dbStartExit: starting the database fails.
function run({
  volume = true,
  container = true,
  dockerError = false,
  dbStartExit = 0,
  backupExit = 0,
  uploadExit = 0,
  curlExit = 0,
  repository = "ghcr.io/example-owner/ledgerline",
  release = oldRelease,
  previous = null,
  env = {},
}) {
  const dir = mkdtempSync(join(tmpdir(), "deploy-test-"));
  const bin = join(dir, "bin");
  mkdirSync(bin);
  copyFileSync(new URL("./deploy.sh", import.meta.url), join(dir, "deploy.sh"));
  writeFileSync(join(dir, ".env"), "X=1\n");
  writeFileSync(join(dir, "docker-compose.yml"), "services: {}\n");
  writeFileSync(join(dir, "release.env"), release);
  if (previous !== null) writeFileSync(join(dir, "previous.env"), previous);
  writeFileSync(
    join(dir, "backup-and-drill.sh"),
    `#!/usr/bin/env bash\necho backup-and-drill >> "${dir}/calls"\nexit ${backupExit}\n`,
  );
  writeFileSync(
    join(dir, "offsite-upload.sh"),
    `#!/usr/bin/env bash\necho offsite >> "${dir}/calls"\nexit ${uploadExit}\n`,
  );
  const project = env.COMPOSE_PROJECT_NAME ?? "ledgerline";
  writeFileSync(
    join(bin, "docker"),
    `#!/usr/bin/env bash
case "$*" in
  "volume ls"*)
    ${dockerError ? "echo 'Cannot connect to the Docker daemon' >&2; exit 1" : ":"}
    case "$*" in *'name=^${project}_db$'*) ${volume ? `echo ${project}_db` : ":"} ;; esac ;;
  *" ps -a -q db"*) ${container ? "echo db-container" : ":"} ;;
  *" up -d --wait --wait-timeout 120 db") echo db-start >> "${dir}/calls"; exit ${dbStartExit} ;;
  *) echo "docker $*" >> "${dir}/calls" ;;
esac
`,
  );
  writeFileSync(
    join(bin, "curl"),
    `#!/usr/bin/env bash\necho "curl $*" >> "${dir}/calls"\nexit ${curlExit}\n`,
  );
  for (const file of [
    join(bin, "docker"),
    join(bin, "curl"),
    join(dir, "backup-and-drill.sh"),
    join(dir, "offsite-upload.sh"),
  ])
    chmodSync(file, 0o755);
  const result = spawnSync("bash", ["deploy.sh", "v9.9.9"], {
    cwd: dir,
    env: {
      ...process.env,
      LEDGERLINE_DIR: dir,
      IMAGE_REPOSITORY: repository,
      PATH: `${bin}:${process.env.PATH}`,
      ...env,
    },
    encoding: "utf8",
  });
  const read = (name) =>
    existsSync(join(dir, name)) ? readFileSync(join(dir, name), "utf8") : null;
  return {
    result,
    calls: read("calls") ?? "",
    release: read("release.env"),
    previous: read("previous.env"),
  };
}

test("a failed pre-deploy backup or drill stops the deploy before anything changes", {
  skip,
}, () => {
  const { result, calls, release } = run({ backupExit: 1 });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /Pre-deploy backup failed/);
  assert.equal(release, oldRelease);
  assert.doesNotMatch(calls, /pull|up -d --wait --wait-timeout 180/);
});
test("a proven backup runs before the new images are pulled and started", {
  skip,
}, () => {
  const { result, calls, release } = run({});
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(release, /ghcr\.io\/example-owner\/ledgerline-api:v9\.9\.9/);
  assert.match(release, /ghcr\.io\/example-owner\/ledgerline-web:v9\.9\.9/);
  assert.match(calls, /^backup-and-drill$/m);
  assert.ok(calls.indexOf("backup-and-drill") < calls.indexOf(" pull"), calls);
  assert.ok(
    calls.indexOf(" pull") < calls.indexOf("--wait-timeout 180"),
    calls,
  );
});
test("an existing database volume means the backup is required, even when the container is stopped", {
  skip,
}, () => {
  const { result, calls } = run({ container: true });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(calls, /^db-start$/m);
  assert.ok(calls.indexOf("db-start") < calls.indexOf("backup-and-drill"));
});
test("a stopped database that cannot be started stops the deploy", {
  skip,
}, () => {
  const { result, calls, release } = run({ dbStartExit: 1 });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /Could not start the database/);
  assert.doesNotMatch(calls, /^backup-and-drill$/m);
  assert.doesNotMatch(calls, /pull/);
  assert.equal(release, oldRelease);
});
test("without a database volume or container it is a fresh install and skips the backup", {
  skip,
}, () => {
  const { result, calls } = run({
    volume: false,
    container: false,
    backupExit: 1,
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /skipping the pre-deploy backup/);
  assert.doesNotMatch(calls, /^backup-and-drill$/m);
  assert.doesNotMatch(calls, /^db-start$/m);
});
test("a database container without the expected volume stops the deploy instead of skipping the backup", {
  skip,
}, () => {
  const { result, calls, release } = run({ volume: false, container: true });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /volume ledgerline_db was not found/);
  assert.equal(calls, "");
  assert.equal(release, oldRelease);
});
test("a Docker error while looking for the volume stops the deploy, never a fresh install", {
  skip,
}, () => {
  const { result, calls, release } = run({
    dockerError: true,
    volume: false,
    container: false,
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /Could not ask Docker for the database volume/);
  assert.doesNotMatch(result.stdout, /fresh install/);
  assert.equal(calls, "");
  assert.equal(release, oldRelease);
});
test("COMPOSE_PROJECT_NAME decides the volume name", { skip }, () => {
  const { result, calls } = run({ env: { COMPOSE_PROJECT_NAME: "other" } });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(calls, /^backup-and-drill$/m);
});
test("a deploy without IMAGE_REPOSITORY stops before touching anything", () => {
  const { result, calls, release } = run({ repository: "" });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /Set IMAGE_REPOSITORY/);
  assert.equal(calls, "");
  assert.equal(release, oldRelease);
});
test("the off-site copy runs after the proven backup and before the new images are pulled", {
  skip,
}, () => {
  const { result, calls } = run({});
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(calls, /^backup-and-drill$/m);
  assert.ok(
    calls.indexOf("backup-and-drill") < calls.indexOf("offsite"),
    calls,
  );
  assert.ok(calls.indexOf("offsite") < calls.indexOf(" pull"), calls);
});
test("a failed off-site copy only warns and never blocks the deploy", {
  skip,
}, () => {
  const { result, calls, release } = run({ uploadExit: 1 });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /off-site copy of the pre-deploy backup failed/);
  assert.match(release, /ledgerline-api:v9\.9\.9/);
  assert.match(calls, /--wait-timeout 180/);
});
test("no off-site upload happens when the backup itself failed", {
  skip,
}, () => {
  const { calls } = run({ backupExit: 1 });
  assert.doesNotMatch(calls, /^offsite$/m);
});
test("a new version keeps the running release as the rollback target", {
  skip,
}, () => {
  const { result, previous, release } = run({ previous: olderRelease });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(previous, oldRelease);
  assert.equal(release, newRelease("ghcr.io/example-owner/ledgerline"));
});
test("deploying the same version again keeps the older rollback target", {
  skip,
}, () => {
  const same = newRelease("ghcr.io/example-owner/ledgerline");
  const { result, previous, release } = run({
    release: same,
    previous: olderRelease,
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(previous, olderRelease);
  assert.equal(release, same);
});
test("the health check retries while the web container starts", {
  skip,
}, () => {
  const { result, calls } = run({});
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(calls, /curl .*--retry 5 .*--retry-connrefused/);
});
test("a health check that never passes puts the release that was running back", {
  skip,
}, () => {
  const { result, release } = run({ curlExit: 22, previous: olderRelease });
  assert.equal(result.status, 1);
  assert.equal(release, oldRelease);
});
