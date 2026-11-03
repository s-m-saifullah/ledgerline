import { newId, passwordChangeRequiredType } from "@ledgerline/shared";
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
import { provisionOwner } from "./owner";

// ADR 0048: a person on a temporary password, or one who is disabled, is refused everywhere but the few places they need.
const url = requireTestDatabase("Account guard tests");
const config = testConfig(url, "guard");
const { db, pool } = createDatabase(url);
const app = await buildApp(db, config);
const people = {
  plain: { id: newId(), email: "guard-person-plain@example.com" },
  temp: { id: newId(), email: "guard-person-temp@example.com" },
  off: { id: newId(), email: "guard-person-off@example.com" },
  owner: { id: newId(), email: config.OWNER_EMAIL },
};
const ids = () => Object.values(people).map((person) => person.id);

let nextAddress = 1;
async function signIn(email: string, extra: Record<string, string> = {}) {
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/auth/sign-in/email",
    headers: {
      origin: config.APP_URL,
      "x-forwarded-for": `198.51.100.${(nextAddress++ % 250) + 1}`,
      ...extra,
    },
    payload: { email, password: config.OWNER_PASSWORD },
  });
  const header = response.headers["set-cookie"];
  return {
    response,
    cookie: (Array.isArray(header) ? header : [String(header ?? "")])
      .map((value) => value.split(";")[0])
      .join("; "),
    token: response.headers["set-auth-token"] as string | undefined,
  };
}
const signedIn = async (email: string, extra: Record<string, string> = {}) => {
  const result = await signIn(email, extra);
  expect(result.response.statusCode, result.response.body).toBe(200);
  return result;
};

type Visit = {
  method: string;
  url: string;
  status: number;
  type?: string | undefined;
};
/** Calls every documented route (the sign-in routes are not in the document) as one person and reports each answer. */
async function walk(headers: Record<string, string>): Promise<Visit[]> {
  const paths = (
    app.swagger() as {
      paths: Record<string, Record<string, unknown>>;
    }
  ).paths;
  const visits: Visit[] = [];
  for (const [template, operations] of Object.entries(paths)) {
    if (!template.startsWith("/api/v1/")) continue;
    const target = template.replace(/\{[^}]+\}/g, () => newId());
    for (const method of Object.keys(operations)) {
      const verb = method.toUpperCase();
      const response = await app.inject({
        method: verb as "GET",
        url: target,
        headers: {
          origin: config.APP_URL,
          "idempotency-key": newId(),
          ...headers,
        },
        ...(verb === "POST" || verb === "PATCH" || verb === "PUT"
          ? { payload: {} }
          : {}),
      });
      let type: string | undefined;
      if (String(response.headers["content-type"]).includes("json"))
        try {
          type = response.json()?.type;
        } catch {
          type = undefined;
        }
      visits.push({
        method: verb,
        url: template,
        status: response.statusCode,
        type,
      });
    }
  }
  return visits;
}
const refusedAsTemporary = (visit: Visit) =>
  visit.status === 403 && visit.type === passwordChangeRequiredType;

beforeAll(async () => {
  await applyMigrations(url);
  for (const person of Object.values(people))
    await seedUser(db, config, { ...person });
  await app.ready();
});
afterAll(async () => {
  await db.delete(session).where(inArray(session.userId, ids()));
  await db.delete(credentials).where(inArray(credentials.userId, ids()));
  await db.delete(user).where(inArray(user.id, ids()));
  await app.close();
  await pool.end();
});

describe("the hook for a person on a temporary password", () => {
  it("covers the documented routes, so the walk below means something", async () => {
    const { cookie } = await signedIn(people.plain.email);
    const visits = await walk({ cookie });
    expect(visits.length).toBeGreaterThan(80);
    expect(visits.map((visit) => visit.url)).toEqual(
      expect.arrayContaining([
        "/api/v1/ledgers",
        "/api/v1/sessions",
        "/api/v1/me",
        "/api/v1/me/password",
      ]),
    );
  });

  it("lets a person who is not flagged through every route (nothing changes for today's account)", async () => {
    const { cookie } = await signedIn(people.plain.email);
    const visits = await walk({ cookie });
    expect(visits.filter(refusedAsTemporary)).toEqual([]);
    // No route answers "sign in" to someone who is signed in, either.
    expect(
      visits.filter((visit) => visit.status === 401 && !visit.type),
    ).toEqual([]);
  });

  it("refuses every route but reading the profile and changing the password, for a cookie and for an app token", async () => {
    await db
      .update(user)
      .set({ mustChangePassword: true })
      .where(eq(user.id, people.temp.id));
    try {
      const web = await signedIn(people.temp.email);
      const phone = await signedIn(people.temp.email, {
        "x-ledgerline-client": "android",
      });
      const allowed = ["GET /api/v1/me", "POST /api/v1/me/password"];
      for (const headers of [
        { cookie: web.cookie },
        { authorization: `Bearer ${phone.token}` },
      ]) {
        const visits = await walk(headers);
        const open = visits
          .filter((visit) => !refusedAsTemporary(visit))
          .map((visit) => `${visit.method} ${visit.url}`);
        expect(open.sort()).toEqual(allowed.sort());
        const refused = visits.find(refusedAsTemporary);
        expect(refused).toBeDefined();
      }
    } finally {
      await db
        .update(user)
        .set({ mustChangePassword: false })
        .where(eq(user.id, people.temp.id));
    }
  });

  it("answers with a problem that says what to do", async () => {
    await db
      .update(user)
      .set({ mustChangePassword: true })
      .where(eq(user.id, people.temp.id));
    try {
      const { cookie } = await signedIn(people.temp.email);
      const response = await app.inject({
        url: "/api/v1/ledgers",
        headers: { cookie },
      });
      expect(response.statusCode).toBe(403);
      expect(response.headers["content-type"]).toContain(
        "application/problem+json",
      );
      expect(response.json()).toMatchObject({
        type: passwordChangeRequiredType,
        status: 403,
      });
      expect(response.json().detail).toMatch(/password/i);
    } finally {
      await db
        .update(user)
        .set({ mustChangePassword: false })
        .where(eq(user.id, people.temp.id));
    }
  });

  it("does not reach outside /api/v1: the health check is open to everyone", async () => {
    await db
      .update(user)
      .set({ mustChangePassword: true })
      .where(eq(user.id, people.temp.id));
    try {
      const { cookie } = await signedIn(people.temp.email);
      const response = await app.inject({
        url: "/api/health",
        headers: { cookie },
      });
      expect(response.statusCode).toBe(200);
    } finally {
      await db
        .update(user)
        .set({ mustChangePassword: false })
        .where(eq(user.id, people.temp.id));
    }
  });

  it("still lets them see their session and sign out", async () => {
    await db
      .update(user)
      .set({ mustChangePassword: true })
      .where(eq(user.id, people.temp.id));
    try {
      const { cookie } = await signedIn(people.temp.email);
      const current = await app.inject({
        url: "/api/v1/auth/get-session",
        headers: { cookie },
      });
      expect(current.statusCode).toBe(200);
      expect(current.body).not.toBe("null");
      const out = await app.inject({
        method: "POST",
        url: "/api/v1/auth/sign-out",
        headers: { cookie, origin: config.APP_URL },
        payload: {},
      });
      expect(out.statusCode).toBe(200);
    } finally {
      await db
        .update(user)
        .set({ mustChangePassword: false })
        .where(eq(user.id, people.temp.id));
    }
  });
});

describe("a person whose sign-in was stopped", () => {
  it("is refused on every route even with a session from before", async () => {
    const { cookie } = await signedIn(people.off.email);
    await db
      .update(user)
      .set({ disabledAt: new Date() })
      .where(eq(user.id, people.off.id));
    try {
      const visits = await walk({ cookie });
      expect(visits.filter((visit) => visit.status !== 401)).toEqual([]);
      expect(visits.filter(refusedAsTemporary)).toEqual([]);
    } finally {
      await db
        .update(user)
        .set({ disabledAt: null })
        .where(eq(user.id, people.off.id));
    }
  });

  it("cannot sign in with the email in another letter case either", async () => {
    await db
      .update(user)
      .set({ disabledAt: new Date() })
      .where(eq(user.id, people.off.id));
    try {
      const stopped = await signIn(people.off.email.toUpperCase());
      expect(stopped.response.statusCode).toBe(401);
      expect(stopped.token).toBeUndefined();
    } finally {
      await db
        .update(user)
        .set({ disabledAt: null })
        .where(eq(user.id, people.off.id));
    }
  });

  it("cannot sign in, and the answer is the same as for a wrong password", async () => {
    await db
      .update(user)
      .set({ disabledAt: new Date() })
      .where(eq(user.id, people.off.id));
    try {
      const stopped = await signIn(people.off.email);
      const wrong = await app.inject({
        method: "POST",
        url: "/api/v1/auth/sign-in/email",
        headers: {
          origin: config.APP_URL,
          "x-forwarded-for": "198.51.100.250",
        },
        payload: { email: people.plain.email, password: "not-the-password-1" },
      });
      expect(stopped.response.statusCode).toBe(401);
      expect(stopped.response.statusCode).toBe(wrong.statusCode);
      expect(stopped.response.json()).toEqual(wrong.json());
      expect(stopped.response.headers["set-cookie"]).toBeUndefined();
      expect(stopped.token).toBeUndefined();
    } finally {
      await db
        .update(user)
        .set({ disabledAt: null })
        .where(eq(user.id, people.off.id));
    }
    expect((await signIn(people.off.email)).response.statusCode).toBe(200);
  });
});

describe("the admin flag", () => {
  it("is given to the configured owner who was there before it existed, and only to them", async () => {
    await db
      .update(user)
      .set({ isAdmin: false })
      .where(eq(user.id, people.owner.id));
    await provisionOwner(db, config);
    const rows = await db.select().from(user).where(inArray(user.id, ids()));
    expect(rows.find((row) => row.id === people.owner.id)?.isAdmin).toBe(true);
    for (const row of rows.filter((row) => row.id !== people.owner.id))
      expect(row.isAdmin).toBe(false);
  });
});
