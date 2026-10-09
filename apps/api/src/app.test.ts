import { newId } from "@ledgerline/shared";
import { and, eq, isNotNull, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "./app";
import { readConfig } from "./config";
import { createDatabase } from "./db/client";
import { applyMigrations } from "./db/migrate";
import { ledgerMembers, ledgers, session, user } from "./db/schema";
import { provisionOwner } from "./modules/auth/owner";

const url = process.env.TEST_DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith("/ledgerline_test"))
  throw new Error(
    "TEST_DATABASE_URL must point to the dedicated ledgerline_test database. Run pnpm setup and pnpm db:up.",
  );
const config = readConfig({
  NODE_ENV: "test",
  DATABASE_URL: url,
  APP_URL: "http://localhost:5173",
  BETTER_AUTH_SECRET: "integration-test-secret-only-000000000000000",
  OWNER_EMAIL: "owner@example.com",
  OWNER_PASSWORD: "Integration-test-password-000",
  OWNER_NAME: "Test owner",
});
const { db, pool } = createDatabase(url);
const app = await buildApp(db, config);
let cookie = "";
let ownerLedger = "";
const otherLedger = newId();

beforeAll(async () => {
  await applyMigrations(url);
  await db.execute(
    sql`TRUNCATE auth_sessions, auth_accounts, auth_verifications, ledger_members, ledgers, users CASCADE`,
  );
  await Promise.all([provisionOwner(db, config), provisionOwner(db, config)]);
  const [owner] = await db
    .select()
    .from(user)
    .where(eq(user.email, config.OWNER_EMAIL));
  if (!owner) throw new Error("Owner missing");
  const [membership] = await db
    .select()
    .from(ledgerMembers)
    .where(eq(ledgerMembers.userId, owner.id));
  if (!membership) throw new Error("Membership missing");
  ownerLedger = membership.ledgerId;
  const otherUser = newId();
  await db
    .insert(user)
    .values({ id: otherUser, name: "Other", email: "other@example.com" });
  await db
    .insert(ledgers)
    .values({ id: otherLedger, name: "Another person's ledger" });
  await db
    .insert(ledgerMembers)
    .values({ ledgerId: otherLedger, userId: otherUser, role: "owner" });
  await app.ready();
});
afterAll(async () => {
  await app.close();
  await pool.end();
});

describe("foundation API", () => {
  it("creates exactly one owner ledger under concurrent startup", async () => {
    expect(
      (await db.select().from(user).where(eq(user.email, config.OWNER_EMAIL)))
        .length,
    ).toBe(1);
    expect((await db.select().from(ledgers)).length).toBe(2);
  });
  it("serves readiness and OpenAPI 3.1", async () => {
    expect((await app.inject({ url: "/api/health" })).json()).toEqual({
      status: "ok",
    });
    expect(
      (await app.inject({ url: "/api/v1/openapi.json" })).json().openapi,
    ).toBe("3.1.0");
  });
  it("blocks anonymous ledger reads and public signup", async () => {
    for (const endpoint of [
      "/api/v1/ledgers",
      `/api/v1/ledgers/${ownerLedger}`,
    ]) {
      const response = await app.inject({ url: endpoint });
      expect(response.statusCode).toBe(401);
      expect(response.headers["content-type"]).toContain(
        "application/problem+json",
      );
    }
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/v1/auth/sign-up/email",
          payload: {
            email: "intruder@example.com",
            password: "long-intruder-password",
            name: "Intruder",
          },
        })
      ).statusCode,
    ).toBe(404);
  });
  it("rejects wrong passwords and foreign origins", async () => {
    const payload = {
      email: config.OWNER_EMAIL,
      password: "incorrect-password",
    };
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/v1/auth/sign-in/email",
          headers: { origin: config.APP_URL },
          payload,
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/v1/auth/sign-in/email",
          headers: { origin: "https://evil.example" },
          payload: { ...payload, password: config.OWNER_PASSWORD },
        })
      ).statusCode,
    ).toBe(403);
  });
  it("signs in with an httpOnly SameSite cookie", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/sign-in/email",
      headers: { origin: config.APP_URL },
      payload: { email: config.OWNER_EMAIL, password: config.OWNER_PASSWORD },
    });
    expect(response.statusCode).toBe(200);
    const header = response.headers["set-cookie"];
    const cookies = Array.isArray(header) ? header : [header ?? ""];
    expect(cookies.join(";")).toContain("HttpOnly");
    expect(cookies.join(";")).toContain("SameSite=Lax");
    cookie = cookies.map((value) => value.split(";")[0]).join("; ");
    expect(
      (
        await app.inject({
          url: "/api/v1/auth/get-session",
          headers: { cookie },
        })
      ).json().user.email,
    ).toBe(config.OWNER_EMAIL);
  });
  it("isolates list and detail endpoints from other ledgers", async () => {
    const response = await app.inject({
      url: "/api/v1/ledgers",
      headers: { cookie },
    });
    expect(response.statusCode).toBe(200);
    expect(
      response.json().items.map((ledger: { id: string }) => ledger.id),
    ).toEqual([ownerLedger]);
    expect(
      (
        await app.inject({
          url: `/api/v1/ledgers/${ownerLedger}`,
          headers: { cookie },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          url: `/api/v1/ledgers/${otherLedger}`,
          headers: { cookie },
        })
      ).statusCode,
    ).toBe(404);
  });
  it("hides soft-deleted memberships and ledgers", async () => {
    await db
      .update(ledgerMembers)
      .set({ deletedAt: new Date() })
      .where(eq(ledgerMembers.ledgerId, ownerLedger));
    expect(
      (await app.inject({ url: "/api/v1/ledgers", headers: { cookie } })).json()
        .items,
    ).toEqual([]);
    expect(
      (
        await app.inject({
          url: `/api/v1/ledgers/${ownerLedger}`,
          headers: { cookie },
        })
      ).statusCode,
    ).toBe(404);
    await db
      .update(ledgerMembers)
      .set({ deletedAt: null })
      .where(eq(ledgerMembers.ledgerId, ownerLedger));
    await db
      .update(ledgers)
      .set({ deletedAt: new Date() })
      .where(eq(ledgers.id, ownerLedger));
    expect(
      (
        await app.inject({
          url: `/api/v1/ledgers/${ownerLedger}`,
          headers: { cookie },
        })
      ).statusCode,
    ).toBe(404);
    await db
      .update(ledgers)
      .set({ deletedAt: null })
      .where(eq(ledgers.id, ownerLedger));
  });
  it("rejects existing sessions for a soft-deleted user", async () => {
    await db
      .update(user)
      .set({ deletedAt: new Date() })
      .where(eq(user.email, config.OWNER_EMAIL));
    try {
      for (const endpoint of [
        "/api/v1/ledgers",
        `/api/v1/ledgers/${ownerLedger}`,
      ]) {
        expect(
          (await app.inject({ url: endpoint, headers: { cookie } })).statusCode,
        ).toBe(401);
      }
      expect(
        (
          await app.inject({
            url: "/api/v1/auth/get-session",
            headers: { cookie },
          })
        ).json(),
      ).toBeNull();
    } finally {
      await db
        .update(user)
        .set({ deletedAt: null })
        .where(eq(user.email, config.OWNER_EMAIL));
    }
  });
  it("signs out and retains a session tombstone that cannot authenticate", async () => {
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/v1/auth/sign-out",
          headers: { cookie, origin: config.APP_URL },
          payload: {},
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (await app.inject({ url: "/api/v1/ledgers", headers: { cookie } }))
        .statusCode,
    ).toBe(401);
    expect(
      (
        await db
          .select()
          .from(session)
          .where(and(isNotNull(session.deletedAt)))
      ).length,
    ).toBeGreaterThan(0);
  });
});
