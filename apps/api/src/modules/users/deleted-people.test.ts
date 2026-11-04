import {
  deletedUserListSchema,
  managedUserSchema,
  newId,
} from "@ledgerline/shared";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { buildApp } from "../../app";
import { createDatabase } from "../../db/client";
import { applyMigrations } from "../../db/migrate";
import {
  account as credentials,
  ledgerMembers,
  ledgers,
  session,
  user,
  writeReceipts,
} from "../../db/schema";
import { requireTestDatabase, testConfig } from "../../test-support/harness";
import { ledgerFixture, type Person } from "../../test-support/ledger-fixture";
import { createAccount } from "../auth/accounts";
import { PURGED_TABLES, purgeDeletedPeople, RETENTION_DAYS } from "./lifecycle";

// ADR 0049, slice B: deleted people wait 30 days in "Recently deleted", can be restored exactly as they were, can be
// deleted at once, and are removed for good (with all their data) after 30 days.
const url = requireTestDatabase("Deleted-people tests");
const config = testConfig(url, "del");
const { db, pool } = createDatabase(url);
const app = await buildApp(db, config);
const mailbox = (name: string) => `del-${name}@example.com`;
const temporary = "temporary-pass-1234";
const own = "my-own-password-5678";
const fx = ledgerFixture({
  app,
  config,
  db,
  mailbox,
  emailLike: "del-%@example.com",
});
const { signIn, send, seed, fingerprint, wipe } = fx;
const DAY = 24 * 60 * 60 * 1000;
const ms = (value: Date | null | undefined) => (value as Date).getTime();
const log = { info: vi.fn(), error: vi.fn() };
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
    marker: `DelMarker${name}`,
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
const remove = (person: { id: string }) =>
  send("DELETE", `/api/v1/users/${person.id}`, admin.cookie);
const restore = (id: string, cookie = admin.cookie) =>
  send("POST", `/api/v1/users/${id}/restore`, cookie);
const purge = (id: string, cookie = admin.cookie) =>
  send("DELETE", `/api/v1/users/${id}/purge`, cookie);
const deletedList = async () =>
  deletedUserListSchema.parse(
    (await send("GET", "/api/v1/users/deleted", admin.cookie)).json(),
  ).items;
const userRow = async (id: string) =>
  (await db.select().from(user).where(eq(user.id, id)))[0];
const ledgerRow = async (id: string) =>
  (await db.select().from(ledgers).where(eq(ledgers.id, id)))[0];

/** Moves a person's delete (and everything the delete stamped with the same moment) to another moment. */
async function setDeletedAt(id: string, when: Date) {
  const was = (await userRow(id))?.deletedAt as Date;
  const mine = await db
    .select({ ledgerId: ledgerMembers.ledgerId })
    .from(ledgerMembers)
    .where(eq(ledgerMembers.userId, id));
  const ledgerIds = mine.map((member) => member.ledgerId);
  await db.update(user).set({ deletedAt: when }).where(eq(user.id, id));
  await db
    .update(credentials)
    .set({ deletedAt: when })
    .where(and(eq(credentials.userId, id), eq(credentials.deletedAt, was)));
  await db
    .update(ledgerMembers)
    .set({ deletedAt: when })
    .where(and(eq(ledgerMembers.userId, id), eq(ledgerMembers.deletedAt, was)));
  if (ledgerIds.length)
    await db
      .update(ledgers)
      .set({ deletedAt: when })
      .where(and(inArray(ledgers.id, ledgerIds), eq(ledgers.deletedAt, was)));
}

/** How many rows a ledger has in every table that holds a ledger id (the ledger row itself is counted too). */
async function rowCounts(ledgerId: string) {
  const tables = await db.execute<{ table_name: string }>(
    sql`SELECT table_name FROM information_schema.columns WHERE table_schema='public' AND column_name='ledger_id' ORDER BY table_name`,
  );
  const counts: Record<string, number> = {};
  for (const { table_name: name } of tables.rows) {
    const found = await db.execute<{ n: number }>(
      sql`SELECT count(*)::int AS n FROM ${sql.identifier(name)} WHERE ledger_id = ${ledgerId}`,
    );
    counts[name] = found.rows[0]?.n ?? 0;
  }
  const own = await db.execute<{ n: number }>(
    sql`SELECT count(*)::int AS n FROM ledgers WHERE id = ${ledgerId}`,
  );
  counts.ledgers = own.rows[0]?.n ?? 0;
  return counts;
}
/** Rows that point at a person from anywhere in the account tables. */
async function accountRows(id: string, email: string) {
  const count = async (query: ReturnType<typeof sql>) =>
    (await db.execute<{ n: number }>(query)).rows[0]?.n ?? 0;
  return {
    users: await count(sql`SELECT count(*)::int n FROM users WHERE id = ${id}`),
    accounts: await count(
      sql`SELECT count(*)::int n FROM auth_accounts WHERE user_id = ${id}`,
    ),
    sessions: await count(
      sql`SELECT count(*)::int n FROM auth_sessions WHERE user_id = ${id}`,
    ),
    twoFactor: await count(
      sql`SELECT count(*)::int n FROM two_factor WHERE user_id = ${id}`,
    ),
    members: await count(
      sql`SELECT count(*)::int n FROM ledger_members WHERE user_id = ${id}`,
    ),
    verifications: await count(
      sql`SELECT count(*)::int n FROM auth_verifications WHERE lower(identifier) = lower(${email})`,
    ),
  };
}
const everything = (counts: Record<string, number>) =>
  Object.values(counts).reduce((total, n) => total + n, 0);

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

describe("the list of deleted people", () => {
  let ann: Person;
  let cy: Person;
  beforeAll(async () => {
    ann = await addPerson("list-ann", true);
    cy = await addPerson("list-cy", true);
  }, 120000);

  it("is for the admin only", async () => {
    const anonymous = await app.inject({
      method: "GET",
      url: "/api/v1/users/deleted",
    });
    expect(anonymous.statusCode).toBe(401);
    const person = await send("GET", "/api/v1/users/deleted", cy.cookie);
    expect(person.statusCode).toBe(403);
  });

  it("holds the people deleted in the last 30 days, newest first, and nobody else", async () => {
    expect(await deletedList()).toEqual([]);
    expect((await remove(ann)).statusCode).toBe(204);
    const items = await deletedList();
    expect(items.map((item) => item.id)).toEqual([ann.id]);
    const [item] = items;
    expect(Object.keys(item as object).sort()).toEqual([
      "deletedAt",
      "email",
      "id",
      "name",
      "purgeAt",
    ]);
    expect(item?.email).toBe(mailbox("list-ann"));
    expect(item?.name).toBe("Person list-ann");
    const deletedAt = Date.parse(item?.deletedAt as string);
    expect(deletedAt).toBe(ms((await userRow(ann.id))?.deletedAt));
    expect(Date.parse(item?.purgeAt as string)).toBe(
      deletedAt + RETENTION_DAYS * DAY,
    );
    expect(RETENTION_DAYS).toBe(30);
    // A live person is not on it, and the live list does not hold the deleted one.
    expect(items.some((entry) => entry.id === cy.id)).toBe(false);
    const live = idsOf(
      (await send("GET", "/api/v1/users", admin.cookie)).json(),
    );
    expect(live.some((entry) => entry === ann.id)).toBe(false);
    // Newest first.
    expect((await remove(cy)).statusCode).toBe(204);
    expect((await deletedList()).map((entry) => entry.id)).toEqual([
      cy.id,
      ann.id,
    ]);
  });

  it("does not list someone whose 30 days are over, even before the hourly job has removed them", async () => {
    await setDeletedAt(ann.id, new Date(Date.now() - 31 * DAY));
    expect((await deletedList()).map((entry) => entry.id)).toEqual([cy.id]);
  });

  it("returns account facts only: nothing from the ledger", async () => {
    const body = (await send("GET", "/api/v1/users/deleted", admin.cookie))
      .body;
    for (const secret of [cy.ledgerId, ann.ledgerId, cy.marker, ann.marker])
      expect(body).not.toContain(secret);
  });
});
const idsOf = (body: { items: { id: string }[] }) =>
  body.items.map((item) => item.id);

describe("restoring a person", () => {
  let ann: Person;
  let control: Person;
  let before: Record<string, string>;
  let oldCookie: string;
  beforeAll(async () => {
    ann = await addPerson("res-ann", true);
    control = await addPerson("res-control", true);
    oldCookie = ann.cookie;
    before = await fingerprint(ann.ledgerId);
  }, 120000);

  it("brings back the person, the sign-in and the ledger exactly as they were", async () => {
    // Something deleted earlier and separately must stay deleted.
    const earlier = new Date(Date.now() - 3 * DAY);
    await db.insert(credentials).values({
      userId: ann.id,
      accountId: `${ann.id}-old`,
      providerId: "old-provider",
      deletedAt: earlier,
    });
    // A ledger of theirs deleted earlier, and a membership ended earlier, stay as they were too.
    const earlierLedger = newId();
    const endedLedger = newId();
    await db.insert(ledgers).values([
      { id: earlierLedger, name: "Earlier", deletedAt: earlier },
      { id: endedLedger, name: "Ended" },
    ]);
    await db.insert(ledgerMembers).values([
      { ledgerId: earlierLedger, userId: ann.id, role: "owner" },
      {
        ledgerId: endedLedger,
        userId: ann.id,
        role: "viewer",
        deletedAt: earlier,
      },
    ]);
    const controlBefore = await fingerprint(control.ledgerId);
    expect((await remove(ann)).statusCode).toBe(204);
    const deletedAt = (await userRow(ann.id))?.deletedAt as Date;
    expect(deletedAt).not.toBeNull();
    // Someone else whose sign-in and membership carry exactly the same moment is not part of this delete.
    await db
      .update(credentials)
      .set({ deletedAt })
      .where(eq(credentials.userId, control.id));
    await db
      .update(ledgerMembers)
      .set({ deletedAt })
      .where(eq(ledgerMembers.userId, control.id));
    await db
      .update(ledgers)
      .set({ deletedAt })
      .where(eq(ledgers.id, control.ledgerId));
    const response = await restore(ann.id);
    expect(response.statusCode, response.body).toBe(200);
    expect((await ledgerRow(control.ledgerId))?.deletedAt).not.toBeNull();
    const restored = managedUserSchema.parse(response.json());
    expect(restored.id).toBe(ann.id);
    expect(restored.email).toBe(mailbox("res-ann"));
    expect(restored.disabled).toBe(false);
    const row = await userRow(ann.id);
    expect(row?.deletedAt).toBeNull();
    expect(ms(row?.updatedAt)).toBeGreaterThanOrEqual(deletedAt.getTime());
    // The ledger row is live again and is the same ledger.
    const ledger = await ledgerRow(ann.ledgerId);
    expect(ledger?.deletedAt).toBeNull();
    expect(ledger?.name).toBe("Personal ledger");
    expect(ms(ledger?.updatedAt)).toBeGreaterThanOrEqual(deletedAt.getTime());
    const [member] = await db
      .select()
      .from(ledgerMembers)
      .where(
        and(
          eq(ledgerMembers.userId, ann.id),
          eq(ledgerMembers.ledgerId, ann.ledgerId),
        ),
      );
    expect(member?.deletedAt).toBeNull();
    expect(member?.role).toBe("owner");
    expect(ms(member?.updatedAt)).toBeGreaterThanOrEqual(deletedAt.getTime());
    // Every row of money data is byte for byte what it was; so is the other person's ledger.
    const after = await fingerprint(ann.ledgerId);
    for (const name of Object.keys(before))
      if (name !== "ledgers" && name !== "ledger_members")
        expect(after[name], name).toBe(before[name]);
    const controlAfter = await fingerprint(control.ledgerId);
    for (const name of Object.keys(controlBefore))
      if (name !== "ledgers" && name !== "ledger_members")
        expect(controlAfter[name], name).toBe(controlBefore[name]);
    const signIns = await db
      .select()
      .from(credentials)
      .where(eq(credentials.userId, ann.id));
    expect(
      signIns.find((row) => row.providerId === "credential")?.deletedAt,
    ).toBeNull();
    for (const table of [credentials, ledgerMembers]) {
      const theirs = await db
        .select()
        .from(table)
        .where(eq(table.userId, control.id));
      expect(theirs.every((row) => row.deletedAt !== null)).toBe(true);
    }
    expect(ms((await ledgerRow(earlierLedger))?.deletedAt)).toBe(
      earlier.getTime(),
    );
    const memberships = await db
      .select()
      .from(ledgerMembers)
      .where(eq(ledgerMembers.userId, ann.id));
    const ended = memberships.find((row) => row.ledgerId === endedLedger);
    expect(ms(ended?.deletedAt)).toBe(earlier.getTime());
    expect(
      memberships.find((row) => row.ledgerId === earlierLedger)?.deletedAt,
    ).toBeNull();
    // The earlier, separate delete was not undone.
    const [old] = await db
      .select()
      .from(credentials)
      .where(eq(credentials.accountId, `${ann.id}-old`));
    expect(ms(old?.deletedAt)).toBe(earlier.getTime());
    // And it is the list's business: on the live list, off the deleted one.
    expect((await deletedList()).some((entry) => entry.id === ann.id)).toBe(
      false,
    );
    const live = (await send("GET", "/api/v1/users", admin.cookie)).json();
    expect(idsOf(live)).toContain(ann.id);
  });

  it("keeps the same password, and the old sessions stay ended: they sign in again", async () => {
    const stale = await send(
      "GET",
      `/api/v1/ledgers/${ann.ledgerId}/accounts`,
      oldCookie,
    );
    expect(stale.statusCode).toBe(401);
    const fresh = await signIn(mailbox("res-ann"), own);
    const read = await send(
      "GET",
      `/api/v1/ledgers/${ann.ledgerId}/accounts`,
      fresh,
    );
    expect(read.statusCode).toBe(200);
    expect(read.body).toContain(ann.marker);
    const sessions = await db
      .select()
      .from(session)
      .where(and(eq(session.userId, ann.id), isNull(session.deletedAt)));
    expect(sessions.length).toBe(1);
  });

  it("keeps what the person already was: stopped stays stopped, a temporary password stays temporary", async () => {
    const added = await send("POST", "/api/v1/users", admin.cookie, {
      name: "Person res-fay",
      email: mailbox("res-fay"),
      temporaryPassword: temporary,
    });
    const fay = managedUserSchema.parse(added.json());
    expect(
      (
        await send("PATCH", `/api/v1/users/${fay.id}`, admin.cookie, {
          disabled: true,
        })
      ).statusCode,
    ).toBe(200);
    expect((await remove(fay)).statusCode).toBe(204);
    const restored = managedUserSchema.parse((await restore(fay.id)).json());
    expect(restored.disabled).toBe(true);
    expect(restored.mustChangePassword).toBe(true);
    const refused = await app.inject({
      method: "POST",
      url: "/api/v1/auth/sign-in/email",
      headers: {
        origin: config.APP_URL,
        "x-forwarded-for": "198.51.100.250",
      },
      payload: { email: mailbox("res-fay"), password: temporary },
    });
    expect(refused.statusCode).toBe(401);
  });

  it("refuses what cannot be restored", async () => {
    const live = await addPerson("res-live");
    expect((await restore(live.id)).statusCode).toBe(404);
    expect((await restore(newId())).statusCode).toBe(404);
    expect((await restore(admin.id)).statusCode).toBe(409);
    expect((await restore(live.id, live.cookie)).statusCode).toBe(403);
    const anonymous = await app.inject({
      method: "POST",
      url: `/api/v1/users/${live.id}/restore`,
      headers: { origin: config.APP_URL },
    });
    expect(anonymous.statusCode).toBe(401);
    const foreign = await app.inject({
      method: "POST",
      url: `/api/v1/users/${live.id}/restore`,
      headers: { origin: "http://attacker.example.com", cookie: admin.cookie },
    });
    expect(foreign.statusCode).toBe(403);
    // Twice: the second finds nobody deleted.
    expect((await remove(live)).statusCode).toBe(204);
    expect((await restore(live.id)).statusCode).toBe(200);
    expect((await restore(live.id)).statusCode).toBe(404);
  });

  it("is too late after 30 days, to the millisecond", async () => {
    const late = await addPerson("res-late");
    expect((await remove(late)).statusCode).toBe(204);
    await setDeletedAt(late.id, new Date(Date.now() - RETENTION_DAYS * DAY));
    expect((await restore(late.id)).statusCode).toBe(404);
    expect((await userRow(late.id))?.deletedAt).not.toBeNull();
    const nearly = await addPerson("res-nearly");
    expect((await remove(nearly)).statusCode).toBe(204);
    await setDeletedAt(
      nearly.id,
      new Date(Date.now() - RETENTION_DAYS * DAY + 60_000),
    );
    expect((await restore(nearly.id)).statusCode).toBe(200);
  });
});

describe("deleting a person at once", () => {
  let bob: Person;
  let cy: Person;
  let cyBefore: Record<string, string>;
  beforeAll(async () => {
    bob = await addPerson("now-bob", true);
    cy = await addPerson("now-cy", true);
    cyBefore = await fingerprint(cy.ledgerId);
  }, 120000);

  it("covers every table that holds a ledger or a person, so nothing is left behind", async () => {
    const found = await db.execute<{ name: string }>(sql`
      SELECT table_name AS name FROM information_schema.columns
        WHERE table_schema = 'public' AND column_name = 'ledger_id'
      UNION
      SELECT c.conrelid::regclass::text AS name FROM pg_constraint c
        JOIN pg_namespace n ON n.oid = c.connamespace
        WHERE c.contype = 'f' AND n.nspname = 'public'
          AND c.confrelid IN ('public.ledgers'::regclass, 'public.users'::regclass)`);
    const personLevel = [
      "ledgers",
      "users",
      "auth_accounts",
      "auth_sessions",
      "two_factor",
    ];
    const handled = new Set([...PURGED_TABLES, ...personLevel]);
    const missing = found.rows
      .map((row) => row.name)
      .filter((name) => !handled.has(name));
    expect(missing).toEqual([]);
    // And every name it lists is a real table, so a typo cannot hide a gap.
    const real = await db.execute<{ table_name: string }>(
      sql`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`,
    );
    const names = new Set(real.rows.map((row) => row.table_name));
    for (const name of PURGED_TABLES) expect(names.has(name), name).toBe(true);
  });

  it("removes the person and everything of theirs for good, and nothing of anyone else's", async () => {
    const counts = await rowCounts(bob.ledgerId);
    // The proof means something only if the person had data in every kind of table.
    for (const name of PURGED_TABLES)
      expect(counts[name], name).toBeGreaterThan(0);
    // Their two-factor secret, and a verification row of somebody else that must stay.
    const strangers = (await accountRows(cy.id, mailbox("now-cy")))
      .verifications;
    await db.execute(
      sql`INSERT INTO two_factor (id, user_id, secret, backup_codes) VALUES (${newId()}, ${bob.id}, 'placeholder-secret', 'placeholder-codes')`,
    );
    await db.execute(
      sql`INSERT INTO auth_verifications (id, identifier, value, expires_at) VALUES (${newId()}, ${mailbox("now-cy")}, 'x', now() + interval '1 hour')`,
    );
    expect((await remove(bob)).statusCode).toBe(204);
    const response = await purge(bob.id);
    expect(response.statusCode, response.body).toBe(204);
    expect((await accountRows(cy.id, mailbox("now-cy"))).verifications).toBe(
      strangers + 1,
    );
    expect(everything(await rowCounts(bob.ledgerId))).toBe(0);
    expect(await accountRows(bob.id, mailbox("now-bob"))).toEqual({
      users: 0,
      accounts: 0,
      sessions: 0,
      twoFactor: 0,
      members: 0,
      verifications: 0,
    });
    expect(await fingerprint(cy.ledgerId)).toEqual(cyBefore);
    const stillOpen = await send(
      "GET",
      `/api/v1/ledgers/${cy.ledgerId}/accounts`,
      cy.cookie,
    );
    expect(stillOpen.statusCode).toBe(200);
    expect(stillOpen.body).toContain(cy.marker);
    expect((await deletedList()).some((entry) => entry.id === bob.id)).toBe(
      false,
    );
  });

  it("frees the email and the person cannot sign in", async () => {
    const refused = await app.inject({
      method: "POST",
      url: "/api/v1/auth/sign-in/email",
      headers: {
        origin: config.APP_URL,
        "x-forwarded-for": "198.51.100.251",
      },
      payload: { email: mailbox("now-bob"), password: own },
    });
    expect(refused.statusCode).toBe(401);
    const again = await send("POST", "/api/v1/users", admin.cookie, {
      name: "Person now-bob again",
      email: mailbox("now-bob"),
      temporaryPassword: temporary,
    });
    expect(again.statusCode, again.body).toBe(201);
    const made = managedUserSchema.parse(again.json());
    expect(made.id).not.toBe(bob.id);
    // They start empty: nothing of the old person came back with the email.
    const [member] = await db
      .select()
      .from(ledgerMembers)
      .where(eq(ledgerMembers.userId, made.id));
    const counts = await rowCounts(member?.ledgerId as string);
    expect(counts.accounts).toBe(0);
    expect(counts.transactions).toBe(0);
  });

  it("removes a person verification rows too", async () => {
    const dana = await addPerson("now-dana");
    await db.execute(
      sql`INSERT INTO auth_verifications (id, identifier, value, expires_at) VALUES (${newId()}, ${mailbox("NOW-DANA")}, 'x', now() + interval '1 hour')`,
    );
    expect((await remove(dana)).statusCode).toBe(204);
    expect((await purge(dana.id)).statusCode).toBe(204);
    expect(
      (await accountRows(dana.id, mailbox("now-dana"))).verifications,
    ).toBe(0);
  });

  it("answers 404 unless the person is in Recently deleted, and refuses the admin", async () => {
    const live = await addPerson("now-live");
    expect((await purge(live.id)).statusCode).toBe(404);
    expect((await userRow(live.id))?.deletedAt).toBeNull();
    expect((await purge(newId())).statusCode).toBe(404);
    expect((await purge(bob.id)).statusCode).toBe(404);
    expect((await purge(admin.id)).statusCode).toBe(409);
    expect((await purge(live.id, live.cookie)).statusCode).toBe(403);
    const anonymous = await app.inject({
      method: "DELETE",
      url: `/api/v1/users/${live.id}/purge`,
      headers: { origin: config.APP_URL },
    });
    expect(anonymous.statusCode).toBe(401);
    const foreign = await app.inject({
      method: "DELETE",
      url: `/api/v1/users/${live.id}/purge`,
      headers: { origin: "http://attacker.example.com", cookie: admin.cookie },
    });
    expect(foreign.statusCode).toBe(403);
    expect((await userRow(admin.id))?.deletedAt).toBeNull();
  });

  it("also deletes someone whose 30 days are over but whom the hourly job has not reached yet", async () => {
    const old = await addPerson("now-old");
    expect((await remove(old)).statusCode).toBe(204);
    await setDeletedAt(old.id, new Date(Date.now() - 40 * DAY));
    expect((await purge(old.id)).statusCode).toBe(204);
    expect(await userRow(old.id)).toBeUndefined();
  });
});

describe("the email of a deleted person", () => {
  it("says to restore them while that is possible, and after that to try again soon", async () => {
    const gone = await addPerson("mail-gone");
    expect((await remove(gone)).statusCode).toBe(204);
    await setDeletedAt(gone.id, new Date(Date.now() - 7 * DAY - 60_000));
    const taken = await send("POST", "/api/v1/users", admin.cookie, {
      name: "Someone else",
      email: mailbox("MAIL-GONE"),
      temporaryPassword: temporary,
    });
    expect(taken.statusCode).toBe(409);
    expect(taken.json().detail).toBe(
      "That person was deleted. Restore them from Recently deleted (23 days left), or use another email.",
    );
    expect(taken.body).not.toContain(gone.id);
    await setDeletedAt(gone.id, new Date(Date.now() - 31 * DAY));
    const late = await send("POST", "/api/v1/users", admin.cookie, {
      name: "Someone else",
      email: mailbox("mail-gone"),
      temporaryPassword: temporary,
    });
    expect(late.statusCode).toBe(409);
    expect(late.json().detail).toBe(
      "That person was deleted and is being removed. Try again in a little while, or use another email.",
    );
  });

  it("says 1 day left, not 1 days, on the last day", async () => {
    const last = await addPerson("mail-last");
    expect((await remove(last)).statusCode).toBe(204);
    await setDeletedAt(last.id, new Date(Date.now() - 29.5 * DAY));
    const taken = await send("POST", "/api/v1/users", admin.cookie, {
      name: "Someone else",
      email: mailbox("mail-last"),
      temporaryPassword: temporary,
    });
    expect(taken.statusCode).toBe(409);
    expect(taken.json().detail).toBe(
      "That person was deleted. Restore them from Recently deleted (1 day left), or use another email.",
    );
  });

  it("still says what it always said for a live person's email", async () => {
    const live = await addPerson("mail-live");
    const taken = await send("POST", "/api/v1/users", admin.cookie, {
      name: "Someone else",
      email: live.cookie ? mailbox("mail-live") : "",
      temporaryPassword: temporary,
    });
    expect(taken.statusCode).toBe(409);
    expect(taken.json().detail).toBe(
      "Someone already has that email. Reset that person's password instead.",
    );
  });
});

describe("the hourly purge", () => {
  const now = new Date("2026-12-15T12:00:00.000Z");
  it("removes people whose 30 days are over, to the millisecond, and leaves everyone else", async () => {
    log.info.mockClear();
    // Anyone left over from the tests above whose 30 days are over at this clock goes first.
    await purgeDeletedPeople(db, now, log);
    log.info.mockClear();
    log.error.mockClear();
    const control = await addPerson("tick-control", true);
    const controlBefore = await fingerprint(control.ledgerId);
    const due = await addPerson("tick-due", true);
    const exact = await addPerson("tick-exact");
    const nearly = await addPerson("tick-nearly");
    const recent = await addPerson("tick-recent", true);
    for (const person of [due, exact, nearly, recent])
      expect((await remove(person)).statusCode).toBe(204);
    await setDeletedAt(due.id, new Date(now.getTime() - 31 * DAY));
    await setDeletedAt(
      exact.id,
      new Date(now.getTime() - RETENTION_DAYS * DAY),
    );
    await setDeletedAt(
      nearly.id,
      new Date(now.getTime() - RETENTION_DAYS * DAY + 1),
    );
    await setDeletedAt(recent.id, new Date(now.getTime() - 2 * DAY));
    const recentBefore = await fingerprint(recent.ledgerId);
    const result = await purgeDeletedPeople(db, now, log);
    expect(result).toEqual({ purged: 2, failed: 0 });
    expect(await userRow(due.id)).toBeUndefined();
    expect(await userRow(exact.id)).toBeUndefined();
    expect(everything(await rowCounts(due.ledgerId))).toBe(0);
    expect((await userRow(nearly.id))?.deletedAt).not.toBeNull();
    expect((await userRow(recent.id))?.deletedAt).not.toBeNull();
    // A person still within the 30 days keeps every row, and a live person is not touched at all.
    expect(await fingerprint(control.ledgerId)).toEqual(controlBefore);
    for (const name of Object.keys(recentBefore))
      if (name !== "ledgers" && name !== "ledger_members")
        expect((await fingerprint(recent.ledgerId))[name], name).toBe(
          recentBefore[name],
        );
    expect((await restore(recent.id)).statusCode).toBe(200);
    // Counts only in the log: no name, email, id or ledger.
    const logged = JSON.stringify([
      ...log.info.mock.calls,
      ...log.error.mock.calls,
    ]);
    expect(log.info).toHaveBeenCalledTimes(1);
    expect(logged).toContain('"purged":2');
    for (const secret of [
      due.id,
      due.ledgerId,
      mailbox("tick-due"),
      "Person tick-due",
      due.marker,
    ])
      expect(logged).not.toContain(secret);
    // Nothing is left to do the second time.
    expect(await purgeDeletedPeople(db, now, log)).toEqual({
      purged: 0,
      failed: 0,
    });
  }, 120000);

  it("never removes the admin, however old a delete it finds", async () => {
    const second = await db.transaction((tx) =>
      createAccount(tx, {
        email: mailbox("second-admin"),
        name: "second admin",
        password: own,
        isAdmin: true,
      }),
    );
    await db
      .update(user)
      .set({ deletedAt: new Date(now.getTime() - 90 * DAY) })
      .where(eq(user.id, second.userId));
    expect(await purgeDeletedPeople(db, now, log)).toEqual({
      purged: 0,
      failed: 0,
    });
    expect(await userRow(second.userId)).toBeDefined();
  });

  it("one person it cannot remove does not stop the others, and loses nothing of theirs", async () => {
    log.info.mockClear();
    log.error.mockClear();
    const keeper = await addPerson("tick-keeper", true);
    const stuck = await addPerson("tick-stuck", true);
    const next = await addPerson("tick-next");
    for (const person of [stuck, next])
      expect((await remove(person)).statusCode).toBe(204);
    // Something in a ledger that stays still points at the stuck person, so removing them is refused by the database.
    await db.insert(writeReceipts).values({
      ledgerId: keeper.ledgerId,
      actorId: stuck.id,
      key: `stuck-key-${newId()}`.slice(0, 40),
      requestHash: "a".repeat(64),
      responseStatus: 200,
    });
    await setDeletedAt(stuck.id, new Date(now.getTime() - 50 * DAY));
    await setDeletedAt(next.id, new Date(now.getTime() - 40 * DAY));
    const stuckBefore = await fingerprint(stuck.ledgerId);
    const result = await purgeDeletedPeople(db, now, log);
    expect(result).toEqual({ purged: 1, failed: 1 });
    expect(await userRow(next.id)).toBeUndefined();
    // The failed one is whole: nothing was half removed.
    expect(await userRow(stuck.id)).toBeDefined();
    expect(await fingerprint(stuck.ledgerId)).toEqual(stuckBefore);
    expect(log.error).toHaveBeenCalledTimes(1);
    const logged = JSON.stringify(log.error.mock.calls);
    for (const secret of [stuck.id, stuck.ledgerId, mailbox("tick-stuck")])
      expect(logged).not.toContain(secret);
    // Cleared by hand, the next hour finishes it.
    await db.delete(writeReceipts).where(eq(writeReceipts.actorId, stuck.id));
    expect(await purgeDeletedPeople(db, now, log)).toEqual({
      purged: 1,
      failed: 0,
    });
    expect(await userRow(stuck.id)).toBeUndefined();
  }, 120000);
});

describe("a restore and a purge at the same moment", () => {
  it("leave exactly one winner and a person who is whole either way", async () => {
    const outcomes = new Set<string>();
    for (let round = 0; round < 6; round++) {
      const person = await addPerson(`race-${round}`);
      expect((await remove(person)).statusCode).toBe(204);
      const [restored, purged] = await Promise.all([
        restore(person.id),
        purge(person.id),
      ]);
      const row = await userRow(person.id);
      if (restored.statusCode === 200) {
        outcomes.add("restored");
        expect(purged.statusCode).toBe(404);
        expect(row?.deletedAt).toBeNull();
        expect((await ledgerRow(person.ledgerId))?.deletedAt).toBeNull();
        const members = await db
          .select()
          .from(ledgerMembers)
          .where(
            and(
              eq(ledgerMembers.userId, person.id),
              isNull(ledgerMembers.deletedAt),
            ),
          );
        expect(members).toHaveLength(1);
      } else {
        outcomes.add("removed");
        expect(restored.statusCode).toBe(404);
        expect(purged.statusCode).toBe(204);
        expect(row).toBeUndefined();
        expect(await ledgerRow(person.ledgerId)).toBeUndefined();
      }
    }
    expect(outcomes.size).toBeGreaterThan(0);
  }, 120000);
});

describe("the admin routes for deleted people return no ledger data", () => {
  it("answers with account facts or nothing", async () => {
    const person = await addPerson("data-person", true);
    expect((await remove(person)).statusCode).toBe(204);
    const list = (await send("GET", "/api/v1/users/deleted", admin.cookie))
      .body;
    const back = await restore(person.id);
    expect((await remove(person)).statusCode).toBe(204);
    const gone = await purge(person.id);
    for (const body of [list, back.body, gone.body])
      for (const secret of [
        person.ledgerId,
        person.marker,
        ...Object.values(person.ids),
      ])
        expect(body).not.toContain(secret);
  }, 120000);
});

describe("what a delete for good leaves alone", () => {
  it("keeps a ledger another live person is still a member of, and removes the person's own", async () => {
    const host = await addPerson("keep-host", true);
    const guest = await addPerson("keep-guest", true);
    await db
      .insert(ledgerMembers)
      .values({ ledgerId: host.ledgerId, userId: guest.id, role: "editor" });
    const before = await fingerprint(host.ledgerId);
    expect((await remove(guest)).statusCode).toBe(204);
    expect((await purge(guest.id)).statusCode).toBe(204);
    const after = await fingerprint(host.ledgerId);
    for (const name of Object.keys(before))
      if (name !== "ledgers" && name !== "ledger_members")
        expect(after[name], name).toBe(before[name]);
    expect(await ledgerRow(host.ledgerId)).toBeDefined();
    const members = await db
      .select()
      .from(ledgerMembers)
      .where(eq(ledgerMembers.ledgerId, host.ledgerId));
    expect(members.map((row) => row.userId)).toEqual([host.id]);
    expect(everything(await rowCounts(guest.ledgerId))).toBe(0);
  });

  it("does not let someone whose own membership was ended keep a ledger alive", async () => {
    const owner = await addPerson("keep-owner", true);
    const other = await addPerson("keep-other", true);
    await db.insert(ledgerMembers).values({
      ledgerId: owner.ledgerId,
      userId: other.id,
      role: "viewer",
      deletedAt: new Date(Date.now() - DAY),
    });
    const otherBefore = await fingerprint(other.ledgerId);
    expect((await remove(owner)).statusCode).toBe(204);
    expect((await purge(owner.id)).statusCode).toBe(204);
    expect(everything(await rowCounts(owner.ledgerId))).toBe(0);
    expect(await userRow(other.id)).toBeDefined();
    expect(await fingerprint(other.ledgerId)).toEqual(otherBefore);
  });

  it("says so, and removes nothing, when something in a ledger that stays still points at the person", async () => {
    const host = await addPerson("pin-host", true);
    const pinned = await addPerson("pin-person", true);
    await db.insert(writeReceipts).values({
      ledgerId: host.ledgerId,
      actorId: pinned.id,
      key: `pinned-key-${newId()}`.slice(0, 40),
      requestHash: "b".repeat(64),
      responseStatus: 200,
    });
    const before = await fingerprint(pinned.ledgerId);
    expect((await remove(pinned)).statusCode).toBe(204);
    const refused = await purge(pinned.id);
    expect(refused.statusCode).toBe(409);
    expect(refused.json().detail).toBe(
      "This person still has data in a ledger that other people use.",
    );
    expect(await userRow(pinned.id)).toBeDefined();
    const after = await fingerprint(pinned.ledgerId);
    for (const name of Object.keys(before))
      if (name !== "ledgers" && name !== "ledger_members")
        expect(after[name], name).toBe(before[name]);
    // Let go of what pinned them, so the hourly job's later runs in this file are not held up by them.
    await db.delete(writeReceipts).where(eq(writeReceipts.actorId, pinned.id));
    expect((await purge(pinned.id)).statusCode).toBe(204);
  });

  it("never restores or removes a second admin, however it was deleted", async () => {
    const second = await db.transaction((tx) =>
      createAccount(tx, {
        email: mailbox("guard-admin"),
        name: "guard admin",
        password: own,
        isAdmin: true,
      }),
    );
    await db
      .update(user)
      .set({ deletedAt: new Date() })
      .where(eq(user.id, second.userId));
    expect((await restore(second.userId)).statusCode).toBe(404);
    expect((await purge(second.userId)).statusCode).toBe(404);
    expect(await userRow(second.userId)).toBeDefined();
  });
});

describe("two things at the same moment wait for each other", () => {
  const sleep = (ms: number) =>
    new Promise((resolve) => setTimeout(resolve, ms));
  /** Holds the person's row locked while `act` runs, and says whether `act` had to wait for the lock. */
  async function whileLocked<T>(
    id: string,
    start: () => Promise<T>,
    during?: (
      tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
    ) => Promise<unknown>,
  ) {
    let settled = false;
    let result!: Promise<T>;
    await db.transaction(async (tx) => {
      await tx.select().from(user).where(eq(user.id, id)).for("update");
      result = start().finally(() => {
        settled = true;
      });
      await sleep(400);
      expect(settled, "it went ahead without waiting for the lock").toBe(false);
      if (during) await during(tx);
    });
    return result;
  }

  it("a restore waits for whoever holds the person", async () => {
    const person = await addPerson("lock-restore");
    expect((await remove(person)).statusCode).toBe(204);
    const response = await whileLocked(person.id, () => restore(person.id));
    expect(response.statusCode).toBe(200);
  });

  it("a delete now waits for whoever holds the person", async () => {
    const person = await addPerson("lock-purge");
    expect((await remove(person)).statusCode).toBe(204);
    const response = await whileLocked(person.id, () => purge(person.id));
    expect(response.statusCode).toBe(204);
  });

  it("the hourly job looks again once it has the person, so a restore that got there first wins", async () => {
    const now = new Date("2027-02-01T12:00:00.000Z");
    await purgeDeletedPeople(db, now, log);
    const person = await addPerson("lock-hourly", true);
    expect((await remove(person)).statusCode).toBe(204);
    await setDeletedAt(person.id, new Date(now.getTime() - 40 * DAY));
    const before = await fingerprint(person.ledgerId);
    const result = await whileLocked(
      person.id,
      () => purgeDeletedPeople(db, now, log),
      // The restore, inside the lock: the person is live again when the job gets its turn.
      async (tx) => {
        await tx
          .update(user)
          .set({ deletedAt: null })
          .where(eq(user.id, person.id));
      },
    );
    expect(result).toEqual({ purged: 0, failed: 0 });
    expect((await userRow(person.id))?.deletedAt).toBeNull();
    const after = await fingerprint(person.ledgerId);
    for (const name of Object.keys(before))
      if (name !== "ledgers" && name !== "ledger_members")
        expect(after[name], name).toBe(before[name]);
  }, 120000);
});
