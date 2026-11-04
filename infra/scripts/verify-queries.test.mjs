import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

// The restore drill's checks (ADR 0048 added two): each is one single-line statement, and the ones for tables or
// columns a dump may predate are guarded, so an older dump still passes.
const script = new URL("./verify-queries.sh", import.meta.url).pathname;
function run(body) {
  const result = spawnSync("bash", ["-c", `source "${script}"; ${body}`], {
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trimEnd();
}
// bash prints the names one per line; the expansion is built here so the linter does not read it as a template.
const expand = ["$", "{VERIFY_INVARIANTS[@]}"].join("");
const invariants = () => run(`printf '%s\\n' "${expand}"`).split("\n");

test("the account invariants are part of the drill", () => {
  const names = invariants();
  assert.ok(names.includes("account_flags"));
  assert.ok(names.includes("user_ledgers"));
  assert.ok(names.includes("deleted_people"));
});

test("every invariant is one single-line statement that counts offenders", () => {
  for (const name of invariants()) {
    const sql = run(`verify_sql ${name}`);
    assert.ok(sql.startsWith("SELECT"), name);
    assert.ok(!sql.includes("\n"), `${name} spans lines`);
    const requires = run(`verify_requires ${name}`);
    assert.ok(requires.startsWith("SELECT"), name);
    assert.notEqual(requires, "SELECT false", `${name} has no guard`);
  }
});

test("the account invariants wait for the columns of migration 0028, so an older dump skips them", () => {
  for (const name of ["account_flags", "user_ledgers", "deleted_people"]) {
    const requires = run(`verify_requires ${name}`);
    assert.match(requires, /column_name='must_change_password'/, name);
    assert.match(requires, /to_regclass\('public\.auth_accounts'\)/, name);
    assert.match(requires, /to_regclass\('public\.ledger_members'\)/, name);
  }
});

test("the account invariants look at live people only and at live sign-ins and ledgers", () => {
  const flags = run("verify_sql account_flags");
  assert.match(flags, /u\.deleted_at IS NULL AND u\.must_change_password/);
  assert.match(flags, /a\.provider_id='credential' AND a\.deleted_at IS NULL/);
  assert.match(flags, /coalesce\(a\.password,''\) <> ''/);
  const ledgers = run("verify_sql user_ledgers");
  assert.match(ledgers, /u\.deleted_at IS NULL AND NOT EXISTS/);
  assert.match(
    ledgers,
    /m\.role='owner' AND m\.deleted_at IS NULL AND l\.deleted_at IS NULL/,
  );
});

test("the deleted-people invariant looks for a live sign-in, a live membership and a live ledger only they were in", () => {
  const query = run("verify_sql deleted_people");
  assert.match(query, /u\.deleted_at IS NOT NULL/);
  assert.match(query, /a\.user_id=u\.id AND a\.deleted_at IS NULL/);
  assert.match(query, /m\.user_id=u\.id AND m\.deleted_at IS NULL/);
  assert.match(
    query,
    /l\.deleted_at IS NULL AND NOT EXISTS .* o\.user_id<>u\.id AND o\.deleted_at IS NULL/,
  );
});

test("the cleared-ledger invariant is part of the drill and waits for the column of migration 0029", () => {
  assert.ok(invariants().includes("cleared_ledgers"));
  const requires = run("verify_requires cleared_ledgers");
  assert.match(requires, /column_name='cleared_at'/);
  assert.match(requires, /table_name='ledgers'/);
});

test("the cleared-ledger invariant looks for a live row older than the clear, in every kind of data", () => {
  const query = run("verify_sql cleared_ledgers");
  assert.match(query, /l\.cleared_at IS NOT NULL/);
  for (const table of [
    "transactions",
    "accounts",
    "categories",
    "tags",
    "contacts",
    "receivables",
    "receivable_payments",
    "budgets",
    "recurring_rules",
    "currencies",
    "exchange_rates",
    "import_batches",
  ])
    assert.match(
      query,
      new RegExp(
        `FROM ${table} x WHERE x\\.ledger_id=l\\.id AND x\\.deleted_at IS NULL AND x\\.created_at<l\\.cleared_at`,
      ),
      table,
    );
});
