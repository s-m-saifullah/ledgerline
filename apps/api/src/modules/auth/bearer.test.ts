import { newId } from "@ledgerline/shared";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../../app";
import { createDatabase } from "../../db/client";
import { applyMigrations } from "../../db/migrate";
import {
  account as credentials,
  ledgerMembers,
  ledgers,
  session,
  tags,
  twoFactor,
  user,
  writeReceipts,
} from "../../db/schema";
import {
  requireTestDatabase,
  seedUser,
  testConfig,
  totp,
} from "../../test-support/harness";

// ADR 0042: the Android app signs in with the same routes and keeps a bearer token; browsers never get it.
const url = requireTestDatabase("Bearer token tests");
const config = testConfig(url, "bearer");
const { db, pool } = createDatabase(url);
const app = await buildApp(db, config);
const ledgerId = newId();
const otherLedger = newId();
const people = {
  owner: { id: newId(), email: "bearer-person-owner@example.com" },
  viewer: { id: newId(), email: "bearer-person-viewer@example.com" },
  outsider: { id: newId(), email: "bearer-person-outsider@example.com" },
  twoFactor: { id: newId(), email: "bearer-person-2fa@example.com" },
};
const password = config.OWNER_PASSWORD;

// Each call comes from its own address so the sign-in rate limit never hides what a test checks.
let nextAddress = 1;
const address = () =>
  `10.30.${Math.floor(nextAddress / 250)}.${(nextAddress++ % 250) + 1}`;
const app_ = { "x-ledgerline-client": "android" };
const post = (
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
) =>
  app.inject({
    method: "POST",
    url: `/api/v1/auth${path}`,
    headers: {
      origin: config.APP_URL,
      "x-forwarded-for": address(),
      "content-type": "application/json",
      ...headers,
    },
    payload: JSON.stringify(body),
  });
const cookieOf = (response: { headers: Record<string, unknown> }) => {
  const header = response.headers["set-cookie"];
  return (Array.isArray(header) ? header : [String(header ?? "")])
    .map((value) => value.split(";")[0])
    .join("; ");
};
const tokenOf = (response: { headers: Record<string, unknown> }) =>
  response.headers["set-auth-token"] as string | undefined;
const deviceSignIn = async (email: string) => {
  const response = await post("/sign-in/email", { email, password }, app_);
  expect(response.statusCode, response.body).toBe(200);
  const token = tokenOf(response);
  expect(token).toBeTruthy();
  return token as string;
};
const withToken = (token: string, extra: Record<string, string> = {}) => ({
  authorization: `Bearer ${token}`,
  origin: config.APP_URL,
  ...extra,
});
const ledgersFor = (headers: Record<string, string>) =>
  app.inject({ url: "/api/v1/ledgers", headers });
const createTag = (headers: Record<string, string>, ledger = ledgerId) =>
  app.inject({
    method: "POST",
    url: `/api/v1/ledgers/${ledger}/tags`,
    headers: {
      ...headers,
      "content-type": "application/json",
      "idempotency-key": newId(),
    },
    payload: JSON.stringify({ name: `Tag ${newId().slice(-8)}` }),
  });

beforeAll(async () => {
  await applyMigrations(url);
  await db.insert(ledgers).values([
    { id: ledgerId, name: "Bearer ledger" },
    { id: otherLedger, name: "Other ledger" },
  ]);
  await seedUser(db, config, { ...people.owner, ledgerId, role: "owner" });
  await seedUser(db, config, { ...people.viewer, ledgerId, role: "viewer" });
  await seedUser(db, config, {
    ...people.outsider,
    ledgerId: otherLedger,
    role: "owner",
  });
  await seedUser(db, config, { ...people.twoFactor, ledgerId, role: "editor" });
  await app.ready();
});
afterAll(async () => {
  const ids = Object.values(people).map((person) => person.id);
  await db
    .delete(writeReceipts)
    .where(inArray(writeReceipts.ledgerId, [ledgerId, otherLedger]));
  await db.delete(tags).where(inArray(tags.ledgerId, [ledgerId, otherLedger]));
  await db.delete(twoFactor).where(inArray(twoFactor.userId, ids));
  await db.delete(session).where(inArray(session.userId, ids));
  await db.delete(credentials).where(inArray(credentials.userId, ids));
  await db
    .delete(ledgerMembers)
    .where(inArray(ledgerMembers.ledgerId, [ledgerId, otherLedger]));
  await db.delete(ledgers).where(inArray(ledgers.id, [ledgerId, otherLedger]));
  await db.delete(user).where(inArray(user.id, ids));
  await pool.end();
});

describe("bearer tokens for the Android app", () => {
  it("gives the app a token on sign-in, and it works for reads and writes", async () => {
    const token = await deviceSignIn(people.owner.email);
    const list = await ledgersFor(withToken(token));
    expect(list.statusCode, list.body).toBe(200);
    expect(list.json().items.map((item: { id: string }) => item.id)).toContain(
      ledgerId,
    );
    const created = await createTag(withToken(token));
    expect(created.statusCode, created.body).toBe(201);
  });

  it("never gives a browser the token, and its cookie session works as before", async () => {
    const response = await post("/sign-in/email", {
      email: people.owner.email,
      password,
    });
    expect(response.statusCode).toBe(200);
    expect(tokenOf(response)).toBeUndefined();
    expect(response.headers["access-control-expose-headers"]).toBeUndefined();
    const cookie = cookieOf(response);
    expect(cookie).toContain("session_token");
    expect((await ledgersFor({ cookie })).statusCode).toBe(200);
    // A browser that copies the app's client header still gets no token from a plain request.
    const marked = await app.inject({
      url: "/api/v1/auth/get-session",
      headers: { cookie, ...app_ },
    });
    expect(marked.statusCode).toBe(200);
    expect(tokenOf(marked)).toBeUndefined();
  });

  it("does not give the token to a request marked as the app but from a browser origin sign-in without the marker", async () => {
    const response = await post(
      "/sign-in/email",
      {
        email: people.owner.email,
        password,
      },
      { "x-ledgerline-client": "web" },
    );
    expect(tokenOf(response)).toBeUndefined();
  });

  it("ends the session on sign-out so the token stops working", async () => {
    const token = await deviceSignIn(people.owner.email);
    expect((await ledgersFor(withToken(token))).statusCode).toBe(200);
    const out = await post("/sign-out", {}, withToken(token));
    expect(out.statusCode, out.body).toBe(200);
    expect((await ledgersFor(withToken(token))).statusCode).toBe(401);
  });

  it("rejects a missing, malformed or tampered token", async () => {
    const token = await deviceSignIn(people.owner.email);
    for (const header of [
      "",
      "Bearer ",
      "Bearer not-a-token",
      `Bearer ${token.slice(0, -2)}xx`,
      `Basic ${token}`,
    ])
      expect(
        (
          await ledgersFor({
            origin: config.APP_URL,
            ...(header ? { authorization: header } : {}),
          })
        ).statusCode,
        header,
      ).toBe(401);
  });

  it("keeps the rules of the token's owner: viewers cannot write, other ledgers are 404", async () => {
    const viewer = await deviceSignIn(people.viewer.email);
    expect((await ledgersFor(withToken(viewer))).statusCode).toBe(200);
    expect((await createTag(withToken(viewer))).statusCode).toBe(403);
    const outsider = await deviceSignIn(people.outsider.email);
    expect((await createTag(withToken(outsider))).statusCode).toBe(404);
    const owner = await deviceSignIn(people.owner.email);
    expect((await createTag(withToken(owner), otherLedger)).statusCode).toBe(
      404,
    );
  });

  it("still refuses another site's Origin and a missing Origin on a write", async () => {
    const token = await deviceSignIn(people.owner.email);
    const foreign = await createTag({
      authorization: `Bearer ${token}`,
      origin: "https://evil.example",
    });
    expect(foreign.statusCode).toBe(403);
    const none = await createTag({ authorization: `Bearer ${token}` });
    expect(none.statusCode).toBe(403);
    const signOut = await post(
      "/sign-out",
      {},
      {
        authorization: `Bearer ${token}`,
        origin: "https://evil.example",
      },
    );
    expect(signOut.statusCode).toBe(403);
  });

  it("gives a two-factor user no token from the password, and one only after the code", async () => {
    const cookie = cookieOf(
      await post("/sign-in/email", { email: people.twoFactor.email, password }),
    );
    const enabled = await post("/two-factor/enable", { password }, { cookie });
    expect(enabled.statusCode, enabled.body).toBe(200);
    const shown = enabled.json() as { totpURI: string; backupCodes: string[] };
    const verified = await post(
      "/two-factor/verify-totp",
      { code: totp(shown.totpURI) },
      { cookie },
    );
    expect(verified.statusCode, verified.body).toBe(200);

    const step = await post(
      "/sign-in/email",
      { email: people.twoFactor.email, password },
      app_,
    );
    expect(step.statusCode).toBe(200);
    expect(step.json().twoFactorRedirect).toBe(true);
    expect(tokenOf(step)).toBeUndefined();
    const challenge = cookieOf(step);
    const early = await ledgersFor({ cookie: challenge });
    expect(early.statusCode).toBe(401);

    const wrong = await post(
      "/two-factor/verify-totp",
      { code: "000000" },
      { cookie: challenge, ...app_ },
    );
    expect(wrong.statusCode).toBe(401);
    expect(tokenOf(wrong)).toBeUndefined();

    const done = await post(
      "/two-factor/verify-totp",
      { code: totp(shown.totpURI) },
      { cookie: challenge, ...app_ },
    );
    expect(done.statusCode, done.body).toBe(200);
    const token = tokenOf(done);
    expect(token).toBeTruthy();
    expect((await ledgersFor(withToken(token as string))).statusCode).toBe(200);

    // A browser completing the same step gets a cookie and no token.
    const again = await post("/sign-in/email", {
      email: people.twoFactor.email,
      password,
    });
    const browserDone = await post(
      "/two-factor/verify-totp",
      { code: totp(shown.totpURI, 1) },
      { cookie: cookieOf(again) },
    );
    expect(tokenOf(browserDone)).toBeUndefined();

    // A backup code gives the app a token too.
    const third = await post(
      "/sign-in/email",
      { email: people.twoFactor.email, password },
      app_,
    );
    const viaBackup = await post(
      "/two-factor/verify-backup-code",
      { code: shown.backupCodes[0] },
      { cookie: cookieOf(third), ...app_ },
    );
    expect(viaBackup.statusCode, viaBackup.body).toBe(200);
    expect(tokenOf(viaBackup)).toBeTruthy();
    await db
      .update(user)
      .set({ twoFactorEnabled: false })
      .where(eq(user.id, people.twoFactor.id));
  });

  it("keeps the browser's auth route allowlist", async () => {
    for (const path of ["/sign-up/email", "/list-sessions", "/revoke-sessions"])
      expect((await post(path, {}, app_)).statusCode, path).toBe(404);
  });
});
