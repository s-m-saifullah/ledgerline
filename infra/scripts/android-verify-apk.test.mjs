import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const script = "infra/scripts/android-verify-apk.sh";
const digest = "ab".repeat(32);

/** Runs the script against a stand-in apksigner that prints `body` (or fails) and returns its result. */
function run(body, { expected = "", fail = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "verify-apk-"));
  const apksigner = join(dir, "apksigner");
  writeFileSync(
    apksigner,
    `#!/bin/bash\ncat <<'OUT'\n${body}\nOUT\n${fail ? "exit 1" : ""}\n`,
  );
  chmodSync(apksigner, 0o755);
  const apk = join(dir, "app-release.apk");
  writeFileSync(apk, "not a real apk");
  const output = join(dir, "github-output");
  writeFileSync(output, "");
  const result = spawnSync("bash", [script, apk, expected], {
    encoding: "utf8",
    env: { ...process.env, APKSIGNER: apksigner, GITHUB_OUTPUT: output },
  });
  return {
    ...result,
    output: spawnSync("cat", [output], { encoding: "utf8" }).stdout,
  };
}

const classic = `Signer #1 certificate DN: CN=Secret Person\nSigner #1 certificate SHA-256 digest: ${digest}`;
const ranged = `Signer (minSdkVersion=30, maxSdkVersion=2147483647) certificate DN: CN=Secret Person\nSigner (minSdkVersion=30, maxSdkVersion=2147483647) certificate SHA-256 digest: ${digest.toUpperCase()}`;

test("prints the digest and writes it to GITHUB_OUTPUT, never the certificate's name", () => {
  for (const body of [classic, ranged]) {
    const result = run(body);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(
      result.stdout,
      new RegExp(`Signing certificate SHA-256: ${digest}`),
    );
    assert.equal(result.output, `cert=${digest}\n`);
    assert.doesNotMatch(result.stdout + result.stderr, /Secret Person/);
  }
});

test("an expected digest is compared without colons and case", () => {
  const colons = digest.toUpperCase().replace(/(..)(?!$)/g, "$1:");
  assert.equal(run(classic, { expected: colons }).status, 0);
  assert.equal(run(classic, { expected: digest }).status, 0);
  const wrong = run(classic, { expected: "00".repeat(32) });
  assert.equal(wrong.status, 1);
  assert.match(wrong.stdout, /different key/);
  assert.equal(wrong.output, "");
});

test("output with no digest fails and shows labels only, never values", () => {
  const result = run(
    "Verifies\nV2 Signer\nNumber of signers: 1\nSigner #1 certificate DN: CN=Secret Person",
  );
  assert.equal(result.status, 1);
  assert.match(result.stdout, /Could not read the signing certificate/);
  assert.match(result.stdout, /Number of signers/);
  assert.doesNotMatch(result.stdout + result.stderr, /Secret Person/);
});

test("a signature that does not verify fails", () => {
  const result = run("DOES NOT VERIFY", { fail: true });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /does not verify/);
  assert.doesNotMatch(result.stdout, /DOES NOT VERIFY/);
});
