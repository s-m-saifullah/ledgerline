import { newId } from "@ledgerline/shared";
import { eq, inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../../app";
import { createDatabase } from "../../db/client";
import { applyMigrations } from "../../db/migrate";
import {
  account as credentials,
  ledgerMembers,
  ledgers,
  session,
  twoFactor,
  user,
} from "../../db/schema";
import {
  requireTestDatabase,
  seedUser,
  testConfig,
  totp,
} from "../../test-support/harness";
import { resetTwoFactor } from "./reset-two-factor";

const url = requireTestDatabase("Two-factor tests");
const config = testConfig(url, "twofactor");
const { db, pool } = createDatabase(url);
const app = await buildApp(db, config);
const ledgerId = newId();
const names = [
  "owner",
  "editor",
  "viewer",
  "other",
  "plain",
  "steps",
  "codes",
  "trust",
  "lock",
  "gone",
  "reset",
] as const;
type Name = (typeof names)[number];
const roleOf: Partial<Record<Name, "owner" | "editor" | "viewer">> = {
  owner: "owner",
  editor: "editor",
  viewer: "viewer",
};
const people = Object.fromEntries(
  names.map((name) => [name, { id: newId(), email: `tf-${name}@example.com` }]),
) as Record<Name, { id: string; email: string }>;
const everyone = Object.values(people);

// Each call comes from its own address so the plugin's per-address rate limit never hides what a test checks.
let nextAddress = 1;
const post = (path: string, body: unknown, cookie = "") =>
  app.inject({
    method: "POST",
    url: `/api/v1/auth${path}`,
    headers: {
      origin: config.APP_URL,
      "x-forwarded-for": `10.20.${Math.floor(nextAddress / 250)}.${(nextAddress++ % 250) + 1}`,
      "content-type": "application/json",
      ...(cookie ? { cookie } : {}),
    },
    payload: JSON.stringify(body),
  });
const cookieOf = (response: { headers: Record<string, unknown> }) => {
  const header = response.headers["set-cookie"];
  return (Array.isArray(header) ? header : [String(header ?? "")])
    .map((value) => value.split(";")[0])
    .join("; ");
};
const hasSession = async (cookie: string) => {
  const response = await app.inject({
    url: "/api/v1/auth/get-session",
    headers: { cookie },
  });
  return response.statusCode === 200 && response.body !== "null";
};
const password = config.OWNER_PASSWORD;
const signIn = (email: string) => post("/sign-in/email", { email, password });
/** A password-only sign-in from its own address; returns the cookie header. */
const login = async (email: string) => {
  const response = await signIn(email);
  expect(response.statusCode, response.body).toBe(200);
  return cookieOf(response);
};
const flag = async (id: string) =>
  (await db.select().from(user).where(eq(user.id, id)))[0]?.twoFactorEnabled;
const rows = (id: string) =>
  db.select().from(twoFactor).where(eq(twoFactor.userId, id));

/** What each enrolled user was shown at enrolment. */
const enrolled = new Map<string, { totpURI: string; backupCodes: string[] }>();

/** Enrolls a user (password, then the first code) and returns what they were shown. */
async function enroll(name: Name) {
  const person = people[name];
  const cookie = await login(person.email);
  const enabled = await post("/two-factor/enable", { password }, cookie);
  expect(enabled.statusCode, enabled.body).toBe(200);
  const shown = enabled.json() as { totpURI: string; backupCodes: string[] };
  const verified = await post(
    "/two-factor/verify-totp",
    { code: totp(shown.totpURI) },
    cookie,
  );
  expect(verified.statusCode, verified.body).toBe(200);
  enrolled.set(person.email, shown);
  return shown;
}
/** Password step of a sign-in for an enrolled user: returns the pending-challenge cookie. */
async function challenge(name: Name) {
  const response = await signIn(people[name].email);
  expect(response.statusCode, response.body).toBe(200);
  expect(response.json().twoFactorRedirect).toBe(true);
  const cookie = cookieOf(response);
  expect(await hasSession(cookie)).toBe(false);
  return cookie;
}
/** A full sign-in (password, then a current code); returns the session cookie. */
async function fullSignIn(name: Name) {
  const shown = enrolled.get(people[name].email);
  if (!shown) throw new Error("not enrolled");
  const response = await post(
    "/two-factor/verify-totp",
    { code: totp(shown.totpURI) },
    await challenge(name),
  );
  expect(response.statusCode, response.body).toBe(200);
  const cookie = cookieOf(response);
  expect(await hasSession(cookie)).toBe(true);
  return cookie;
}

beforeAll(async () => {
  await applyMigrations(url);
  await db.insert(ledgers).values({ id: ledgerId, name: "Two-factor ledger" });
  for (const name of names) {
    const role = roleOf[name];
    await seedUser(db, config, {
      id: people[name].id,
      email: people[name].email,
      ...(role ? { ledgerId, role } : {}),
    });
  }
  await app.ready();
});
afterAll(async () => {
  const ids = everyone.map((person) => person.id);
  await db.delete(twoFactor).where(inArray(twoFactor.userId, ids));
  await db.delete(session).where(inArray(session.userId, ids));
  await db.delete(credentials).where(inArray(credentials.userId, ids));
  await db.delete(ledgerMembers).where(eq(ledgerMembers.ledgerId, ledgerId));
  await db.delete(ledgers).where(eq(ledgers.id, ledgerId));
  await db.delete(user).where(inArray(user.id, ids));
  await db.execute(sql`DELETE FROM auth_verifications`);
  await app.close();
  await pool.end();
});

describe("two-factor sign-in (ADR 0038)", () => {
  it("leaves password-only sign-in alone for users who have not enrolled", async () => {
    const response = await signIn(people.plain.email);
    expect(response.statusCode).toBe(200);
    expect(response.json().twoFactorRedirect).toBeUndefined();
    expect(await hasSession(cookieOf(response))).toBe(true);
  });

  it("turns on only after the first code verifies, and a wrong first code changes nothing", async () => {
    const person = people.owner;
    const cookie = await login(person.email);
    const wrongPassword = await post(
      "/two-factor/enable",
      { password: "not-the-password-at-all" },
      cookie,
    );
    expect(wrongPassword.statusCode).toBe(400);
    expect(await rows(person.id)).toHaveLength(0);

    const enabled = await post("/two-factor/enable", { password }, cookie);
    expect(enabled.statusCode, enabled.body).toBe(200);
    const { totpURI, backupCodes } = enabled.json() as {
      totpURI: string;
      backupCodes: string[];
    };
    expect(backupCodes).toHaveLength(10);
    expect(totpURI).toContain("issuer=Ledgerline");
    // Not on yet: the flag is off and the secret is unverified.
    expect(await flag(person.id)).toBe(false);
    const stored = (await rows(person.id))[0];
    expect(stored?.verified).toBe(false);
    // Stored encrypted, never as the values the user was shown.
    expect(stored?.secret).not.toContain(
      new URL(totpURI).searchParams.get("secret") ?? "x",
    );
    expect(stored?.backupCodes).not.toContain(backupCodes[0] ?? "x");

    const wrong = await post(
      "/two-factor/verify-totp",
      { code: "000000" },
      cookie,
    );
    expect(wrong.statusCode).toBe(401);
    expect(await flag(person.id)).toBe(false);
    // A password-only sign-in still works, so a bad scan cannot lock the user out.
    expect(await hasSession(cookieOf(await signIn(person.email)))).toBe(true);

    const good = await post(
      "/two-factor/verify-totp",
      { code: totp(totpURI) },
      cookie,
    );
    expect(good.statusCode, good.body).toBe(200);
    expect(await flag(person.id)).toBe(true);
    expect((await rows(person.id))[0]?.verified).toBe(true);
    enrolled.set(person.email, { totpURI, backupCodes });
  });

  it("asks for a code after the password and gives a session only for a right one (editor)", async () => {
    await enroll("editor");
    const wrong = await post(
      "/two-factor/verify-totp",
      { code: "111111" },
      await challenge("editor"),
    );
    expect(wrong.statusCode).toBe(401);
    expect(await hasSession(cookieOf(wrong))).toBe(false);
    await fullSignIn("editor");
  });

  it("accepts a code from the neighbouring 30-second step but not a distant one", async () => {
    const { totpURI } = await enroll("steps");
    const near = await post(
      "/two-factor/verify-totp",
      { code: totp(totpURI, -1) },
      await challenge("steps"),
    );
    expect(near.statusCode, near.body).toBe(200);
    const far = await post(
      "/two-factor/verify-totp",
      { code: totp(totpURI, 5) },
      await challenge("steps"),
    );
    expect(far.statusCode).toBe(401);
  });

  it("spends each backup code once and replaces them all when new ones are made (viewer)", async () => {
    const { backupCodes } = await enroll("viewer");
    const [first, second, third] = backupCodes as [string, string, string];
    const used = await post(
      "/two-factor/verify-backup-code",
      { code: first },
      await challenge("viewer"),
    );
    expect(used.statusCode, used.body).toBe(200);
    expect(await hasSession(cookieOf(used))).toBe(true);
    const reused = await post(
      "/two-factor/verify-backup-code",
      { code: first },
      await challenge("viewer"),
    );
    expect(reused.statusCode).toBe(401);
    const next = await post(
      "/two-factor/verify-backup-code",
      { code: second },
      await challenge("viewer"),
    );
    expect(next.statusCode, next.body).toBe(200);

    const cookie = cookieOf(next);
    expect(
      (
        await post(
          "/two-factor/generate-backup-codes",
          { password: "wrong-password-value" },
          cookie,
        )
      ).statusCode,
    ).toBe(400);
    const regenerated = await post(
      "/two-factor/generate-backup-codes",
      { password },
      cookie,
    );
    expect(regenerated.statusCode, regenerated.body).toBe(200);
    const newCodes = regenerated.json().backupCodes as string[];
    expect(newCodes).toHaveLength(10);
    const stale = await post(
      "/two-factor/verify-backup-code",
      { code: third },
      await challenge("viewer"),
    );
    expect(stale.statusCode).toBe(401);
    const fresh = await post(
      "/two-factor/verify-backup-code",
      { code: newCodes[0] as string },
      await challenge("viewer"),
    );
    expect(fresh.statusCode, fresh.body).toBe(200);
  });

  it("never sets a trusted-device cookie, even when asked", async () => {
    const { totpURI } = await enroll("trust");
    const response = await post(
      "/two-factor/verify-totp",
      { code: totp(totpURI), trustDevice: true },
      await challenge("trust"),
    );
    expect(response.statusCode, response.body).toBe(200);
    expect(JSON.stringify(response.headers["set-cookie"])).not.toContain(
      "trust_device",
    );
  });

  it("disables with the password, soft-deletes the secret and restores password-only sign-in", async () => {
    await enroll("gone");
    const cookie = await fullSignIn("gone");
    const wrong = await post(
      "/two-factor/disable",
      { password: "wrong-password-value" },
      cookie,
    );
    expect(wrong.statusCode).toBe(400);
    expect(await flag(people.gone.id)).toBe(true);
    const disabled = await post("/two-factor/disable", { password }, cookie);
    expect(disabled.statusCode, disabled.body).toBe(200);
    expect(await flag(people.gone.id)).toBe(false);
    const all = await rows(people.gone.id);
    expect(all.length).toBeGreaterThan(0);
    expect(all.every((row) => row.deletedAt !== null)).toBe(true);
    expect(await hasSession(cookieOf(await signIn(people.gone.email)))).toBe(
      true,
    );
  });

  it("keeps each user's two-factor separate", async () => {
    const live = async (id: string) =>
      (await rows(id)).filter((row) => !row.deletedAt).map((row) => row.id);
    const before = await live(people.owner.id);
    expect(before).toHaveLength(1);
    // Someone else (not enrolled) disabling or regenerating touches only their own account.
    const cookie = await login(people.other.email);
    await post("/two-factor/disable", { password }, cookie);
    await post("/two-factor/generate-backup-codes", { password }, cookie);
    expect(await live(people.owner.id)).toEqual(before);
    expect(await flag(people.owner.id)).toBe(true);
    // Without a session nobody can start or finish anything.
    expect((await post("/two-factor/enable", { password })).statusCode).toBe(
      401,
    );
    expect(
      (await post("/two-factor/verify-totp", { code: "123456" })).statusCode,
    ).toBe(401);
  });

  it("exposes only the five two-factor routes; the rest stay disabled", async () => {
    const cookie = await login(people.plain.email);
    for (const path of [
      "/two-factor/send-otp",
      "/two-factor/verify-otp",
      "/two-factor/get-totp-uri",
      "/two-factor/view-backup-codes",
    ]) {
      const response = await post(path, { password }, cookie);
      expect(response.statusCode, path).toBe(404);
    }
  });

  it("locks code checks after ten wrong codes across sign-ins, even for the right code", async () => {
    const { totpURI } = await enroll("lock");
    // One wrong code per sign-in: the account-level count, not one challenge's budget, is what locks.
    for (let i = 0; i < 10; i += 1) {
      const wrong = await post(
        "/two-factor/verify-totp",
        { code: "000000" },
        await challenge("lock"),
      );
      expect(wrong.statusCode).toBe(401);
    }
    const locked = await post(
      "/two-factor/verify-totp",
      { code: totp(totpURI) },
      await challenge("lock"),
    );
    expect(locked.statusCode).toBe(429);
    expect(locked.json().detail).toContain("Too many attempts");
    // The password alone still signs in only to the challenge, never to a session.
    expect(await hasSession(cookieOf(locked))).toBe(false);
  });

  it("the server's reset command turns two-factor off, ends sessions and leaves other users alone", async () => {
    await enroll("reset");
    const cookie = await fullSignIn("reset");
    const ownerBefore = await flag(people.owner.id);
    expect(await resetTwoFactor(db, "nobody@example.com")).toBeNull();
    const result = await resetTwoFactor(db, people.reset.email.toUpperCase());
    expect(result?.secretsRemoved).toBe(1);
    expect(result?.sessionsEnded).toBeGreaterThan(0);
    expect(await flag(people.reset.id)).toBe(false);
    expect(await hasSession(cookie)).toBe(false);
    // Password-only sign-in works again; the secret is soft deleted, not removed.
    expect(await hasSession(cookieOf(await signIn(people.reset.email)))).toBe(
      true,
    );
    expect((await rows(people.reset.id)).every((row) => row.deletedAt)).toBe(
      true,
    );
    expect(await flag(people.owner.id)).toBe(ownerBefore);
    // Running it again changes nothing.
    expect((await resetTwoFactor(db, people.reset.email))?.secretsRemoved).toBe(
      0,
    );
  });
});
