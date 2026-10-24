import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  checkAll,
  marker,
  maxNotesLength,
  readNotes,
  releaseBody,
  validateNotes,
} from "./android-release-notes.mjs";

const apk = "a".repeat(64);
const cert = "B".repeat(64);

function folderWith(files) {
  const folder = mkdtempSync(join(tmpdir(), "notes-"));
  for (const [name, text] of Object.entries(files))
    writeFileSync(join(folder, name), text);
  return folder;
}

test("notes are trimmed and must not be empty", () => {
  assert.equal(validateNotes("\n  Filters stay.  \r\n"), "Filters stay.");
  assert.throws(() => validateNotes(" \n\t"), /empty/);
});

test("notes may not run past the limit the update screen shows", () => {
  assert.equal(
    validateNotes("x".repeat(maxNotesLength)).length,
    maxNotesLength,
  );
  assert.throws(
    () => validateNotes("x".repeat(maxNotesLength + 1)),
    /most the update screen shows/,
  );
});

test("a line of only --- is refused because it would end the notes early", () => {
  assert.throws(() => validateNotes("One\n---\nTwo"), /separates/);
  assert.throws(() => validateNotes("One\n  ---  \nTwo"), /separates/);
  assert.equal(validateNotes("A --- B\n----"), "A --- B\n----");
});

test("the body is the notes, the marker, then the fingerprints in lower case", () => {
  const body = releaseBody({
    version: "0.1.3",
    notes: "New things.",
    apkSha256: apk,
    certSha256: cert,
  });
  const lines = body.split("\n");
  assert.equal(lines[0], "New things.");
  assert.equal(lines.indexOf(marker), 2);
  assert.equal(lines.filter((line) => line === marker).length, 1);
  assert.ok(body.includes(`APK SHA-256: \`${apk}\``));
  assert.ok(body.includes(`certificate SHA-256: \`${"b".repeat(64)}\``));
  assert.ok(body.endsWith("\n") && !body.endsWith("\n\n"));
});

test("a fingerprint that is not 64 hex digits is refused", () => {
  assert.throws(
    () =>
      releaseBody({
        version: "1.0.0",
        notes: "n",
        apkSha256: "abc",
        certSha256: cert,
      }),
    /APK/,
  );
  assert.throws(
    () =>
      releaseBody({
        version: "1.0.0",
        notes: "n",
        apkSha256: apk,
        certSha256: "",
      }),
    /certificate/,
  );
});

test("a missing notes file names the file to add", () => {
  const folder = folderWith({});
  assert.throws(
    () => readNotes("0.1.3", folder),
    /add apps\/android\/release-notes\/0\.1\.3\.md/,
  );
  rmSync(folder, { recursive: true });
});

test("a version that is not X.Y.Z cannot reach another path", () => {
  const folder = folderWith({});
  for (const bad of ["../x", "0.1", "01.2.3", "", undefined]) {
    assert.throws(() => readNotes(bad, folder), /not a version/);
  }
  rmSync(folder, { recursive: true });
});

test("check-all lists a badly named file and an empty one", () => {
  const folder = folderWith({
    "0.1.3.md": "Fine.\n",
    "notes.md": "x",
    "0.1.4.md": "\n",
  });
  const problems = checkAll(folder);
  assert.equal(problems.length, 2);
  assert.ok(
    problems.some((p) => p.startsWith("0.1.4.md") || p.includes("0.1.4.md")),
  );
  assert.ok(problems.some((p) => p.startsWith("notes.md")));
  rmSync(folder, { recursive: true });
  assert.deepEqual(checkAll(join(tmpdir(), "no-such-notes-folder")), []);
});

test("the command line prints the body and fails with a message", () => {
  const script = new URL("./android-release-notes.mjs", import.meta.url)
    .pathname;
  const missing = spawnSync("node", [script, "check", "9.9.9"], {
    encoding: "utf8",
  });
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /No release notes/);
  const usage = spawnSync("node", [script], { encoding: "utf8" });
  assert.equal(usage.status, 1);
  assert.match(usage.stderr, /Usage/);
});
