import { newId } from "@ledgerline/shared";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../../app";
import type { Database } from "../../db/client";
import { createDatabase } from "../../db/client";
import { applyMigrations } from "../../db/migrate";
import {
  account as credentials,
  ledgerMembers,
  ledgers,
  session,
  user,
} from "../../db/schema";
import { requireTestDatabase, testConfig } from "../../test-support/harness";
import { createAccount } from "./accounts";
import { provisionOwner } from "./owner";

// ADR 0048: one function makes an account the way the first run does: a person, a password and a ledger of their own.
const url = requireTestDatabase("Account creation tests");
const config = testConfig(url, "create");
const { db, pool } = createDatabase(url);
const app = await buildApp(db, config);
const made: string[] = [];

beforeAll(async () => {
  await applyMigrations(url);
  await app.ready();
});
afterAll(async () => {
  if (made.length) {
    const members = await db
      .select()
      .from(ledgerMembers)
      .where(inArray(ledgerMembers.userId, made));
    await db.delete(session).where(inArray(session.userId, made));
    await db.delete(ledgerMembers).where(inArray(ledgerMembers.userId, made));
    await db.delete(ledgers).where(
      inArray(
        ledgers.id,
        members.map((member) => member.ledgerId),
      ),
    );
    await db.delete(credentials).where(inArray(credentials.userId, made));
    await db.delete(user).where(inArray(user.id, made));
  }
  await app.close();
  await pool.end();
});

const create = (input: Partial<Parameters<typeof createAccount>[1]> = {}) =>
  db.transaction((tx) =>
    createAccount(tx, {
      email: `create-${newId()}@example.com`,
      name: "New person",
      password: "A-temporary-password-1",
      ...input,
    }),
  );

describe("creating an account", () => {
  it("makes a person, a password sign-in, a ledger in USD and an owner membership", async () => {
    const email = `Create-${newId()}@Example.com`;
    const { userId, ledgerId } = await create({ email });
    made.push(userId);
    const [person] = await db.select().from(user).where(eq(user.id, userId));
    expect(person).toMatchObject({
      email: email.toLowerCase(),
      name: "New person",
      emailVerified: true,
      isAdmin: false,
      mustChangePassword: false,
      disabledAt: null,
      deletedAt: null,
    });
    const [ledger] = await db
      .select()
      .from(ledgers)
      .where(eq(ledgers.id, ledgerId));
    expect(ledger).toMatchObject({
      name: "Personal ledger",
      baseCurrency: "USD",
    });
    const members = await db
      .select()
      .from(ledgerMembers)
      .where(eq(ledgerMembers.userId, userId));
    expect(members).toHaveLength(1);
    expect(members[0]).toMatchObject({ ledgerId, role: "owner" });
    const [login] = await db
      .select()
      .from(credentials)
      .where(
        and(eq(credentials.userId, userId), isNull(credentials.deletedAt)),
      );
    expect(login?.providerId).toBe("credential");
    expect(login?.password).toMatch(/^\$argon2id\$/);
    expect(login?.password).not.toContain("temporary");
  });

  it("can flag the person for a first-sign-in change and can sign them in", async () => {
    const email = `create-${newId()}@example.com`;
    const { userId } = await create({ email, mustChangePassword: true });
    made.push(userId);
    const [person] = await db.select().from(user).where(eq(user.id, userId));
    expect(person?.mustChangePassword).toBe(true);
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/sign-in/email",
      headers: { origin: config.APP_URL, "x-forwarded-for": "198.51.100.77" },
      payload: { email, password: "A-temporary-password-1" },
    });
    expect(response.statusCode, response.body).toBe(200);
  });

  it("gives every account its own ledger, so two people never share one", async () => {
    const first = await create();
    const second = await create();
    made.push(first.userId, second.userId);
    expect(first.ledgerId).not.toBe(second.ledgerId);
    const rows = await db
      .select()
      .from(ledgerMembers)
      .where(inArray(ledgerMembers.userId, [first.userId, second.userId]));
    expect(rows.map((row) => row.ledgerId).sort()).toEqual(
      [first.ledgerId, second.ledgerId].sort(),
    );
  });

  it("can make the admin, and makes nothing at all when the email is taken", async () => {
    const email = `create-${newId()}@example.com`;
    const { userId } = await create({ email, isAdmin: true });
    made.push(userId);
    const [person] = await db.select().from(user).where(eq(user.id, userId));
    expect(person?.isAdmin).toBe(true);
    const ledgersBefore = await db.select().from(ledgers);
    await expect(create({ email })).rejects.toThrow();
    expect((await db.select().from(ledgers)).length).toBe(ledgersBefore.length);
  });

  it("refuses a password the sign-in would refuse, and makes nothing", async () => {
    const before = (await db.select().from(user)).length;
    for (const password of ["short", "x".repeat(129)])
      await expect(create({ password })).rejects.toThrow(/12 to 128/);
    expect((await db.select().from(user)).length).toBe(before);
  });
});

class Rollback extends Error {}

describe("the first run of a new installation", () => {
  it("makes the configured owner the admin straight away, in one start", async () => {
    // Inside a transaction that is always rolled back: the table is emptied only for this check.
    await expect(
      db.transaction(async (tx) => {
        await tx.execute(
          sql`TRUNCATE auth_sessions, auth_accounts, auth_verifications, ledger_members, ledgers, users CASCADE`,
        );
        await provisionOwner(
          {
            transaction: (run: Parameters<typeof tx.transaction>[0]) =>
              tx.transaction(run),
          } as unknown as Database,
          config,
        );
        const rows = await tx.select().from(user);
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
          email: config.OWNER_EMAIL.toLowerCase(),
          isAdmin: true,
          mustChangePassword: false,
          disabledAt: null,
        });
        throw new Rollback();
      }),
    ).rejects.toBeInstanceOf(Rollback);
  });
});
