import { meSchema, newId } from "@ledgerline/shared";
import { eq, inArray } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../../app";
import { createDatabase } from "../../db/client";
import { applyMigrations } from "../../db/migrate";
import { account as credentials, session, user } from "../../db/schema";
import {
  requireTestDatabase,
  seedUser,
  testConfig,
} from "../../test-support/harness";
import { hashPassword } from "../auth/password";

// ADR 0048: the signed-in person's own account, name and password.
const url = requireTestDatabase("Account tests");
const config = testConfig(url, "me");
const { db, pool } = createDatabase(url);
let clock = new Date("2026-11-03T12:00:00Z");
const app = await buildApp(db, config, { now: () => clock });
const people = {
  ann: { id: newId(), email: "me-person-ann@example.com", name: "Ann" },
  bob: { id: newId(), email: "me-person-bob@example.com", name: "Bob" },
  temp: { id: newId(), email: "me-person-temp@example.com", name: "Temp" },
  lock: { id: newId(), email: "me-person-lock@example.com", name: "Lock" },
};
const baseHash = hashPassword(config.OWNER_PASSWORD);
const ids = () => Object.values(people).map((person) => person.id);

let nextAddress = 1;
async function signIn(email: string, password = config.OWNER_PASSWORD) {
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/auth/sign-in/email",
    headers: {
      origin: config.APP_URL,
      "x-forwarded-for": `198.51.100.${(nextAddress++ % 250) + 1}`,
      "x-ledgerline-client": "android",
    },
    payload: { email, password },
  });
  const header = response.headers["set-cookie"];
  return {
    status: response.statusCode,
    cookie: (Array.isArray(header) ? header : [String(header ?? "")])
      .map((value) => value.split(";")[0])
      .join("; "),
    token: response.headers["set-auth-token"] as string | undefined,
  };
}
const signedIn = async (email: string, password = config.OWNER_PASSWORD) => {
  const result = await signIn(email, password);
  expect(result.status).toBe(200);
  return result;
};
const write = (
  method: "PATCH" | "POST",
  path: string,
  cookie: string,
  payload: unknown,
  origin: string | null = config.APP_URL,
) =>
  app.inject({
    method,
    url: `/api/v1/me${path}`,
    headers: { cookie, ...(origin ? { origin } : {}) },
    payload: payload as object,
  });
const works = async (cookie: string) =>
  (
    await app.inject({
      url: "/api/v1/auth/get-session",
      headers: { cookie },
    })
  ).body !== "null";
const newPassword = "A-brand-new-password-1";
const changeBody = (extra: object = {}) => ({
  currentPassword: config.OWNER_PASSWORD,
  newPassword,
  ...extra,
});

beforeAll(async () => {
  await applyMigrations(url);
  for (const person of Object.values(people))
    await seedUser(db, config, { ...person });
  await db
    .update(user)
    .set({ isAdmin: true })
    .where(eq(user.id, people.bob.id));
  await db
    .update(user)
    .set({ mustChangePassword: true })
    .where(eq(user.id, people.temp.id));
  await app.ready();
});
afterAll(async () => {
  await db.delete(session).where(inArray(session.userId, ids()));
  await db.delete(credentials).where(inArray(credentials.userId, ids()));
  await db.delete(user).where(inArray(user.id, ids()));
  await app.close();
  await pool.end();
});

// Every test starts from the same passwords, whatever the one before it changed.
afterEach(async () => {
  await db
    .update(credentials)
    .set({ password: await baseHash })
    .where(inArray(credentials.userId, ids()));
});

describe("GET /me", () => {
  it("needs a sign-in", async () => {
    expect((await app.inject({ url: "/api/v1/me" })).statusCode).toBe(401);
  });

  it("returns my own facts and nothing secret", async () => {
    const { cookie } = await signedIn(people.ann.email);
    const response = await app.inject({
      url: "/api/v1/me",
      headers: { cookie },
    });
    expect(response.statusCode, response.body).toBe(200);
    expect(meSchema.parse(response.json())).toEqual({
      id: people.ann.id,
      name: "Ann",
      email: people.ann.email,
      isAdmin: false,
      mustChangePassword: false,
      twoFactorEnabled: false,
    });
    // Only the six facts: no password, hash or token field of any name.
    expect(Object.keys(response.json()).sort()).toEqual([
      "email",
      "id",
      "isAdmin",
      "mustChangePassword",
      "name",
      "twoFactorEnabled",
    ]);
  });

  it("says who is the admin and who is on a temporary password", async () => {
    const bob = await signedIn(people.bob.email);
    expect(
      (
        await app.inject({
          url: "/api/v1/me",
          headers: { cookie: bob.cookie },
        })
      ).json().isAdmin,
    ).toBe(true);
    const temp = await signedIn(people.temp.email);
    const response = await app.inject({
      url: "/api/v1/me",
      headers: { cookie: temp.cookie },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().mustChangePassword).toBe(true);
  });
});

describe("PATCH /me", () => {
  it("changes only my name, trimmed, and never my email", async () => {
    const { cookie } = await signedIn(people.ann.email);
    const response = await write("PATCH", "", cookie, {
      name: "  Ann Lee  ",
      email: "someone-else@example.com",
      isAdmin: true,
    });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toMatchObject({
      name: "Ann Lee",
      email: people.ann.email,
      isAdmin: false,
    });
    const [row] = await db
      .select()
      .from(user)
      .where(eq(user.id, people.ann.id));
    expect(row).toMatchObject({
      name: "Ann Lee",
      email: people.ann.email,
      isAdmin: false,
    });
    await db
      .update(user)
      .set({ name: "Ann" })
      .where(eq(user.id, people.ann.id));
  });

  it("refuses an empty or very long name, and a request from another origin", async () => {
    const { cookie } = await signedIn(people.ann.email);
    for (const name of ["   ", "a".repeat(101)])
      expect((await write("PATCH", "", cookie, { name })).statusCode).toBe(400);
    expect(
      (
        await write(
          "PATCH",
          "",
          cookie,
          { name: "Ann" },
          "https://elsewhere.example.com",
        )
      ).statusCode,
    ).toBe(403);
    expect(
      (await write("PATCH", "", cookie, { name: "Ann" }, null)).statusCode,
    ).toBe(403);
  });

  it("needs a sign-in", async () => {
    const response = await app.inject({
      method: "PATCH",
      url: "/api/v1/me",
      headers: { origin: config.APP_URL },
      payload: { name: "Nobody" },
    });
    expect(response.statusCode).toBe(401);
  });
});

describe("POST /me/password", () => {
  it("changes the password: the new one signs in and the old one no longer does", async () => {
    const ann = await signedIn(people.ann.email);
    const response = await write("POST", "/password", ann.cookie, changeBody());
    expect(response.statusCode, response.body).toBe(204);
    expect(response.body).toBe("");
    expect((await signIn(people.ann.email)).status).toBe(401);
    await signedIn(people.ann.email, newPassword);
  });

  it("refuses a wrong current password with a field error and leaves the password alone", async () => {
    const { cookie } = await signedIn(people.ann.email);
    const response = await write(
      "POST",
      "/password",
      cookie,
      changeBody({ currentPassword: "not-my-password-at-all" }),
    );
    expect(response.statusCode).toBe(400);
    expect(response.json().errors).toEqual([
      { field: "currentPassword", message: expect.any(String) },
    ]);
    expect(response.body).not.toContain(newPassword);
    expect((await signIn(people.ann.email)).status).toBe(200);
    expect((await signIn(people.ann.email, newPassword)).status).toBe(401);
  });

  it("refuses the same password, a short one and a request from another origin", async () => {
    const { cookie } = await signedIn(people.ann.email);
    const same = await write(
      "POST",
      "/password",
      cookie,
      changeBody({ newPassword: config.OWNER_PASSWORD }),
    );
    expect(same.statusCode).toBe(400);
    expect(same.json().errors[0].field).toBe("newPassword");
    expect(
      (
        await write(
          "POST",
          "/password",
          cookie,
          changeBody({ newPassword: "short" }),
        )
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await write(
          "POST",
          "/password",
          cookie,
          changeBody(),
          "https://elsewhere.example.com",
        )
      ).statusCode,
    ).toBe(403);
    expect((await signIn(people.ann.email)).status).toBe(200);
  });

  it("signs my other devices out by default and keeps the one I am using", async () => {
    const phone = await signedIn(people.bob.email);
    const web = await signedIn(people.bob.email);
    expect(await works(phone.cookie)).toBe(true);
    const response = await write("POST", "/password", web.cookie, changeBody());
    expect(response.statusCode, response.body).toBe(204);
    expect(await works(web.cookie)).toBe(true);
    expect(await works(phone.cookie)).toBe(false);
    // Android's bearer token ends with its session.
    expect(
      (
        await app.inject({
          url: "/api/v1/me",
          headers: { authorization: `Bearer ${phone.token}` },
        })
      ).statusCode,
    ).toBe(401);
  });

  it("keeps my other devices when I say so", async () => {
    const phone = await signedIn(people.bob.email);
    const web = await signedIn(people.bob.email);
    const response = await write(
      "POST",
      "/password",
      web.cookie,
      changeBody({ signOutOtherDevices: false }),
    );
    expect(response.statusCode, response.body).toBe(204);
    expect(await works(phone.cookie)).toBe(true);
    expect(await works(web.cookie)).toBe(true);
  });

  it("ends a temporary password: the flag clears and the person can use the app", async () => {
    const { cookie } = await signedIn(people.temp.email);
    expect(
      (await app.inject({ url: "/api/v1/sessions", headers: { cookie } }))
        .statusCode,
    ).toBe(403);
    expect(
      (await write("POST", "/password", cookie, changeBody())).statusCode,
    ).toBe(204);
    const [row] = await db
      .select()
      .from(user)
      .where(eq(user.id, people.temp.id));
    expect(row?.mustChangePassword).toBe(false);
    expect(
      (await app.inject({ url: "/api/v1/sessions", headers: { cookie } }))
        .statusCode,
    ).toBe(200);
    await signedIn(people.temp.email, newPassword);
  });

  it("locks after five wrong current passwords for fifteen minutes, even for the right one", async () => {
    const { cookie } = await signedIn(people.lock.email);
    const wrong = () =>
      write(
        "POST",
        "/password",
        cookie,
        changeBody({ currentPassword: "definitely-not-it-1" }),
      );
    for (let attempt = 0; attempt < 5; attempt++)
      expect((await wrong()).statusCode).toBe(400);
    const locked = await write("POST", "/password", cookie, changeBody());
    expect(locked.statusCode).toBe(429);
    expect(locked.json().detail).toMatch(/wait/i);
    expect((await signIn(people.lock.email)).status).toBe(200);
    clock = new Date(clock.getTime() + 16 * 60 * 1000);
    expect(
      (await write("POST", "/password", cookie, changeBody())).statusCode,
    ).toBe(204);
  });

  it("forgets earlier wrong attempts once the right password is used", async () => {
    const { cookie } = await signedIn(people.ann.email);
    const wrong = () =>
      write(
        "POST",
        "/password",
        cookie,
        changeBody({ currentPassword: "definitely-not-it-1" }),
      );
    for (let attempt = 0; attempt < 4; attempt++) await wrong();
    expect(
      (
        await write(
          "POST",
          "/password",
          cookie,
          changeBody({
            newPassword: config.OWNER_PASSWORD,
            currentPassword: config.OWNER_PASSWORD,
          }),
        )
      ).statusCode,
    ).toBe(400);
    for (let attempt = 0; attempt < 4; attempt++)
      expect((await wrong()).statusCode).toBe(400);
  });

  it("only ever changes my own password", async () => {
    const ann = await signedIn(people.ann.email);
    const before = (
      await db
        .select()
        .from(credentials)
        .where(eq(credentials.userId, people.bob.id))
    )[0]?.password;
    await write(
      "POST",
      "/password",
      ann.cookie,
      changeBody({ newPassword: "Another-new-password-2" }),
    );
    const after = (
      await db
        .select()
        .from(credentials)
        .where(eq(credentials.userId, people.bob.id))
    )[0]?.password;
    expect(after).toBe(before);
  });

  it("needs a sign-in", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/me/password",
      headers: { origin: config.APP_URL },
      payload: changeBody(),
    });
    expect(response.statusCode).toBe(401);
  });
});
