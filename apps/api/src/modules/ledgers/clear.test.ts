import {
  managedUserListSchema,
  managedUserSchema,
  newId,
  syncResponseSchema,
} from "@ledgerline/shared";
import { and, eq, sql } from "drizzle-orm";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { buildApp } from "../../app";
import { createDatabase } from "../../db/client";
import { applyMigrations } from "../../db/migrate";
import { ledgerMembers, ledgers, user } from "../../db/schema";
import { requireTestDatabase, testConfig } from "../../test-support/harness";
import { ledgerFixture, type Person } from "../../test-support/ledger-fixture";
import { createAccount } from "../auth/accounts";
import { PURGED_TABLES, RETENTION_DAYS } from "../users/lifecycle";
import {
  CLEARED_TABLES,
  clearLedgerRows,
  purgeClearedLedgers,
  restoreClearedRows,
} from "./clear";

// ADR 0049, slice C: a person clears their own ledger and the admin clears a person's; either can be undone for
// 30 days (one undo slot, and only while the ledger is empty); the hourly job removes a batch for good after that.
const url = requireTestDatabase("Clear-ledger tests");
const config = testConfig(url, "clr");
const { db, pool } = createDatabase(url);
const app = await buildApp(db, config);
const mailbox = (name: string) => `clr-${name}@example.com`;
const temporary = "temporary-pass-1234";
const own = "my-own-password-5678";
const fx = ledgerFixture({
  app,
  config,
  db,
  mailbox,
  emailLike: "clr-%@example.com",
});
const { signIn, send, seed, fingerprint, wipe } = fx;
const DAY = 24 * 60 * 60 * 1000;
const log = () => ({ info: vi.fn(), error: vi.fn() });
let admin: { id: string; ledgerId: string; cookie: string };

/** A person added by the admin through the real route, who has chosen their own password; optionally with data. */
async function addPerson(name: string, withData = false): Promise<Person> {
  const added = await send("POST", "/api/v1/users", admin.cookie, {
    name: `Person ${name}`,
    email: mailbox(name),
    temporaryPassword: temporary,
  });
  expect(added.statusCode, added.body).toBe(201);
  const created = managedUserSchema.parse(added.json());
  const first = await signIn(mailbox(name), temporary);
  const changed = await send("POST", "/api/v1/me/password", first, {
    currentPassword: temporary,
    newPassword: own,
  });
  expect(changed.statusCode, changed.body).toBe(204);
  const [member] = await db
    .select({ ledgerId: ledgerMembers.ledgerId })
    .from(ledgerMembers)
    .where(eq(ledgerMembers.userId, created.id));
  const person: Person = {
    name,
    id: created.id,
    ledgerId: member?.ledgerId as string,
    cookie: first,
    marker: `ClrMarker${name}`,
    ids: {},
    secrets: [],
  };
  if (withData) {
    await seed(person);
    // A recurring run is made by the hourly job, not by a route: one row, so every table holds data.
    await db.execute(
      sql`INSERT INTO recurring_runs (id, ledger_id, rule_id, occurrence_date, status) VALUES (${newId()}, ${person.ledgerId}, ${person.ids.ruleId}, '2026-11-01', 'skipped')`,
    );
  }
  return person;
}

type Call = { key?: string; body?: unknown; cookie?: string; origin?: string };
function post(path: string, cookie: string, call: Call = {}) {
  return app.inject({
    method: "POST",
    url: path,
    headers: {
      origin: call.origin ?? config.APP_URL,
      cookie,
      "idempotency-key": call.key ?? newId(),
    },
    ...(call.body === undefined ? {} : { payload: call.body as object }),
  });
}
const clear = (person: { ledgerId: string; cookie: string }, call: Call = {}) =>
  post(
    `/api/v1/ledgers/${person.ledgerId}/clear`,
    call.cookie ?? person.cookie,
    { body: { confirm: "CLEAR" }, ...call },
  );
const restore = (
  person: { ledgerId: string; cookie: string },
  call: Call = {},
) =>
  post(
    `/api/v1/ledgers/${person.ledgerId}/restore`,
    call.cookie ?? person.cookie,
    call,
  );
const adminClear = (id: string, cookie = admin.cookie) =>
  send("POST", `/api/v1/users/${id}/ledger/clear`, cookie);
const adminRestore = (id: string, cookie = admin.cookie) =>
  send("POST", `/api/v1/users/${id}/ledger/restore`, cookie);

// ---- looking at the database -------------------------------------------------------------------------------
/** Every table that holds a ledger id, as the database lists them. */
async function ledgerTables() {
  const found = await db.execute<{ table_name: string }>(
    sql`SELECT table_name FROM information_schema.columns WHERE table_schema='public' AND column_name='ledger_id' ORDER BY table_name`,
  );
  return found.rows.map((row) => row.table_name);
}
const moneyTables = async () =>
  (await ledgerTables()).filter((name) => name !== "ledger_members");
async function versionedTables() {
  const found = await db.execute<{ table_name: string }>(
    sql`SELECT table_name FROM information_schema.columns WHERE table_schema='public' AND column_name='version' AND table_name <> 'ledgers' ORDER BY table_name`,
  );
  return found.rows.map((row) => row.table_name);
}
async function count(query: ReturnType<typeof sql>) {
  return (await db.execute<{ n: number }>(query)).rows[0]?.n ?? 0;
}
/** Live rows per money table. */
async function liveCounts(ledgerId: string) {
  const result: Record<string, number> = {};
  for (const name of await moneyTables())
    result[name] = await count(
      sql`SELECT count(*)::int AS n FROM ${sql.identifier(name)} WHERE ledger_id = ${ledgerId} AND deleted_at IS NULL`,
    );
  return result;
}
/** Rows per money table that carry exactly this deleted_at. */
async function stampedCounts(ledgerId: string, stamp: Date) {
  const result: Record<string, number> = {};
  for (const name of await moneyTables())
    result[name] = await count(
      sql`SELECT count(*)::int AS n FROM ${sql.identifier(name)} WHERE ledger_id = ${ledgerId} AND deleted_at = ${stamp.toISOString()}::timestamptz`,
    );
  return result;
}
const total = (counts: Record<string, number>, skip: string[] = []) =>
  Object.entries(counts)
    .filter(([name]) => !skip.includes(name))
    .reduce((sum, [, n]) => sum + n, 0);
/** Everything in every table of the ledger, live or not. */
async function allCounts(ledgerId: string) {
  const result: Record<string, number> = {};
  for (const name of await moneyTables())
    result[name] = await count(
      sql`SELECT count(*)::int AS n FROM ${sql.identifier(name)} WHERE ledger_id = ${ledgerId}`,
    );
  return result;
}
/** A fingerprint of the live rows' content, without what a clear and a restore move on purpose. */
async function liveContent(ledgerId: string, skip = ["write_receipts"]) {
  const result: Record<string, string> = {};
  for (const name of await moneyTables()) {
    if (skip.includes(name)) continue;
    const found = await db.execute<{ hash: string }>(
      sql`SELECT md5(coalesce(string_agg((to_jsonb(t) - 'version' - 'updated_at')::text, ',' ORDER BY t.id::text), '')) AS hash FROM ${sql.identifier(name)} t WHERE t.ledger_id = ${ledgerId} AND t.deleted_at IS NULL`,
    );
    result[name] = found.rows[0]?.hash ?? "";
  }
  return result;
}
/** The version of every row that is live now (a clear raises those and leaves the deleted ones alone). */
async function versions(ledgerId: string, liveOnly = true) {
  const result: Record<string, number> = {};
  for (const name of await versionedTables()) {
    const found = await db.execute<{ id: string; version: number }>(
      sql`SELECT id, version FROM ${sql.identifier(name)} WHERE ledger_id = ${ledgerId} AND (${liveOnly} = false OR deleted_at IS NULL)`,
    );
    for (const row of found.rows) result[`${name}/${row.id}`] = row.version;
  }
  return result;
}
async function ledgerState(id: string) {
  const iso = (column: string) =>
    sql.raw(
      `to_char(${column} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`,
    );
  const found = await db.execute<{
    cleared_at: string | null;
    version: number;
    deleted_at: string | null;
    name: string;
    base_currency: string;
  }>(
    sql`SELECT ${iso("cleared_at")} AS cleared_at, version, ${iso("deleted_at")} AS deleted_at, name, base_currency FROM ledgers WHERE id = ${id}`,
  );
  const row = found.rows[0] as NonNullable<(typeof found.rows)[number]>;
  return {
    ...row,
    cleared_at: row.cleared_at ? new Date(row.cleared_at) : null,
    deleted_at: row.deleted_at ? new Date(row.deleted_at) : null,
  };
}
const clearedAtOf = async (id: string) =>
  (await ledgerState(id)).cleared_at as Date;
/** Moves a clear (the batch, the moment recorded for it and everything deleted before it) to another moment. */
async function ageBatch(ledgerId: string, to: Date) {
  const from = await clearedAtOf(ledgerId);
  const tables = await moneyTables();
  // One transaction: the database checks a receivable and its payments when it commits.
  await db.transaction(async (tx) => {
    for (const name of tables)
      await tx.execute(
        sql`UPDATE ${sql.identifier(name)} SET deleted_at = deleted_at + (${to.toISOString()}::timestamptz - ${from.toISOString()}::timestamptz) WHERE ledger_id = ${ledgerId} AND deleted_at <= ${from.toISOString()}::timestamptz`,
      );
    await tx.execute(
      sql`UPDATE ledgers SET cleared_at = ${to.toISOString()}::timestamptz WHERE id = ${ledgerId}`,
    );
  });
}
/** A delete through the real route, as the person (it asks for the row's version). */
async function removeRow(
  person: { ledgerId: string; cookie: string },
  path: "transactions" | "accounts" | "tags",
  id: string | undefined,
) {
  if (!id) throw new Error("A row id is needed");
  const [row] = (
    await db.execute<{ version: number }>(
      sql`SELECT version FROM ${sql.identifier(path)} WHERE id = ${id}`,
    )
  ).rows;
  const response = await send(
    "DELETE",
    `/api/v1/ledgers/${person.ledgerId}/${path}/${id}`,
    person.cookie,
    { expectedVersion: row?.version },
  );
  expect(response.statusCode, `${path}: ${response.body}`).toBeLessThan(300);
}
const listAccounts = async (person: Person) =>
  (
    await send(
      "GET",
      `/api/v1/ledgers/${person.ledgerId}/accounts`,
      person.cookie,
    )
  ).json() as { items: { id: string }[] };

beforeAll(async () => {
  await applyMigrations(url);
  await wipe();
  await app.ready();
  const made = await db.transaction((tx) =>
    createAccount(tx, {
      email: mailbox("admin"),
      name: "admin",
      password: own,
      isAdmin: true,
    }),
  );
  admin = {
    id: made.userId,
    ledgerId: made.ledgerId,
    cookie: await signIn(mailbox("admin"), own),
  };
}, 120000);
afterAll(async () => {
  await wipe();
  await app.close();
  await pool.end();
});

describe("the tables a clear touches", () => {
  it("are every table that holds a ledger id except the memberships, the database's own list being the judge", async () => {
    const tables = await ledgerTables();
    expect([...CLEARED_TABLES].sort()).toEqual(
      tables.filter((name) => name !== "ledger_members"),
    );
    expect([...CLEARED_TABLES].sort()).toEqual(
      PURGED_TABLES.filter((name) => name !== "ledger_members").sort(),
    );
  });
  it("all carry the audit columns a clear stamps, and a version where the phone compares versions", async () => {
    for (const name of CLEARED_TABLES) {
      const found = await db.execute<{ column_name: string }>(
        sql`SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name = ${name}`,
      );
      const columns = found.rows.map((row) => row.column_name);
      expect(columns, name).toContain("deleted_at");
      expect(columns, name).toContain("updated_at");
    }
    // The four without a version are the ones the sync compares by `updated_at`.
    const withVersion = await versionedTables();
    const without = CLEARED_TABLES.filter(
      (name) => !withVersion.includes(name),
    );
    expect(without.sort()).toEqual([
      "receivable_events",
      "transaction_tags",
      "write_receipts",
    ]);
  });
});

describe("a person clearing their own ledger", () => {
  let ann: Person;
  let bob: Person;
  let before: Record<string, number>;
  let beforeVersions: Record<string, number>;
  let started: number;
  beforeAll(async () => {
    ann = await addPerson("own-ann", true);
    bob = await addPerson("own-bob", true);
    // A row deleted on its own, before the clear: it must stay deleted through a clear and a restore.
    await removeRow(ann, "transactions", ann.ids.transactionId);
    before = await allCounts(ann.ledgerId);
    beforeVersions = await versions(ann.ledgerId);
  }, 120000);

  it("soft-deletes every live row of every money table with one moment and records it", async () => {
    const bobBefore = await fingerprint(bob.ledgerId);
    const live = await liveCounts(ann.ledgerId);
    expect(total(live, ["write_receipts"])).toBeGreaterThan(20);
    started = Date.now();
    const response = await clear(ann);
    expect(response.statusCode, response.body).toBe(200);
    const body = response.json();
    expect(Date.parse(body.clearedAt)).toBeGreaterThanOrEqual(started - 1000);
    expect(Object.keys(body).sort()).toEqual([
      "baseCurrency",
      "clearedAt",
      "id",
      "name",
      "role",
      "timeZone",
      "version",
    ]);
    expect(body.id).toBe(ann.ledgerId);
    expect(body.role).toBe("owner");
    const stamp = await clearedAtOf(ann.ledgerId);
    expect(stamp.toISOString()).toBe(body.clearedAt);
    // Nothing live is left, apart from the clear's own receipt (saved after the clear).
    const after = await liveCounts(ann.ledgerId);
    expect(total(after, ["write_receipts"])).toBe(0);
    expect(after.write_receipts).toBe(1);
    // Nothing was removed: the row counts are what they were, plus the one receipt.
    const counts = await allCounts(ann.ledgerId);
    for (const [name, n] of Object.entries(before))
      expect(counts[name], name).toBe(name === "write_receipts" ? n + 1 : n);
    // Every row that was live carries the one moment; rows deleted earlier keep their own.
    const stamped = await stampedCounts(ann.ledgerId, stamp);
    for (const [name, n] of Object.entries(live)) {
      if (name === "ledger_members") continue;
      expect(stamped[name], name).toBe(n);
    }
    const earlier = await count(
      sql`SELECT count(*)::int AS n FROM transactions WHERE id = ${ann.ids.transactionId} AND deleted_at < ${stamp.toISOString()}::timestamptz`,
    );
    expect(earlier).toBe(1);
    // The ledger, its name, its currency and its members stay and the ledger is still live.
    const state = await ledgerState(ann.ledgerId);
    expect(state.deleted_at).toBeNull();
    expect(state.name).toBe("Personal ledger");
    expect(state.base_currency).toBe("USD");
    expect(
      await count(
        sql`SELECT count(*)::int AS n FROM ledger_members WHERE ledger_id = ${ann.ledgerId} AND deleted_at IS NULL`,
      ),
    ).toBe(1);
    // Someone else's ledger is byte for byte what it was.
    expect(await fingerprint(bob.ledgerId)).toEqual(bobBefore);
  });

  it("moves the version of every row that has one, and the ledger's, so a phone applies the change", async () => {
    const now = await versions(ann.ledgerId, false);
    for (const [key, version] of Object.entries(beforeVersions))
      expect(now[key], key).toBe(version + 1);
    expect((await ledgerState(ann.ledgerId)).version).toBe(3);
    // `updated_at` moved on every row, the ones without a version included.
    const stale = await count(
      sql`SELECT (SELECT count(*) FROM transaction_tags WHERE ledger_id = ${ann.ledgerId} AND updated_at < ${new Date(started - 1000).toISOString()}::timestamptz)::int AS n`,
    );
    expect(stale).toBe(0);
  });

  it("shows the person an empty ledger they can start again in, and names the moment on the ledger", async () => {
    expect((await listAccounts(ann)).items).toEqual([]);
    const ledger = (
      await send("GET", `/api/v1/ledgers/${ann.ledgerId}`, ann.cookie)
    ).json();
    expect(ledger.clearedAt).toBe(
      (await clearedAtOf(ann.ledgerId)).toISOString(),
    );
    const listed = (await send("GET", "/api/v1/ledgers", ann.cookie)).json();
    expect(listed.items[0].clearedAt).toBe(ledger.clearedAt);
    // An untouched ledger says null.
    const other = (
      await send("GET", `/api/v1/ledgers/${bob.ledgerId}`, bob.cookie)
    ).json();
    expect(other.clearedAt).toBeNull();
    const made = await send(
      "POST",
      `/api/v1/ledgers/${ann.ledgerId}/accounts`,
      ann.cookie,
      {
        name: "Fresh start",
        type: "bank",
        openingBalance: { amount: 0, currency: "USD" },
      },
    );
    expect(made.statusCode, made.body).toBe(201);
    // Remove it again so the next tests start from an empty ledger.
    const id = made.json().id as string;
    await removeRow(ann, "accounts", id);
  });

  it("needs the word CLEAR, and changes nothing without it", async () => {
    const carol = await addPerson("own-carol", true);
    const prints = await fingerprint(carol.ledgerId);
    for (const body of [
      undefined,
      {},
      { confirm: "clear" },
      { confirm: "CLEAR ", extra: 1 },
      { confirm: "CLEAR", extra: 1 },
      { confirm: "" },
      { confirm: "DELETE" },
      { confirm: true },
    ]) {
      const response = await clear(carol, { body });
      expect(response.statusCode, JSON.stringify(body)).toBe(400);
      expect(await fingerprint(carol.ledgerId)).toEqual(prints);
    }
    expect((await ledgerState(carol.ledgerId)).cleared_at).toBeNull();
  });

  it("is for the signed-in owner of that ledger, with the app's origin and a key", async () => {
    const dan = await addPerson("own-dan", true);
    const editor = await addPerson("own-editor");
    const viewer = await addPerson("own-viewer");
    const stranger = await addPerson("own-stranger");
    for (const [member, role] of [
      [editor, "editor"],
      [viewer, "viewer"],
    ] as const)
      await db
        .insert(ledgerMembers)
        .values({ ledgerId: dan.ledgerId, userId: member.id, role });
    const prints = await fingerprint(dan.ledgerId);
    const path = `/api/v1/ledgers/${dan.ledgerId}/clear`;
    const refused = [
      [await clear(dan, { cookie: "" }), 401],
      [await clear(dan, { origin: "http://elsewhere.example.com" }), 403],
      [
        await app.inject({
          method: "POST",
          url: path,
          headers: { origin: config.APP_URL, cookie: dan.cookie },
          payload: { confirm: "CLEAR" },
        }),
        400,
      ],
      [await clear(dan, { cookie: editor.cookie }), 403],
      [await clear(dan, { cookie: viewer.cookie }), 403],
      [await clear(dan, { cookie: stranger.cookie }), 404],
      [await clear(dan, { cookie: admin.cookie }), 404],
      [
        await post(`/api/v1/ledgers/${newId()}/clear`, dan.cookie, {
          body: { confirm: "CLEAR" },
        }),
        404,
      ],
    ] as const;
    for (const [response, status] of refused)
      expect(response.statusCode, response.body).toBe(status);
    expect(await fingerprint(dan.ledgerId)).toEqual(prints);
    expect((await ledgerState(dan.ledgerId)).cleared_at).toBeNull();
    // Restore has the same doors.
    expect((await restore(dan, { cookie: editor.cookie })).statusCode).toBe(
      403,
    );
    expect((await restore(dan, { cookie: viewer.cookie })).statusCode).toBe(
      403,
    );
    expect((await restore(dan, { cookie: stranger.cookie })).statusCode).toBe(
      404,
    );
    expect((await restore(dan, { cookie: "" })).statusCode).toBe(401);
    expect(
      (await restore(dan, { origin: "http://elsewhere.example.com" }))
        .statusCode,
    ).toBe(403);
  });

  it("answers a retry with the same key from the receipt, and does not clear what was added since", async () => {
    const eve = await addPerson("own-eve", true);
    const key = newId();
    const first = await clear(eve, { key });
    expect(first.statusCode, first.body).toBe(200);
    const made = await send(
      "POST",
      `/api/v1/ledgers/${eve.ledgerId}/tags`,
      eve.cookie,
      { name: "added after" },
    );
    expect(made.statusCode, made.body).toBe(201);
    const stamp = await clearedAtOf(eve.ledgerId);
    const again = await clear(eve, { key });
    expect(again.statusCode, again.body).toBe(200);
    expect(again.headers["idempotency-replayed"]).toBe("true");
    expect(again.json()).toEqual(first.json());
    expect((await clearedAtOf(eve.ledgerId)).getTime()).toBe(stamp.getTime());
    expect(
      await count(
        sql`SELECT count(*)::int AS n FROM tags WHERE ledger_id = ${eve.ledgerId} AND deleted_at IS NULL`,
      ),
    ).toBe(1);
    // The same key for a different action is refused.
    const wrong = await restore(eve, { key });
    expect(wrong.statusCode, wrong.body).toBe(409);
  });

  it("ends every Idempotency-Key used before it: an old retry cannot write into the emptied ledger", async () => {
    const fay = await addPerson("own-fay");
    const key = newId();
    const body = { name: "keyed tag" };
    const first = await post(
      `/api/v1/ledgers/${fay.ledgerId}/tags`,
      fay.cookie,
      {
        key,
        body,
      },
    );
    expect(first.statusCode, first.body).toBe(201);
    expect((await clear(fay)).statusCode).toBe(200);
    const retry = await post(
      `/api/v1/ledgers/${fay.ledgerId}/tags`,
      fay.cookie,
      {
        key,
        body,
      },
    );
    expect(retry.statusCode, retry.body).toBe(409);
    expect(
      await count(
        sql`SELECT count(*)::int AS n FROM tags WHERE ledger_id = ${fay.ledgerId} AND deleted_at IS NULL`,
      ),
    ).toBe(0);
  });

  it("changes nothing when there is nothing to clear, so a second press cannot throw away the undo", async () => {
    const gus = await addPerson("own-gus", true);
    expect((await clear(gus)).statusCode).toBe(200);
    const stamp = await clearedAtOf(gus.ledgerId);
    const stampedBefore = await stampedCounts(gus.ledgerId, stamp);
    const prints = await fingerprint(gus.ledgerId);
    const again = await clear(gus);
    expect(again.statusCode, again.body).toBe(200);
    expect(again.json().clearedAt).toBe(stamp.toISOString());
    expect((await clearedAtOf(gus.ledgerId)).getTime()).toBe(stamp.getTime());
    expect(await stampedCounts(gus.ledgerId, stamp)).toEqual(stampedBefore);
    // Only the second clear's own receipt is new.
    const after = await fingerprint(gus.ledgerId);
    const changed = Object.keys(after).filter((k) => after[k] !== prints[k]);
    expect(changed.sort()).toEqual(["write_receipts"]);
    expect((await restore(gus)).statusCode).toBe(200);
    expect(
      total(await liveCounts(gus.ledgerId), ["write_receipts"]),
    ).toBeGreaterThan(20);
  });

  it("a ledger that was never used clears to nothing and records nothing", async () => {
    const hal = await addPerson("own-hal");
    const response = await clear(hal);
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json().clearedAt).toBeNull();
    expect((await ledgerState(hal.ledgerId)).cleared_at).toBeNull();
    expect((await restore(hal)).statusCode).toBe(409);
  });

  it("clearing again removes the older batch at once and keeps the new one as the one undo", async () => {
    const ida = await addPerson("own-ida", true);
    expect((await clear(ida)).statusCode).toBe(200);
    const first = await clearedAtOf(ida.ledgerId);
    const firstCounts = await stampedCounts(ida.ledgerId, first);
    expect(total(firstCounts)).toBeGreaterThan(20);
    // Start again, with one row of the new data of every kind that has a route here.
    const account = await send(
      "POST",
      `/api/v1/ledgers/${ida.ledgerId}/accounts`,
      ida.cookie,
      {
        name: "Second start",
        type: "bank",
        openingBalance: { amount: 1000, currency: "USD" },
      },
    );
    expect(account.statusCode, account.body).toBe(201);
    const tag = await send(
      "POST",
      `/api/v1/ledgers/${ida.ledgerId}/tags`,
      ida.cookie,
      { name: "second tag" },
    );
    expect(tag.statusCode, tag.body).toBe(201);
    const secondLive = await liveCounts(ida.ledgerId);
    expect((await clear(ida)).statusCode).toBe(200);
    const second = await clearedAtOf(ida.ledgerId);
    expect(second.getTime()).toBeGreaterThan(first.getTime());
    // The older batch is gone for good, down to the rows deleted before it; the new one is whole.
    expect(
      await count(
        sql`SELECT count(*)::int AS n FROM transactions WHERE ledger_id = ${ida.ledgerId} AND deleted_at <= ${first.toISOString()}::timestamptz`,
      ),
    ).toBe(0);
    const left = await stampedCounts(ida.ledgerId, first);
    expect(total(left)).toBe(0);
    const newBatch = await stampedCounts(ida.ledgerId, second);
    expect(newBatch.accounts).toBe(1);
    expect(newBatch.tags).toBe(1);
    expect(total(newBatch, ["write_receipts"])).toBe(
      total(secondLive, ["write_receipts", "ledger_members"]),
    );
    // The undo brings back the second batch only.
    expect((await restore(ida)).statusCode).toBe(200);
    const live = await liveCounts(ida.ledgerId);
    expect(live.accounts).toBe(1);
    expect(live.tags).toBe(1);
    expect(live.transactions).toBe(0);
  });

  it("two clears at once leave one batch, whole, and one stamp", async () => {
    const jon = await addPerson("own-jon", true);
    const [a, b] = await Promise.all([clear(jon), clear(jon)]);
    expect([a.statusCode, b.statusCode], `${a.body} ${b.body}`).toEqual([
      200, 200,
    ]);
    const stamp = await clearedAtOf(jon.ledgerId);
    const live = await liveCounts(jon.ledgerId);
    expect(total(live, ["write_receipts", "ledger_members"])).toBe(0);
    // Everything that was live is under the one moment: nothing is stamped with another.
    const other = await count(
      sql`SELECT (SELECT count(*) FROM transactions WHERE ledger_id = ${jon.ledgerId} AND deleted_at IS NOT NULL AND deleted_at <> ${stamp.toISOString()}::timestamptz)::int AS n`,
    );
    expect(other).toBe(0);
    expect(
      total(await stampedCounts(jon.ledgerId, stamp), ["write_receipts"]),
    ).toBeGreaterThan(20);
  });
});

describe("restoring a cleared ledger", () => {
  let ann: Person;
  let bob: Person;
  let content: Record<string, string>;
  let cleared: Record<string, number>;
  beforeAll(async () => {
    ann = await addPerson("res-ann", true);
    bob = await addPerson("res-bob", true);
    await removeRow(ann, "transactions", ann.ids.transactionId);
    content = await liveContent(ann.ledgerId);
    cleared = await liveCounts(ann.ledgerId);
    expect((await clear(ann)).statusCode).toBe(200);
  }, 120000);

  it("brings back exactly what the clear removed, field for field, and nothing deleted before it", async () => {
    const bobPrints = await fingerprint(bob.ledgerId);
    const stamp = await clearedAtOf(ann.ledgerId);
    const response = await restore(ann);
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json().clearedAt).toBeNull();
    expect(response.json().id).toBe(ann.ledgerId);
    expect(await liveContent(ann.ledgerId)).toEqual(content);
    const live = await liveCounts(ann.ledgerId);
    for (const [name, n] of Object.entries(cleared)) {
      if (name === "write_receipts") continue;
      expect(live[name], name).toBe(n);
    }
    // The receipts of the old writes are back, with the clear's and the restore's own.
    expect(live.write_receipts).toBe((cleared.write_receipts ?? 0) + 2);
    expect((await ledgerState(ann.ledgerId)).cleared_at).toBeNull();
    // The entry deleted on its own, before the clear, is still deleted.
    expect(
      await count(
        sql`SELECT count(*)::int AS n FROM transactions WHERE id = ${ann.ids.transactionId} AND deleted_at IS NOT NULL AND deleted_at <> ${stamp.toISOString()}::timestamptz`,
      ),
    ).toBe(1);
    expect(await fingerprint(bob.ledgerId)).toEqual(bobPrints);
  });

  it("moves versions up again so a phone that saw the tombstones takes the live rows", async () => {
    const [account] = (
      await db.execute<{ version: number }>(
        sql`SELECT version FROM accounts WHERE id = ${ann.ids.accountId}`,
      )
    ).rows;
    // Created at 1 or more, +1 for the clear, +1 for the restore.
    expect((account as { version: number }).version).toBeGreaterThanOrEqual(3);
    expect((await ledgerState(ann.ledgerId)).version).toBe(4);
  });

  it("answers 409 when there is nothing to restore", async () => {
    const response = await restore(ann);
    expect(response.statusCode, response.body).toBe(409);
    expect(response.json().detail).toBe("There is nothing to restore.");
  });

  it("revives only this ledger's rows, even where another ledger's rows carry the identical moment", async () => {
    const cy = await addPerson("res-cy", true);
    const dee = await addPerson("res-dee", true);
    expect((await clear(cy)).statusCode).toBe(200);
    expect((await clear(dee)).statusCode).toBe(200);
    // Give dee's batch the very moment cy's has.
    await ageBatch(dee.ledgerId, await clearedAtOf(cy.ledgerId));
    const deeLive = await liveCounts(dee.ledgerId);
    const deeAll = await fingerprint(dee.ledgerId);
    expect((await restore(cy)).statusCode).toBe(200);
    expect(await liveCounts(dee.ledgerId)).toEqual(deeLive);
    expect(await fingerprint(dee.ledgerId)).toEqual(deeAll);
  });

  it("answers 409 while anything live is in the ledger, and changes nothing", async () => {
    const eli = await addPerson("res-eli", true);
    expect((await clear(eli)).statusCode).toBe(200);
    for (const [path, body] of [
      ["tags", { name: "in the way" }],
      [
        "accounts",
        {
          name: "in the way",
          type: "bank",
          openingBalance: { amount: 0, currency: "USD" },
        },
      ],
    ] as const) {
      const made = await send(
        "POST",
        `/api/v1/ledgers/${eli.ledgerId}/${path}`,
        eli.cookie,
        body,
      );
      expect(made.statusCode, made.body).toBe(201);
      const prints = await fingerprint(eli.ledgerId);
      const response = await restore(eli);
      expect(response.statusCode, response.body).toBe(409);
      expect(response.json().detail).toBe("Clear what is there now first.");
      expect(await fingerprint(eli.ledgerId)).toEqual(
        // The refused restore's own receipt is the only difference allowed: none is saved for a refusal.
        prints,
      );
      const id = (made.json() as { id: string }).id;
      await removeRow(eli, path, id);
    }
  });

  it("counts a currency or a rate made after the clear as something live too", async () => {
    const ivy = await addPerson("res-ivy", true);
    expect((await clear(ivy)).statusCode).toBe(200);
    const made = await send(
      "POST",
      `/api/v1/ledgers/${ivy.ledgerId}/currencies`,
      ivy.cookie,
      { code: "EUR" },
    );
    expect(made.statusCode, made.body).toBe(201);
    const response = await restore(ivy);
    expect(response.statusCode, response.body).toBe(409);
    expect(response.json().detail).toBe("Clear what is there now first.");
  });

  it("works for 30 days after the clear and not after", async () => {
    const flo = await addPerson("res-flo", true);
    expect((await clear(flo)).statusCode).toBe(200);
    // Not yet: 30 days less ten seconds.
    await ageBatch(flo.ledgerId, new Date(Date.now() - 30 * DAY + 10000));
    const gone = await allCounts(flo.ledgerId);
    expect(RETENTION_DAYS).toBe(30);
    // The exact millisecond: the batch of the moment X is open before X + 30 days and closed from then on.
    const stamp = await clearedAtOf(flo.ledgerId);
    const open = new Date(stamp.getTime() + 30 * DAY - 1);
    const closed = new Date(stamp.getTime() + 30 * DAY);
    await expect(
      db.transaction((tx) => restoreClearedRows(tx, flo.ledgerId, closed)),
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(await allCounts(flo.ledgerId)).toEqual(gone);
    expect((await ledgerState(flo.ledgerId)).cleared_at).not.toBeNull();
    await db.transaction((tx) => restoreClearedRows(tx, flo.ledgerId, open));
    expect((await ledgerState(flo.ledgerId)).cleared_at).toBeNull();
    expect(
      total(await liveCounts(flo.ledgerId), ["write_receipts"]),
    ).toBeGreaterThan(20);
  });

  it("is refused through the route once the 30 days are over, even before the hourly job has removed the batch", async () => {
    const gil = await addPerson("res-gil", true);
    expect((await clear(gil)).statusCode).toBe(200);
    await ageBatch(gil.ledgerId, new Date(Date.now() - 30 * DAY - 10000));
    const prints = await fingerprint(gil.ledgerId);
    const response = await restore(gil);
    expect(response.statusCode, response.body).toBe(409);
    expect(await fingerprint(gil.ledgerId)).toEqual(prints);
  });

  it("answers a retry with the same key from the receipt", async () => {
    const hub = await addPerson("res-hub", true);
    expect((await clear(hub)).statusCode).toBe(200);
    const key = newId();
    const first = await restore(hub, { key });
    expect(first.statusCode, first.body).toBe(200);
    const again = await restore(hub, { key });
    expect(again.statusCode, again.body).toBe(200);
    expect(again.headers["idempotency-replayed"]).toBe("true");
    expect(again.json()).toEqual(first.json());
    // A key from before a later clear is dead: the retry cannot undo that clear.
    expect((await clear(hub)).statusCode).toBe(200);
    const late = await restore(hub, { key });
    expect(late.statusCode, late.body).toBe(409);
    expect((await ledgerState(hub.ledgerId)).cleared_at).not.toBeNull();
  });
});

describe("the admin clearing and restoring a person's ledger", () => {
  let ann: Person;
  let bob: Person;
  beforeAll(async () => {
    ann = await addPerson("adm-ann", true);
    bob = await addPerson("adm-bob", true);
  }, 120000);

  it("clears the ledger and answers with account facts and the moment, never anything from the ledger", async () => {
    const bobPrints = await fingerprint(bob.ledgerId);
    const response = await adminClear(ann.id);
    expect(response.statusCode, response.body).toBe(200);
    const body = managedUserSchema.parse(response.json());
    expect(body.id).toBe(ann.id);
    expect(body.ledgerClearedAt).toBe(
      (await clearedAtOf(ann.ledgerId)).toISOString(),
    );
    for (const secret of [
      ...ann.secrets.filter(
        (value) => value !== ann.id && value !== mailbox("adm-ann"),
      ),
      "Personal ledger",
    ])
      expect(response.body).not.toContain(secret);
    expect(Object.keys(response.json()).sort()).toEqual([
      "createdAt",
      "disabled",
      "email",
      "id",
      "isAdmin",
      "ledgerClearedAt",
      "mustChangePassword",
      "name",
      "twoFactorEnabled",
    ]);
    expect(total(await liveCounts(ann.ledgerId))).toBe(0);
    expect(await fingerprint(bob.ledgerId)).toEqual(bobPrints);
    // The person sees the empty ledger, signed in as before.
    expect((await listAccounts(ann)).items).toEqual([]);
  });

  it("lists who has a cleared ledger", async () => {
    const list = managedUserListSchema.parse(
      (await send("GET", "/api/v1/users", admin.cookie)).json(),
    );
    const byId = new Map(list.items.map((item) => [item.id, item]));
    expect(byId.get(ann.id)?.ledgerClearedAt).not.toBeNull();
    expect(byId.get(bob.id)?.ledgerClearedAt).toBeNull();
    expect(byId.get(admin.id)?.ledgerClearedAt).toBeNull();
    // Every other answer about the person says the same.
    const stopped = await send(
      "PATCH",
      `/api/v1/users/${ann.id}`,
      admin.cookie,
      {
        disabled: true,
      },
    );
    expect(stopped.json().ledgerClearedAt).toBe(
      byId.get(ann.id)?.ledgerClearedAt,
    );
    const allowed = await send(
      "PATCH",
      `/api/v1/users/${ann.id}`,
      admin.cookie,
      {
        disabled: false,
      },
    );
    expect(allowed.json().ledgerClearedAt).toBe(
      byId.get(ann.id)?.ledgerClearedAt,
    );
  });

  it("restores it and says so, the same way the person's own restore does", async () => {
    const stamp = await clearedAtOf(ann.ledgerId);
    const refused = await adminRestore(bob.id);
    expect(refused.statusCode, refused.body).toBe(409);
    expect(refused.json().detail).toBe("There is nothing to restore.");
    const response = await adminRestore(ann.id);
    expect(response.statusCode, response.body).toBe(200);
    expect(managedUserSchema.parse(response.json()).ledgerClearedAt).toBeNull();
    expect(
      total(await liveCounts(ann.ledgerId), ["write_receipts"]),
    ).toBeGreaterThan(20);
    expect((await stampedCounts(ann.ledgerId, stamp)).accounts).toBe(0);
    for (const secret of ann.secrets.filter(
      (value) => value !== ann.id && value !== mailbox("adm-ann"),
    ))
      expect(response.body).not.toContain(secret);
  });

  it("answers 409 while the ledger holds anything live, and changes nothing", async () => {
    const cy = await addPerson("adm-cy", true);
    expect((await adminClear(cy.id)).statusCode).toBe(200);
    const made = await send(
      "POST",
      `/api/v1/ledgers/${cy.ledgerId}/tags`,
      cy.cookie,
      { name: "in the way" },
    );
    expect(made.statusCode, made.body).toBe(201);
    const prints = await fingerprint(cy.ledgerId);
    const response = await adminRestore(cy.id);
    expect(response.statusCode, response.body).toBe(409);
    expect(response.json().detail).toBe("Clear what is there now first.");
    expect(await fingerprint(cy.ledgerId)).toEqual(prints);
  });

  it("changes nothing for a ledger with nothing live, so the undo is kept", async () => {
    const dee = await addPerson("adm-dee", true);
    expect((await adminClear(dee.id)).statusCode).toBe(200);
    const stamp = await clearedAtOf(dee.ledgerId);
    const prints = await fingerprint(dee.ledgerId);
    const again = await adminClear(dee.id);
    expect(again.statusCode, again.body).toBe(200);
    expect((await clearedAtOf(dee.ledgerId)).getTime()).toBe(stamp.getTime());
    expect(await fingerprint(dee.ledgerId)).toEqual(prints);
  });

  it("clears the ledger a person owns, never one they are only a member of", async () => {
    const owner = await addPerson("adm-owner", true);
    const member = await addPerson("adm-member", true);
    // The membership in the other ledger is the older one, so only the role tells the two apart.
    await db.insert(ledgerMembers).values({
      ledgerId: owner.ledgerId,
      userId: member.id,
      role: "editor",
      createdAt: new Date("2020-01-01T00:00:00.000Z"),
    });
    const ownerPrints = await fingerprint(owner.ledgerId);
    expect((await adminClear(member.id)).statusCode).toBe(200);
    expect(await fingerprint(owner.ledgerId)).toEqual(ownerPrints);
    expect(total(await liveCounts(member.ledgerId), ["write_receipts"])).toBe(
      0,
    );
    const listed = managedUserListSchema.parse(
      (await send("GET", "/api/v1/users", admin.cookie)).json(),
    );
    const byId = new Map(listed.items.map((item) => [item.id, item]));
    expect(byId.get(member.id)?.ledgerClearedAt).not.toBeNull();
    expect(byId.get(owner.id)?.ledgerClearedAt).toBeNull();
    expect((await adminRestore(member.id)).statusCode).toBe(200);
    expect(await fingerprint(owner.ledgerId)).toEqual(ownerPrints);
  });

  it("works for a person on a temporary password and for one whose sign-in is stopped", async () => {
    const eve = await addPerson("adm-eve", true);
    const added = await send("POST", "/api/v1/users", admin.cookie, {
      name: "Person adm-temp",
      email: mailbox("adm-temp"),
      temporaryPassword: temporary,
    });
    expect(added.statusCode, added.body).toBe(201);
    const stopped = await send(
      "PATCH",
      `/api/v1/users/${eve.id}`,
      admin.cookie,
      {
        disabled: true,
      },
    );
    expect(stopped.statusCode).toBe(200);
    expect((await adminClear(eve.id)).statusCode).toBe(200);
    expect((await adminRestore(eve.id)).statusCode).toBe(200);
    const [fresh] = await db
      .select({ id: user.id })
      .from(user)
      .where(eq(user.email, mailbox("adm-temp")));
    expect((await adminClear(fresh?.id as string)).statusCode).toBe(200);
  });

  it("is for the admin only, with the app's origin, and never for the admin's own account", async () => {
    const fay = await addPerson("adm-fay", true);
    const prints = await fingerprint(fay.ledgerId);
    for (const action of ["clear", "restore"]) {
      const path = `/api/v1/users/${fay.id}/ledger/${action}`;
      expect((await app.inject({ method: "POST", url: path })).statusCode).toBe(
        401,
      );
      expect((await send("POST", path, fay.cookie)).statusCode).toBe(403);
      expect((await send("POST", path, bob.cookie)).statusCode).toBe(403);
      expect(
        (
          await app.inject({
            method: "POST",
            url: path,
            headers: {
              origin: "http://elsewhere.example.com",
              cookie: admin.cookie,
            },
          })
        ).statusCode,
      ).toBe(403);
      expect(
        (
          await send(
            "POST",
            `/api/v1/users/${admin.id}/ledger/${action}`,
            admin.cookie,
          )
        ).statusCode,
      ).toBe(409);
      expect(
        (
          await send(
            "POST",
            `/api/v1/users/${newId()}/ledger/${action}`,
            admin.cookie,
          )
        ).statusCode,
      ).toBe(404);
    }
    expect(await fingerprint(fay.ledgerId)).toEqual(prints);
    expect(await fingerprint(admin.ledgerId)).toBeDefined();
    expect((await ledgerState(admin.ledgerId)).cleared_at).toBeNull();
  });

  it("does not reach a deleted person's ledger", async () => {
    const gus = await addPerson("adm-gus", true);
    expect(
      (await send("DELETE", `/api/v1/users/${gus.id}`, admin.cookie))
        .statusCode,
    ).toBe(204);
    const prints = await fingerprint(gus.ledgerId);
    expect((await adminClear(gus.id)).statusCode).toBe(404);
    expect((await adminRestore(gus.id)).statusCode).toBe(404);
    expect(await fingerprint(gus.ledgerId)).toEqual(prints);
  });

  it("a cleared ledger and a person deleted and restored stay apart: the undo is still there", async () => {
    const hal = await addPerson("adm-hal", true);
    expect((await clear(hal)).statusCode).toBe(200);
    const stamp = await clearedAtOf(hal.ledgerId);
    expect(
      (await send("DELETE", `/api/v1/users/${hal.id}`, admin.cookie))
        .statusCode,
    ).toBe(204);
    const back = await send(
      "POST",
      `/api/v1/users/${hal.id}/restore`,
      admin.cookie,
    );
    expect(back.statusCode, back.body).toBe(200);
    // The restored person is answered with the date of the clear their ledger still holds.
    expect(back.json().ledgerClearedAt).toBe(stamp.toISOString());
    expect((await clearedAtOf(hal.ledgerId)).getTime()).toBe(stamp.getTime());
    expect((await adminRestore(hal.id)).statusCode).toBe(200);
    expect(
      total(await liveCounts(hal.ledgerId), ["write_receipts"]),
    ).toBeGreaterThan(20);
  });
});

describe("the hourly removal of cleared batches", () => {
  // Every earlier test left batches behind; remove them so each test counts only its own.
  beforeEach(async () => {
    await purgeClearedLedgers(db, new Date(Date.now() + 365 * DAY), log());
  });
  it("removes a batch 30 days after the clear, to the millisecond, with the tick's own clock", async () => {
    const ann = await addPerson("job-ann", true);
    expect((await clear(ann)).statusCode).toBe(200);
    const stamp = await clearedAtOf(ann.ledgerId);
    const before = await allCounts(ann.ledgerId);
    const quiet = log();
    const early = await purgeClearedLedgers(
      db,
      new Date(stamp.getTime() + 30 * DAY - 1),
      quiet,
    );
    expect(early).toEqual({ purged: 0, failed: 0 });
    expect(await allCounts(ann.ledgerId)).toEqual(before);
    expect(quiet.info).not.toHaveBeenCalled();
    const due = await purgeClearedLedgers(
      db,
      new Date(stamp.getTime() + 30 * DAY),
      quiet,
    );
    expect(due).toEqual({ purged: 1, failed: 0 });
    expect(quiet.info).toHaveBeenCalledWith(
      { purged: 1 },
      "Removed cleared ledgers",
    );
    expect(quiet.error).not.toHaveBeenCalled();
    const after = await allCounts(ann.ledgerId);
    for (const [name, n] of Object.entries(after)) {
      if (name === "ledger_members") expect(n).toBe(1);
      else if (name === "write_receipts") expect(n).toBe(1);
      else expect(n, name).toBe(0);
    }
    const state = await ledgerState(ann.ledgerId);
    expect(state.cleared_at).toBeNull();
    expect(state.deleted_at).toBeNull();
    // Nothing is left to restore, and a second run has nothing to do.
    expect((await restore(ann)).statusCode).toBe(409);
    expect(
      await purgeClearedLedgers(
        db,
        new Date(stamp.getTime() + 31 * DAY),
        log(),
      ),
    ).toEqual({ purged: 0, failed: 0 });
  });

  it("keeps what was made after the clear and removes what was deleted before it, and leaves other ledgers whole", async () => {
    const ann = await addPerson("job-keep", true);
    const bob = await addPerson("job-bob", true);
    await removeRow(ann, "transactions", ann.ids.transactionId);
    expect((await clear(ann)).statusCode).toBe(200);
    expect((await clear(bob)).statusCode).toBe(200);
    const fresh = await send(
      "POST",
      `/api/v1/ledgers/${ann.ledgerId}/accounts`,
      ann.cookie,
      {
        name: "kept",
        type: "bank",
        openingBalance: { amount: 5, currency: "USD" },
      },
    );
    expect(fresh.statusCode, fresh.body).toBe(201);
    const stamp = await clearedAtOf(ann.ledgerId);
    const freshPrints = await liveContent(ann.ledgerId);
    const bobPrints = await fingerprint(bob.ledgerId);
    // Only ann's batch is due: age it alone.
    await ageBatch(ann.ledgerId, new Date(Date.now() - 31 * DAY));
    const result = await purgeClearedLedgers(db, new Date(), log());
    expect(result.failed).toBe(0);
    expect(result.purged).toBeGreaterThanOrEqual(1);
    expect(await liveContent(ann.ledgerId)).toEqual(freshPrints);
    expect(
      await count(
        sql`SELECT count(*)::int AS n FROM transactions WHERE id = ${ann.ids.transactionId}`,
      ),
    ).toBe(0);
    expect(
      await count(
        sql`SELECT count(*)::int AS n FROM accounts WHERE ledger_id = ${ann.ledgerId} AND deleted_at IS NOT NULL`,
      ),
    ).toBe(0);
    expect(stamp.getTime()).toBeGreaterThan(0);
    // Bob's batch was not due.
    expect(await fingerprint(bob.ledgerId)).toEqual(bobPrints);
    expect((await ledgerState(bob.ledgerId)).cleared_at).not.toBeNull();
  });

  it("removes a batch whose accounts a row deleted earlier still points at, without a database error", async () => {
    const cat = await addPerson("job-fk", true);
    // A transaction deleted on its own points at an account that is live and gets cleared.
    await removeRow(cat, "transactions", cat.ids.transactionId);
    expect((await clear(cat)).statusCode).toBe(200);
    await ageBatch(cat.ledgerId, new Date(Date.now() - 31 * DAY));
    const quiet = log();
    const result = await purgeClearedLedgers(db, new Date(), quiet);
    expect(result.failed, JSON.stringify(quiet.error.mock.calls)).toBe(0);
    expect(
      total(await allCounts(cat.ledgerId), [
        "ledger_members",
        "write_receipts",
      ]),
    ).toBe(0);
  });

  it("removes a ledger of a person who is deleted too, and a restored person's batch the hour after", async () => {
    const dot = await addPerson("job-dot", true);
    expect((await clear(dot)).statusCode).toBe(200);
    expect(
      (await send("DELETE", `/api/v1/users/${dot.id}`, admin.cookie))
        .statusCode,
    ).toBe(204);
    await ageBatch(dot.ledgerId, new Date(Date.now() - 31 * DAY));
    const result = await purgeClearedLedgers(db, new Date(), log());
    expect(result.failed).toBe(0);
    expect((await ledgerState(dot.ledgerId)).cleared_at).toBeNull();
    expect(
      total(await allCounts(dot.ledgerId), [
        "ledger_members",
        "write_receipts",
      ]),
    ).toBe(0);
  });

  it("a ledger that cannot be removed is left whole and the others still go, and the log has counts only", async () => {
    const bad = await addPerson("job-bad", true);
    const good = await addPerson("job-good", true);
    expect((await clear(bad)).statusCode).toBe(200);
    expect((await clear(good)).statusCode).toBe(200);
    await ageBatch(bad.ledgerId, new Date(Date.now() - 32 * DAY));
    await ageBatch(good.ledgerId, new Date(Date.now() - 31 * DAY));
    const badBefore = await fingerprint(bad.ledgerId);
    // A stand-in for a future table that points at an account: the database refuses to remove it.
    await db.execute(
      sql`CREATE TABLE zz_clear_probe (id uuid PRIMARY KEY, account_id uuid NOT NULL REFERENCES accounts(id))`,
    );
    try {
      await db.execute(
        sql`INSERT INTO zz_clear_probe (id, account_id) VALUES (${newId()}, ${bad.ids.accountId})`,
      );
      const quiet = log();
      const result = await purgeClearedLedgers(db, new Date(), quiet);
      expect(result.failed).toBe(1);
      expect(result.purged).toBeGreaterThanOrEqual(1);
      expect(quiet.error).toHaveBeenCalledWith(
        { failed: 1 },
        "Could not remove cleared ledgers",
      );
      // Why it failed is logged too, as the error class and database code only (never the message or the row).
      expect(quiet.error).toHaveBeenCalledWith(
        expect.objectContaining({
          pgCode: "23503",
          constraint: "zz_clear_probe_account_id_fkey",
        }),
        "Could not remove a cleared ledger",
      );
      const text = JSON.stringify([
        quiet.info.mock.calls,
        quiet.error.mock.calls,
      ]);
      for (const secret of [
        bad.ledgerId,
        good.ledgerId,
        bad.marker,
        good.marker,
        mailbox("job-bad"),
      ])
        expect(text).not.toContain(secret);
      expect(await fingerprint(bad.ledgerId)).toEqual(badBefore);
      expect((await ledgerState(bad.ledgerId)).cleared_at).not.toBeNull();
      expect((await ledgerState(good.ledgerId)).cleared_at).toBeNull();
    } finally {
      await db.execute(sql`DROP TABLE zz_clear_probe`);
    }
  });

  it("looks again under the lock: a restore that commits while the removal waits wins", async () => {
    const ann = await addPerson("job-lock", true);
    expect((await clear(ann)).statusCode).toBe(200);
    await ageBatch(ann.ledgerId, new Date(Date.now() - 30 * DAY - 5000));
    // The restore's own transaction holds the ledger; it is not committed yet.
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let holding: () => void = () => {};
    const ready = new Promise<void>((resolve) => {
      holding = resolve;
    });
    const restoring = db.transaction(async (tx) => {
      await restoreClearedRows(
        tx,
        ann.ledgerId,
        new Date(Date.now() - 31 * DAY),
      );
      holding();
      await held;
    });
    await ready;
    const removal = purgeClearedLedgers(db, new Date(), log());
    // The removal has read its list and is waiting for the lock.
    await new Promise((resolve) => setTimeout(resolve, 500));
    release();
    await restoring;
    const result = await removal;
    expect(result).toEqual({ purged: 0, failed: 0 });
    expect(
      total(await liveCounts(ann.ledgerId), ["write_receipts"]),
    ).toBeGreaterThan(20);
    expect((await ledgerState(ann.ledgerId)).cleared_at).toBeNull();
  });

  it("a restore and the removal at the same moment leave one winner and a whole ledger", async () => {
    for (const round of [1, 2, 3]) {
      const ann = await addPerson(`job-race${round}`, true);
      expect((await clear(ann)).statusCode).toBe(200);
      await ageBatch(ann.ledgerId, new Date(Date.now() - 30 * DAY + 3000));
      const live = total(await liveCounts(ann.ledgerId), ["write_receipts"]);
      expect(live).toBe(0);
      const stamp = await clearedAtOf(ann.ledgerId);
      const [restored, purged] = await Promise.all([
        restore(ann),
        purgeClearedLedgers(db, new Date(stamp.getTime() + 30 * DAY), log()),
      ]);
      const state = await ledgerState(ann.ledgerId);
      const liveAfter = total(await liveCounts(ann.ledgerId), [
        "write_receipts",
        "ledger_members",
      ]);
      expect(state.cleared_at).toBeNull();
      if (restored.statusCode === 200) {
        expect(purged.purged).toBe(0);
        expect(liveAfter).toBeGreaterThan(20);
      } else {
        expect(restored.statusCode).toBe(409);
        expect(purged.purged).toBe(1);
        expect(liveAfter).toBe(0);
      }
      expect(purged.failed).toBe(0);
    }
  });

  it("is not touched by the removal of a ledger that was never cleared", async () => {
    const ann = await addPerson("job-never", true);
    const prints = await fingerprint(ann.ledgerId);
    await purgeClearedLedgers(db, new Date(Date.now() + 365 * DAY), log());
    expect(await fingerprint(ann.ledgerId)).toEqual(prints);
  });
});

describe("what the phone's sync shows", () => {
  type Row = {
    id: string;
    version?: number;
    updatedAt: string;
    deletedAt: string | null;
  };
  const pull = async (person: Person, cursor?: string) => {
    const response = await send(
      "GET",
      `/api/v1/ledgers/${person.ledgerId}/sync?limit=1000${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
      person.cookie,
    );
    expect(response.statusCode, response.body).toBe(200);
    return syncResponseSchema.parse(response.json());
  };
  const rowsOf = (page: Awaited<ReturnType<typeof pull>>) =>
    Object.entries(page.changes).flatMap(([table, rows]) =>
      (rows as Row[]).map((row) => ({ table, ...row })),
    );
  /** What the phone does: keeps a row unless the copy it holds is as new or newer. */
  const apply = (held: Map<string, Row>, rows: ReturnType<typeof rowsOf>) => {
    for (const row of rows) {
      const key = `${row.table}/${row.id}`;
      const mine = held.get(key);
      const newer = !mine
        ? true
        : row.version !== undefined && mine.version !== undefined
          ? row.version > mine.version
          : Date.parse(row.updatedAt) > Date.parse(mine.updatedAt);
      if (newer) held.set(key, row);
    }
  };

  it("sends a clear as tombstones that win over the rows the phone holds, and a restore as live rows that win over those", async () => {
    const ann = await addPerson("syn-ann", true);
    const first = await pull(ann);
    const held = new Map<string, Row>();
    apply(held, rowsOf(first));
    const rows = rowsOf(first);
    expect(rows.length).toBeGreaterThan(10);
    expect(rows.every((row) => row.deletedAt === null)).toBe(true);
    expect(new Set(rows.map((row) => row.table)).size).toBe(8);

    expect((await clear(ann)).statusCode).toBe(200);
    // Pulling from the cursor the phone kept gets the clear.
    const afterClear = await pull(ann, first.cursor);
    const cleared = rowsOf(afterClear);
    expect(cleared.length).toBe(rows.length);
    expect(cleared.every((row) => row.deletedAt !== null)).toBe(true);
    apply(held, cleared);
    expect([...held.values()].every((row) => row.deletedAt !== null)).toBe(
      true,
    );
    // A full pull agrees.
    expect(rowsOf(await pull(ann)).every((row) => row.deletedAt !== null)).toBe(
      true,
    );

    expect((await restore(ann)).statusCode).toBe(200);
    const afterRestore = await pull(ann, afterClear.cursor);
    const revived = rowsOf(afterRestore);
    expect(revived.length).toBe(rows.length);
    expect(revived.every((row) => row.deletedAt === null)).toBe(true);
    apply(held, revived);
    expect([...held.values()].every((row) => row.deletedAt === null)).toBe(
      true,
    );
  });

  it("sends nothing of a ledger that is not the caller's", async () => {
    const ann = await addPerson("syn-own", true);
    const other = await addPerson("syn-other", true);
    expect((await clear(ann)).statusCode).toBe(200);
    const response = await send(
      "GET",
      `/api/v1/ledgers/${ann.ledgerId}/sync`,
      other.cookie,
    );
    expect(response.statusCode).toBe(404);
    expect(response.body).not.toContain(ann.marker);
  });
});

describe("the person's ledger and the clear after a restore of a person", () => {
  it("hand a ledger's own member rows nothing: memberships are never stamped", async () => {
    const ann = await addPerson("mem-ann", true);
    const members = await db
      .select()
      .from(ledgerMembers)
      .where(eq(ledgerMembers.ledgerId, ann.ledgerId));
    expect((await clear(ann)).statusCode).toBe(200);
    const after = await db
      .select()
      .from(ledgerMembers)
      .where(
        and(
          eq(ledgerMembers.ledgerId, ann.ledgerId),
          eq(ledgerMembers.userId, ann.id),
        ),
      );
    expect(after).toEqual(members);
    const [ledger] = await db
      .select()
      .from(ledgers)
      .where(eq(ledgers.id, ann.ledgerId));
    expect(ledger?.deletedAt).toBeNull();
  });
});

describe("holding the ledger while a clear or a restore runs", () => {
  /** Another writer in the middle of its own write: it holds the ledger row shared until it is released. */
  async function holdShared(ledgerId: string) {
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let ready: () => void = () => {};
    const started = new Promise<void>((resolve) => {
      ready = resolve;
    });
    const running = db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT id FROM ledgers WHERE id = ${ledgerId} FOR SHARE`,
      );
      ready();
      await held;
    });
    await started;
    return async () => {
      release();
      await running;
    };
  }
  const pause = () => new Promise((resolve) => setTimeout(resolve, 600));

  it("two clears at once, both waiting for another writer, finish one after the other without a deadlock", async () => {
    const ann = await addPerson("lok-clear", true);
    const letGo = await holdShared(ann.ledgerId);
    const both = Promise.all([clear(ann), clear(ann)]);
    await pause();
    await letGo();
    const [a, b] = await both;
    expect([a.statusCode, b.statusCode], `${a.body} ${b.body}`).toEqual([
      200, 200,
    ]);
    const stamp = await clearedAtOf(ann.ledgerId);
    expect(
      total(await stampedCounts(ann.ledgerId, stamp), ["write_receipts"]),
    ).toBeGreaterThan(20);
  });

  it("two restores at once finish one after the other: one brings the data back and the other finds nothing", async () => {
    const ann = await addPerson("lok-restore", true);
    expect((await clear(ann)).statusCode).toBe(200);
    const letGo = await holdShared(ann.ledgerId);
    const both = Promise.all([restore(ann), restore(ann)]);
    await pause();
    await letGo();
    const [a, b] = await both;
    expect([a.statusCode, b.statusCode].sort(), `${a.body} ${b.body}`).toEqual([
      200, 409,
    ]);
    expect(
      total(await liveCounts(ann.ledgerId), ["write_receipts"]),
    ).toBeGreaterThan(20);
  });

  it("two admin clears at once leave the record and the rows under the same moment", async () => {
    const ann = await addPerson("lok-admin", true);
    const letGo = await holdShared(ann.ledgerId);
    // The second starts a little later, so the two moments differ if the ledger is not held.
    const first = adminClear(ann.id);
    await new Promise((resolve) => setTimeout(resolve, 80));
    const both = Promise.all([first, adminClear(ann.id)]);
    await pause();
    await letGo();
    const [a, b] = await both;
    expect([a.statusCode, b.statusCode], `${a.body} ${b.body}`).toEqual([
      200, 200,
    ]);
    const stamp = await clearedAtOf(ann.ledgerId);
    const stamped = await stampedCounts(ann.ledgerId, stamp);
    expect(total(stamped, ["write_receipts"])).toBeGreaterThan(20);
    expect(total(await liveCounts(ann.ledgerId))).toBe(0);
    expect((await adminRestore(ann.id)).statusCode).toBe(200);
    expect(
      total(await liveCounts(ann.ledgerId), ["write_receipts"]),
    ).toBeGreaterThan(20);
  });

  it("a ledger that is not there is not found, whoever asks", async () => {
    for (const run of [
      (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) =>
        clearLedgerRows(tx, newId()),
      (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) =>
        restoreClearedRows(tx, newId()),
    ])
      await expect(db.transaction(run)).rejects.toMatchObject({
        statusCode: 404,
      });
  });
});

describe("the admin's routes at the edges", () => {
  it("never restore the admin's own cleared ledger, even when there is something to restore", async () => {
    const made = await send(
      "POST",
      `/api/v1/ledgers/${admin.ledgerId}/tags`,
      admin.cookie,
      { name: "admin tag" },
    );
    expect(made.statusCode, made.body).toBe(201);
    expect((await clear(admin)).statusCode).toBe(200);
    try {
      const response = await adminRestore(admin.id);
      expect(response.statusCode, response.body).toBe(409);
      expect(response.json().detail).toBe(
        "You cannot do this to your own account.",
      );
      expect((await ledgerState(admin.ledgerId)).cleared_at).not.toBeNull();
      expect(total(await liveCounts(admin.ledgerId), ["write_receipts"])).toBe(
        0,
      );
    } finally {
      expect((await restore(admin)).statusCode).toBe(200);
      await removeRow(admin, "tags", made.json().id);
    }
  });

  it("say so when a person has no ledger of their own, and change nothing", async () => {
    const ann = await addPerson("edge-none", true);
    await db
      .update(ledgerMembers)
      .set({ deletedAt: new Date() })
      .where(eq(ledgerMembers.userId, ann.id));
    try {
      for (const action of [adminClear, adminRestore]) {
        const response = await action(ann.id);
        expect(response.statusCode, response.body).toBe(409);
        expect(response.json().detail).toBe("This person has no ledger.");
      }
    } finally {
      await db
        .update(ledgerMembers)
        .set({ deletedAt: null })
        .where(eq(ledgerMembers.userId, ann.id));
    }
    expect((await ledgerState(ann.ledgerId)).cleared_at).toBeNull();
  });

  it("show no date for a ledger that was deleted", async () => {
    const ann = await addPerson("edge-gone", true);
    expect((await clear(ann)).statusCode).toBe(200);
    await db
      .update(ledgers)
      .set({ deletedAt: new Date() })
      .where(eq(ledgers.id, ann.ledgerId));
    try {
      const listed = managedUserListSchema.parse(
        (await send("GET", "/api/v1/users", admin.cookie)).json(),
      );
      expect(
        listed.items.find((item) => item.id === ann.id)?.ledgerClearedAt,
      ).toBeNull();
    } finally {
      await db
        .update(ledgers)
        .set({ deletedAt: null })
        .where(eq(ledgers.id, ann.ledgerId));
    }
  });
});
