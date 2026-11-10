import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";

// The off-site tool image is built only when its tag is missing (offsite-upload.sh, offsite-restore.sh), so the tag
// is what makes a server rebuild after a version change. A Dockerfile bumped without its tag leaves the old tool
// running under the old name, or builds the new one under a name that lies. The tag must follow the Dockerfile.
const read = (path) =>
  readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

const dockerfile = read("infra/docker/offsite.Dockerfile");
const rclone = dockerfile.match(/^FROM rclone\/rclone:(\d+\.\d+\.\d+)$/m)?.[1];
const age = dockerfile.match(/age=~(\d+\.\d+)/)?.[1];
const expected = `ledgerline-offsite:rclone${rclone}-age${age}`;

const scripts = ["offsite-upload.sh", "offsite-restore.sh"]
  .map((name) => `infra/scripts/${name}`)
  .concat(
    readdirSync(new URL("./drill-tests/", import.meta.url))
      .filter((name) => name.endsWith(".sh"))
      .map((name) => `infra/scripts/drill-tests/${name}`),
  );

test("the Dockerfile pins rclone and age versions the tag can name", () => {
  assert.ok(
    rclone,
    "offsite.Dockerfile has no `FROM rclone/rclone:X.Y.Z` line",
  );
  assert.ok(age, "offsite.Dockerfile has no `age=~X.Y` pin");
});

test("every script that names the tool image uses the Dockerfile's versions", () => {
  let found = 0;
  for (const file of scripts) {
    const tags = read(file).match(/ledgerline-offsite:[\w.-]+/g) ?? [];
    for (const tag of tags) {
      found += 1;
      assert.equal(
        tag,
        expected,
        `${file} names ${tag}; the Dockerfile says ${expected}`,
      );
    }
  }
  assert.ok(
    found >= 4,
    `expected the tag in at least four places, found ${found}`,
  );
});

test("the tag is built from the Dockerfile in both scripts that build it", () => {
  for (const file of [
    "infra/scripts/offsite-upload.sh",
    "infra/scripts/offsite-restore.sh",
  ]) {
    const text = read(file);
    assert.match(
      text,
      /docker image inspect "\$tool_image"/,
      `${file} no longer checks the tag first`,
    );
    assert.match(
      text,
      /docker build -q -t "\$tool_image"/,
      `${file} no longer builds the tag`,
    );
  }
});
