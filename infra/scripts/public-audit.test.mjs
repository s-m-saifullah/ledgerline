import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  symlinkSync,
  truncateSync,
  writeFileSync,
} from "node:fs";
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
  writeFileSync(join(dir, "logo.png"), Buffer.from([0, 1, 2, 64, 99]));
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

test("flags shared-address-space (CGNAT, VPN) addresses but not their neighbours", () => {
  const at = (...parts) => `host ${parts.join(".")}`;
  for (const text of [
    at(100, 64, 0, 1),
    at(100, 100, 10, 20),
    at(100, 127, 255, 254),
  ])
    assert.deepEqual(rules("a.txt", text), ["private-ip"], text);
  for (const text of [
    at(100, 63, 255, 255),
    at(100, 128, 0, 1),
    at(100, 6, 4, 1),
  ])
    assert.deepEqual(rules("a.txt", text), [], text);
});

test("flags private and link-local IPv6 addresses but not public, documentation or loopback ones", () => {
  const v6 = (first, rest) => `host ${first}:${rest}`;
  for (const text of [
    v6("fd12", "3456:789a::1"),
    v6("fc00", ":1"),
    v6("fe80", ":1:2:3:4"),
    v6("FEB0", ":ab::5"),
  ])
    assert.deepEqual(rules("a.txt", text), ["private-ip"], text);
  for (const text of [
    "host 2001:db8::1",
    "host ::1",
    "time 12:30:45",
    "a fd12 word and fe80 alone",
    "colour fc:80:00:11:22:33",
  ])
    assert.deepEqual(rules("a.txt", text), [], text);
});

test("flags age secret keys without echoing them", () => {
  const key = `${"AGE-SECRET"}-KEY-1${"Q".repeat(58)}`;
  assert.deepEqual(rules("a.txt", `identity ${key}`), ["private-key"]);
  assert.deepEqual(
    rules("a.txt", "AGE-SECRET-KEY-1 is described in the docs"),
    [],
  );
});

test("flags keystore files by name only", () => {
  for (const path of [
    "release.jks",
    "apps/android/signing.keystore",
    "a/B.JKS",
  ])
    assert.equal(auditPath(path).length, 1, path);
  for (const path of [
    "docs/keystore-setup.md",
    "apps/android/keystore-notes.txt",
  ])
    assert.equal(auditPath(path).length, 0, path);
});

test("reports files it cannot read: unknown binaries and files over 5 MB", () => {
  const dir = mkdtempSync(join(tmpdir(), "audit-"));
  writeFileSync(join(dir, "app.apk"), Buffer.from([0, 1, 2, 3]));
  writeFileSync(join(dir, "data.sqlite"), Buffer.from([0, 9, 9, 9]));
  for (const allowed of [
    "a.png",
    "b.ttf",
    "c.woff2",
    "d.ico",
    "gradle-wrapper.jar",
  ])
    writeFileSync(join(dir, allowed), Buffer.from([0, 1, 2, 3]));
  writeFileSync(join(dir, "big.txt"), "");
  truncateSync(join(dir, "big.txt"), 5_000_001);
  assert.deepEqual(auditTree(dir), [
    { file: "app.apk", line: 0, rule: "unscanned-binary" },
    { file: "big.txt", line: 0, rule: "large-file" },
    { file: "data.sqlite", line: 0, rule: "unscanned-binary" },
  ]);
});

test("reports one finding per rule on a line, however many addresses it holds", () => {
  const line = `${["192", "168", "1", "2"].join(".")} then ${["fe80", "1"].join("::")}`;
  assert.deepEqual(rules("a.txt", line), ["private-ip"]);
});
