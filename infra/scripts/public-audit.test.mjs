import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { auditPath, auditText, auditTree } from "./public-audit.mjs";

const rules = (path, text) => auditText(path, text).map((item) => item.rule);

test("detects keys, tokens, private addresses and real emails without echoing them", () => {
  const samples = {
    "private-key": `-----${"BEGIN"} OPENSSH PRIVATE KEY-----`,
    "github-token": `token ghp_${"a".repeat(36)}`,
    "aws-access-key": `${"AKIA"}ABCDEFGHIJKLMNOP`,
    "slack-token": `${"xox"}b-1234567890-abcdef`,
    "private-ip": `host ${["192", "168", "1", "20"].join(".")}`,
    "email-address": `contact someone@${"company"}.org`,
  };
  for (const [rule, text] of Object.entries(samples)) {
    const found = auditText("file.txt", text);
    assert.deepEqual(
      found.map((item) => item.rule),
      [rule],
    );
    assert.deepEqual(Object.keys(found[0]).sort(), ["file", "line", "rule"]);
  }
  assert.deepEqual(
    rules(
      "a.txt",
      `${["172", "20", "0", "5"].join(".")} and ${["10", "0", "0", "1"].join(".")}`,
    ),
    ["private-ip"],
  );
});

test("allows placeholders, localhost addresses, versions and asset names", () => {
  for (const text of [
    "owner@example.com",
    "a@b.example.org",
    "ci@example.invalid",
    "127.0.0.1 and 0.0.0.0",
    "import x from '@ledgerline/shared'",
    "icon@2x.png",
    "package@1.2.3-beta.4",
    "1234+name@users.noreply.github.com",
  ])
    assert.deepEqual(rules("a.txt", text), [], text);
  assert.deepEqual(rules("pnpm-lock.yaml", "foo@1.0.0-rc.alpha"), []);
});

test("flags env files, key files and private folders by name only", () => {
  for (const path of [
    ".env",
    "apps/api/.env.local",
    "id_ed25519",
    "backups/x.dump",
    "deploy/key.pem",
    ".private/notes.txt",
  ])
    assert.equal(auditPath(path).length, 1, path);
  for (const path of [".env.example", "docs/key-concepts.md"])
    assert.equal(auditPath(path).length, 0, path);
});

test("audits a directory tree and skips binary files", () => {
  const dir = mkdtempSync(join(tmpdir(), "audit-"));
  mkdirSync(join(dir, "docs"));
  writeFileSync(
    join(dir, "docs", "a.md"),
    `clean\nreach me at real@${"company"}.org\n`,
  );
  writeFileSync(join(dir, "logo.bin"), Buffer.from([0, 1, 2, 64, 99]));
  const found = auditTree(dir);
  assert.deepEqual(found, [
    { file: "docs/a.md", line: 2, rule: "email-address" },
  ]);
});

test("skips node_modules and reports symbolic links without following them", () => {
  const dir = mkdtempSync(join(tmpdir(), "audit-"));
  mkdirSync(join(dir, "node_modules"));
  writeFileSync(join(dir, "node_modules", "x.txt"), `a@${"company"}.org\n`);
  symlinkSync(tmpdir(), join(dir, "link"));
  assert.deepEqual(auditTree(dir), [
    { file: "link", line: 0, rule: "symbolic-link" },
  ]);
});
