import { newId } from "@ledgerline/shared";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../../app";
import { createDatabase } from "../../db/client";
import { applyMigrations } from "../../db/migrate";
import { account as credentials, session, user } from "../../db/schema";
import {
  requireTestDatabase,
  seedUser,
  testConfig,
} from "../../test-support/harness";
import { resetPassword } from "./reset-password";

// ADR 0048: the server administrator's way back in when the admin has forgotten the password they chose in the app.
const url = requireTestDatabase("Password reset tests");
const config = testConfig(url, "reset");
const { db, pool } = createDatabase(url);
const app = await buildApp(db, config);
const people = {
  admin: { id: newId(), email: "reset-person-admin@example.com" },
  gone: { id: newId(), email: "reset-person-gone@example.com" },
};

async function signIn(email: string, password: string) {
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/auth/sign-in/email",
    headers: {
      origin: config.APP_URL,
      "x-forwarded-for": `198.51.100.${Math.floor(Math.random() * 200) + 1}`,
    },
    payload: { email, password },
  });
  const header = response.headers["set-cookie"];
  return {
    status: response.statusCode,
    cookie: (Array.isArray(header) ? header : [String(header ?? "")])
      .map((value) => value.split(";")[0])
      .join("; "),
  };
}

beforeAll(async () => {
  await applyMigrations(url);
  for (const person of Object.values(people))
    await seedUser(db, config, { ...person });
  await db
    .update(user)
    .set({ deletedAt: new Date() })
    .where(eq(user.id, people.gone.id));
  await app.ready();
});
afterAll(async () => {
  const ids = Object.values(people).map((person) => person.id);
  await db.delete(session).where(inArray(session.userId, ids));
  await db.delete(credentials).where(inArray(credentials.userId, ids));
  await db.delete(user).where(inArray(user.id, ids));
  await app.close();
  await pool.end();
});

describe("resetting a password from the server", () => {
  it("sets a temporary password that must be changed, ends every session and returns how many", async () => {
    const before = await signIn(people.admin.email, config.OWNER_PASSWORD);
    expect(before.status).toBe(200);
    await signIn(people.admin.email, config.OWNER_PASSWORD);
    const result = await resetPassword(
      db,
      people.admin.email,
      "Server-chosen-temporary-1",
    );
    expect(result).toEqual({ sessionsEnded: 2 });
    expect(
      (
        await app.inject({
          url: "/api/v1/auth/get-session",
          headers: { cookie: before.cookie },
        })
      ).body,
    ).toBe("null");
    expect(
      (await signIn(people.admin.email, config.OWNER_PASSWORD)).status,
    ).toBe(401);
    const now = await signIn(people.admin.email, "Server-chosen-temporary-1");
    expect(now.status).toBe(200);
    const [row] = await db
      .select()
      .from(user)
      .where(eq(user.id, people.admin.id));
    expect(row?.mustChangePassword).toBe(true);
    // They can do nothing but change it.
    expect(
      (
        await app.inject({
          url: "/api/v1/ledgers",
          headers: { cookie: now.cookie },
        })
      ).statusCode,
    ).toBe(403);
  });

  it("finds the person by email whatever its case, and says nothing happened for an unknown or deleted one", async () => {
    expect(
      await resetPassword(
        db,
        people.admin.email.toUpperCase(),
        "Server-chosen-temporary-2",
      ),
    ).toEqual({ sessionsEnded: expect.any(Number) });
    expect(
      await resetPassword(db, "nobody-here@example.com", "Server-chosen-3-abc"),
    ).toBeNull();
    expect(
      await resetPassword(db, people.gone.email, "Server-chosen-3-abc"),
    ).toBeNull();
  });

  it("refuses a password the sign-in would refuse", async () => {
    await expect(
      resetPassword(db, people.admin.email, "short"),
    ).rejects.toThrow();
  });
});
