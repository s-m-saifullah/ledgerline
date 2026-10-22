import { newId, sessionListSchema } from "@ledgerline/shared";
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

// ADR 0042: the caller's signed-in devices, and signing others out.
const url = requireTestDatabase("Signed-in devices tests");
const config = testConfig(url, "devices");
const { db, pool } = createDatabase(url);
const app = await buildApp(db, config);
const people = {
  ann: { id: newId(), email: "devices-person-ann@example.com" },
  bob: { id: newId(), email: "devices-person-bob@example.com" },
};
const chrome =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const phoneAgent = "Ledgerline-Android/1.0 (Pixel 8)";

// Each sign-in comes from its own address so the sign-in rate limit never hides what a test checks.
let nextAddress = 1;
const address = () => `198.51.100.${(nextAddress++ % 250) + 1}`;
async function signIn(email: string, userAgent: string, device = false) {
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/auth/sign-in/email",
    headers: {
      origin: config.APP_URL,
      "user-agent": userAgent,
      "x-forwarded-for": address(),
      ...(device ? { "x-ledgerline-client": "android" } : {}),
    },
    payload: { email, password: config.OWNER_PASSWORD },
  });
  expect(response.statusCode, response.body).toBe(200);
  const header = response.headers["set-cookie"];
  const cookie = (Array.isArray(header) ? header : [String(header ?? "")])
    .map((value) => value.split(";")[0])
    .join("; ");
  return {
    cookie,
    token: response.headers["set-auth-token"] as string | undefined,
  };
}
const asCookie = (cookie: string, extra: Record<string, string> = {}) => ({
  cookie,
  ...extra,
});
const asToken = (token: string, extra: Record<string, string> = {}) => ({
  authorization: `Bearer ${token}`,
  origin: config.APP_URL,
  ...extra,
});
const list = async (headers: Record<string, string>) => {
  const response = await app.inject({ url: "/api/v1/sessions", headers });
  expect(response.statusCode, response.body).toBe(200);
  return { body: response.body, ...sessionListSchema.parse(response.json()) };
};
const remove = (path: string, headers: Record<string, string>) =>
  app.inject({ method: "DELETE", url: `/api/v1/sessions${path}`, headers });
const works = async (headers: Record<string, string>) =>
  (await app.inject({ url: "/api/v1/auth/get-session", headers })).body !==
  "null";

beforeAll(async () => {
  await applyMigrations(url);
  await seedUser(db, config, { ...people.ann });
  await seedUser(db, config, { ...people.bob });
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

describe("signed-in devices", () => {
  it("lists only my active sessions with readable names, marks mine, and never shows a token or an address", async () => {
    const web = await signIn(people.ann.email, chrome);
    const phone = await signIn(people.ann.email, phoneAgent, true);
    await signIn(people.bob.email, chrome);
    const { items, body } = await list(asCookie(web.cookie));
    const names = items.map((item) => item.device).sort();
    expect(names).toContain("Chrome on macOS");
    expect(names).toContain("Ledgerline Android app (Pixel 8)");
    expect(items.filter((item) => item.current)).toHaveLength(1);
    expect(items.find((item) => item.current)?.device).toBe("Chrome on macOS");
    // Another person's sign-in never shows up, and nothing secret does.
    const mine = await db
      .select()
      .from(session)
      .where(eq(session.userId, people.ann.id));
    expect(items).toHaveLength(mine.filter((row) => !row.deletedAt).length);
    expect(body).not.toContain(phone.token as string);
    expect(body).not.toMatch(/token|ipAddress|198\.51\.100/i);
    // The app sees the same list and itself as current.
    const fromPhone = await list(asToken(phone.token as string));
    expect(fromPhone.items.find((item) => item.current)?.device).toBe(
      "Ledgerline Android app (Pixel 8)",
    );
  });

  it("signs one other device out: its token stops working and mine keeps working", async () => {
    const web = await signIn(people.ann.email, chrome);
    const phone = await signIn(people.ann.email, phoneAgent, true);
    expect(await works(asToken(phone.token as string))).toBe(true);
    const target = (await list(asCookie(web.cookie))).items.find((item) =>
      item.device.startsWith("Ledgerline Android"),
    );
    const response = await remove(
      `/${target?.id}`,
      asCookie(web.cookie, { origin: config.APP_URL }),
    );
    expect(response.statusCode, response.body).toBe(204);
    expect(await works(asToken(phone.token as string))).toBe(false);
    expect(await works(asCookie(web.cookie))).toBe(true);
    expect(
      (await list(asCookie(web.cookie))).items.map((item) => item.id),
    ).not.toContain(target?.id);
    // Doing it again finds nothing.
    expect(
      (
        await remove(
          `/${target?.id}`,
          asCookie(web.cookie, { origin: config.APP_URL }),
        )
      ).statusCode,
    ).toBe(404);
  });

  it("refuses to remove the device in use, and hides other people's devices", async () => {
    const web = await signIn(people.ann.email, chrome);
    const bob = await signIn(people.bob.email, chrome);
    const own = (await list(asCookie(web.cookie))).items.find(
      (item) => item.current,
    );
    const mine = await remove(
      `/${own?.id}`,
      asCookie(web.cookie, { origin: config.APP_URL }),
    );
    expect(mine.statusCode).toBe(409);
    expect(await works(asCookie(web.cookie))).toBe(true);
    const bobsId = (await list(asCookie(bob.cookie))).items.find(
      (item) => item.current,
    )?.id;
    const theirs = await remove(
      `/${bobsId}`,
      asCookie(web.cookie, { origin: config.APP_URL }),
    );
    expect(theirs.statusCode).toBe(404);
    expect(await works(asCookie(bob.cookie))).toBe(true);
    expect(
      (
        await remove(
          `/${newId()}`,
          asCookie(web.cookie, { origin: config.APP_URL }),
        )
      ).statusCode,
    ).toBe(404);
  });

  it("signs every other device out and leaves the current one, safely repeated", async () => {
    const web = await signIn(people.ann.email, chrome);
    const phone = await signIn(people.ann.email, phoneAgent, true);
    const bob = await signIn(people.bob.email, chrome);
    const headers = asCookie(web.cookie, { origin: config.APP_URL });
    expect((await remove("", headers)).statusCode).toBe(204);
    const { items } = await list(asCookie(web.cookie));
    expect(items).toHaveLength(1);
    expect(items[0]?.current).toBe(true);
    expect(await works(asToken(phone.token as string))).toBe(false);
    expect(await works(asCookie(bob.cookie))).toBe(true);
    expect((await remove("", headers)).statusCode).toBe(204);
    expect((await list(asCookie(web.cookie))).items).toHaveLength(1);
  });

  it("works for the app with its own token, and an expired session is not listed", async () => {
    const phone = await signIn(people.ann.email, phoneAgent, true);
    const web = await signIn(people.ann.email, chrome);
    const old = await signIn(people.ann.email, chrome);
    const ids = (await list(asCookie(web.cookie))).items.length;
    const oldId = (
      await db
        .select()
        .from(session)
        .where(
          eq(session.token, old.cookie.split("=")[1]?.split(".")[0] as string),
        )
    )[0]?.id;
    if (oldId)
      await db
        .update(session)
        .set({ expiresAt: new Date(Date.now() - 1000) })
        .where(eq(session.id, oldId));
    const after = await list(asToken(phone.token as string));
    expect(after.items.length).toBe(ids - (oldId ? 1 : 0));
    expect(after.items.some((item) => item.id === oldId)).toBe(false);
    // The phone can sign the web out with its token.
    const web2 = after.items.find((item) => item.device === "Chrome on macOS");
    const response = await remove(
      `/${web2?.id}`,
      asToken(phone.token as string),
    );
    expect(response.statusCode, response.body).toBe(204);
  });

  it("lists at most the 100 most recently used sessions", async () => {
    const web = await signIn(people.bob.email, chrome);
    const rows = Array.from({ length: 105 }, (_, i) => ({
      id: newId(),
      userId: people.bob.id,
      token: `devices-limit-${newId()}-${i}`,
      expiresAt: new Date(Date.now() + 86_400_000),
      userAgent: chrome,
    }));
    await db.insert(session).values(rows);
    const { items } = await list(asCookie(web.cookie));
    // A hundred newest plus the one making the request, which is older than all of them.
    expect(items).toHaveLength(101);
    expect(items.some((item) => item.current)).toBe(true);
  });

  it("needs a session, and an Origin on the changes only", async () => {
    const web = await signIn(people.ann.email, chrome);
    const phone = await signIn(people.ann.email, phoneAgent, true);
    const target = (await list(asCookie(web.cookie))).items.find(
      (item) => !item.current,
    )?.id;
    expect((await app.inject({ url: "/api/v1/sessions" })).statusCode).toBe(
      401,
    );
    expect((await remove(`/${target}`, {})).statusCode).toBe(401);
    expect((await remove(`/${target}`, asCookie(web.cookie))).statusCode).toBe(
      403,
    );
    expect(
      (
        await remove(
          `/${target}`,
          asCookie(web.cookie, { origin: "https://evil.example" }),
        )
      ).statusCode,
    ).toBe(403);
    expect((await remove("", asCookie(web.cookie))).statusCode).toBe(403);
    // Nothing was removed by the refused calls.
    expect(await works(asToken(phone.token as string))).toBe(true);
    // Reading needs no Origin.
    expect(
      (
        await app.inject({
          url: "/api/v1/sessions",
          headers: asCookie(web.cookie),
        })
      ).statusCode,
    ).toBe(200);
  });
});
