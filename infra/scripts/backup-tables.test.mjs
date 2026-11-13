import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

// The backup fingerprints every table and the restore drill checks them. A table nobody listed is a table whose
// loss or damage no drill would notice, so the lists are tied to the schema here.
const read = (path) =>
  readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const schema = read("apps/api/src/db/schema.ts");
const backup = read("infra/scripts/backup.sh");
const drill = read("infra/scripts/restore-drill.sh");

const schemaTables = [...schema.matchAll(/pgTable\(\s*"([a-z_]+)"/g)].map(
  (match) => match[1],
);
const words = (text) => text.trim().split(/\s+/).filter(Boolean);
const backupTables = words(
  backup.match(/^for table in ([a-z_ ]+); do$/m)?.[1] ?? "",
);
const drillAllowed = words(
  (drill.match(/case "\$table" in ([a-z_|]+)\)/)?.[1] ?? "").replaceAll(
    "|",
    " ",
  ),
);
const drillRequired = words(
  drill.match(/^for table in ([a-z_ ]+); do$/m)?.[1] ?? "",
);
// Added after backups already existed: an older dump has no line for them, so the drill must not demand one.
const optional = ["auth_accounts", "auth_sessions", "auth_verifications"];
const sorted = (list) => [...list].sort();

test("the lists were found", () => {
  assert.ok(schemaTables.length >= 24, "no tables found in the schema");
  assert.ok(backupTables.length >= 21, "no table list in backup.sh");
  assert.ok(drillAllowed.length >= 21, "no allowed list in restore-drill.sh");
  assert.ok(drillRequired.length >= 21, "no required list in restore-drill.sh");
});

test("backup.sh fingerprints every table the schema defines", () => {
  assert.deepEqual(sorted(backupTables), sorted(schemaTables));
});

test("no table is listed twice", () => {
  for (const list of [backupTables, drillAllowed, drillRequired])
    assert.equal(new Set(list).size, list.length);
});

test("the drill accepts a manifest line for every table the backup writes", () => {
  assert.deepEqual(sorted(drillAllowed), sorted(backupTables));
});

test("the drill demands every table except those added later, so older dumps still pass", () => {
  assert.deepEqual(
    sorted(drillRequired),
    sorted(backupTables.filter((table) => !optional.includes(table))),
  );
});

test("the tables added later are the password, session and verification tables", () => {
  for (const table of optional) assert.ok(backupTables.includes(table), table);
});
