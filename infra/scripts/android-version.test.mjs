import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import test from "node:test";
import { parseAndroidTag } from "./android-version.mjs";

test("the tag gives the version name and code X*10000 + Y*100 + Z", () => {
  assert.deepEqual(parseAndroidTag("android-v1.0.0"), {
    name: "1.0.0",
    code: 10000,
  });
  assert.deepEqual(parseAndroidTag("android-v0.1.0"), {
    name: "0.1.0",
    code: 100,
  });
  assert.deepEqual(parseAndroidTag("android-v1.2.3"), {
    name: "1.2.3",
    code: 10203,
  });
  assert.deepEqual(parseAndroidTag("android-v12.34.56"), {
    name: "12.34.56",
    code: 123456,
  });
  assert.equal(parseAndroidTag("android-v999.99.99").code, 9999999);
});

test("a later release always has a higher code", () => {
  const order = ["0.1.0", "0.1.9", "0.2.0", "0.99.99", "1.0.0", "1.0.1"].map(
    (v) => parseAndroidTag(`android-v${v}`).code,
  );
  assert.deepEqual(
    order,
    [...order].sort((a, b) => a - b),
  );
  assert.equal(new Set(order).size, order.length);
});

test("anything but android-vX.Y.Z is refused", () => {
  for (const tag of [
    "v1.2.3",
    "android-1.2.3",
    "android-v1.2",
    "android-v1.2.3.4",
    "android-v1.2.3-rc1",
    "android-v01.2.3",
    "android-v1.100.0",
    "android-v1.0.100",
    "android-v1000.0.0",
    "android-v1.-2.3",
    "refs/tags/android-v1.2.3",
    "android-v1.2.3\nextra",
    "",
    undefined,
  ]) {
    assert.throws(
      () => parseAndroidTag(tag),
      /not an Android release tag/,
      String(tag),
    );
  }
});

test("the command line prints GITHUB_OUTPUT lines and fails on a bad tag", () => {
  const ok = execFileSync(
    "node",
    ["infra/scripts/android-version.mjs", "android-v1.2.3"],
    { encoding: "utf8" },
  );
  assert.equal(ok, "name=1.2.3\ncode=10203\n");
  const bad = spawnSync(
    "node",
    ["infra/scripts/android-version.mjs", "v1.2.3"],
    { encoding: "utf8" },
  );
  assert.notEqual(bad.status, 0);
  assert.match(bad.stderr, /not an Android release tag/);
  assert.equal(bad.stdout, "");
});
