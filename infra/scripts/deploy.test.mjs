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

// Run deploy.sh against stub docker/curl/backup so no real service is touched.
function run({
  dbRunning,
  backupExit,
  repository = "ghcr.io/example-owner/ledgerline",
}) {
  const dir = mkdtempSync(join(tmpdir(), "deploy-test-"));
  const bin = join(dir, "bin");
  mkdirSync(bin);
  copyFileSync(new URL("./deploy.sh", import.meta.url), join(dir, "deploy.sh"));
  writeFileSync(join(dir, ".env"), "X=1\n");
  writeFileSync(join(dir, "docker-compose.yml"), "services: {}\n");
  writeFileSync(
    join(dir, "release.env"),
    "API_IMAGE=old-api\nWEB_IMAGE=old-web\n",
  );
  writeFileSync(
    join(dir, "backup.sh"),
    `#!/usr/bin/env bash\necho backup >> "${dir}/calls"\nexit ${backupExit}\n`,
  );
  writeFileSync(
    join(bin, "docker"),
    `#!/usr/bin/env bash
case "$*" in
  *" ps -q db"*) ${dbRunning ? "echo db-container" : ":"} ;;
  *) echo "docker $*" >> "${dir}/calls" ;;
esac
`,
  );
  writeFileSync(join(bin, "curl"), "#!/usr/bin/env bash\nexit 0\n");
  for (const file of [
    join(bin, "docker"),
    join(bin, "curl"),
    join(dir, "backup.sh"),
  ])
    chmodSync(file, 0o755);
  const result = spawnSync("bash", ["deploy.sh", "v9.9.9"], {
    cwd: dir,
    env: {
      ...process.env,
      LEDGERLINE_DIR: dir,
      IMAGE_REPOSITORY: repository,
      PATH: `${bin}:${process.env.PATH}`,
    },
    encoding: "utf8",
  });
  const calls = existsSync(join(dir, "calls"))
    ? readFileSync(join(dir, "calls"), "utf8")
    : "";
  return {
    result,
    calls,
    release: readFileSync(join(dir, "release.env"), "utf8"),
  };
}

test("a failed pre-deploy backup stops the deploy before anything changes", {
  skip,
}, () => {
  const { result, calls, release } = run({ dbRunning: true, backupExit: 1 });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /Pre-deploy backup failed/);
  assert.equal(release, "API_IMAGE=old-api\nWEB_IMAGE=old-web\n");
  assert.doesNotMatch(calls, /docker compose.* up /);
});
test("a successful backup runs before the new images are started", {
  skip,
}, () => {
  const { result, calls, release } = run({ dbRunning: true, backupExit: 0 });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(release, /ghcr\.io\/example-owner\/ledgerline-api:v9\.9\.9/);
  assert.match(release, /ghcr\.io\/example-owner\/ledgerline-web:v9\.9\.9/);
  assert.ok(calls.indexOf("backup") < calls.indexOf("up -d"), calls);
});
test("a fresh install without a database skips the backup", { skip }, () => {
  const { result, calls } = run({ dbRunning: false, backupExit: 1 });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /skipping the pre-deploy backup/);
  assert.doesNotMatch(calls, /^backup$/m);
});
test("a deploy without IMAGE_REPOSITORY stops before touching anything", () => {
  const { result, calls, release } = run({
    dbRunning: true,
    backupExit: 0,
    repository: "",
  });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /Set IMAGE_REPOSITORY/);
  assert.equal(calls, "");
  assert.equal(release, "API_IMAGE=old-api\nWEB_IMAGE=old-web\n");
});
