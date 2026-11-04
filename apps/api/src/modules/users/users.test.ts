import {
  managedUserListSchema,
  managedUserSchema,
  newId,
  passwordChangeRequiredType,
} from "@ledgerline/shared";
import { and, eq, inArray, isNull, like } from "drizzle-orm";
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
import {
  account as credentials,
  ledgerMembers,
  ledgers,
  session,
  twoFactor,
  user,
} from "../../db/schema";
import { requireTestDatabase, testConfig } from "../../test-support/harness";
import { createAccount } from "../auth/accounts";
import { verifyPassword } from "../auth/password";
import { listLedgerOwners } from "../ledgers/repo";

// ADR 0048, slice 3: the admin's routes for the people on this server.
const url = requireTestDatabase("User routes tests");
const config = testConfig(url, "users");
const { db, pool } = createDatabase(url);
const app = await buildApp(db, config);
const mailbox = (name: string) => `users-${name}@example.com`;
const temporary = "temporary-pass-1234";
const own = "my-own-password-5678";
const who: Record<string, { id: string; ledgerId: string; cookie: string }> =
  {};

let nextAddress = 1;
async function signIn(
  email: string,
  password: string,
  extra: Record<string, string> = {},
) {
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/auth/sign-in/email",
    headers: {
      origin: config.APP_URL,
      "x-forwarded-for": `198.51.100.${(nextAddress++ % 250) + 1}`,
      ...extra,
    },
    payload: { email, password },
  });
  const header = response.headers["set-cookie"];
  return {
    status: response.statusCode,
    body: response.body,
    cookie: (Array.isArray(header) ? header : [String(header ?? "")])
      .map((value) => value.split(";")[0])
      .join("; "),
    token: response.headers["set-auth-token"] as string | undefined,
  };
}
const signedIn = async (
  email: string,
  password = temporary,
  extra: Record<string, string> = {},
) => {
  const result = await signIn(email, password, extra);
  expect(result.status, result.body).toBe(200);
  return result;
};
const call = (
  method: "GET" | "POST" | "PATCH" | "DELETE",
  path: string,
  cookie: string | undefined,
  payload?: unknown,
  headers: Record<string, string> = {},
) =>
  app.inject({
    method,
    url: `/api/v1${path}`,
    headers: {
      origin: config.APP_URL,
      ...(cookie ? { cookie } : {}),
      ...headers,
    },
    ...(payload === undefined ? {} : { payload: payload as object }),
  });

/** The admin adds a person through the real route and the person signs in once (a new person is on a temporary password). */
async function addPerson(name: string, cookie = who.admin?.cookie) {
  const response = await call("POST", "/users", cookie, {
    name: `Person ${name}`,
    email: mailbox(name),
    temporaryPassword: temporary,
  });
  expect(response.statusCode, response.body).toBe(201);
  const created = managedUserSchema.parse(response.json());
  const [ledger] = await db
    .select({ id: ledgerMembers.ledgerId })
    .from(ledgerMembers)
    .where(eq(ledgerMembers.userId, created.id));
  return { id: created.id, ledgerId: ledger?.id as string };
}
const row = async (id: string) =>
  (
    await db.select().from(user).where(eq(user.id, id))
  )[0] as typeof user.$inferSelect;
const liveSessions = async (id: string) =>
  (
    await db
      .select({ id: session.id })
      .from(session)
      .where(and(eq(session.userId, id), isNull(session.deletedAt)))
  ).length;

async function wipe() {
  const people = await db
    .select({ id: user.id })
    .from(user)
    .where(like(user.email, "users-%@example.com"));
  const ids = people.map((person) => person.id);
  if (!ids.length) return;
  const members = await db
    .select({ ledgerId: ledgerMembers.ledgerId })
    .from(ledgerMembers)
    .where(inArray(ledgerMembers.userId, ids));
  await db.delete(twoFactor).where(inArray(twoFactor.userId, ids));
  await db.delete(session).where(inArray(session.userId, ids));
  await db.delete(credentials).where(inArray(credentials.userId, ids));
  await db.delete(ledgerMembers).where(inArray(ledgerMembers.userId, ids));
  await db.delete(ledgers).where(
    inArray(
      ledgers.id,
      members.map((member) => member.ledgerId),
    ),
  );
  await db.delete(user).where(inArray(user.id, ids));
}

beforeAll(async () => {
  await applyMigrations(url);
  await wipe();
  await app.ready();
});
afterAll(async () => {
  await wipe();
  await app.close();
  await pool.end();
});
beforeEach(async () => {
  await wipe();
  for (const [name, isAdmin] of [
    ["admin", true],
    ["ann", false],
  ] as const) {
    const made = await db.transaction((tx) =>
      createAccount(tx, {
        email: mailbox(name),
        name,
        password: own,
        isAdmin,
      }),
    );
    who[name] = {
      id: made.userId,
      ledgerId: made.ledgerId,
      cookie: (await signedIn(mailbox(name), own)).cookie,
    };
  }
});

const adminRoutes = (id: string) =>
  [
    ["GET", "/users", undefined],
    [
      "POST",
      "/users",
      { name: "X", email: mailbox("nobody"), temporaryPassword: temporary },
    ],
    ["PATCH", `/users/${id}`, { disabled: true }],
    ["POST", `/users/${id}/password`, { temporaryPassword: temporary }],
    ["DELETE", `/users/${id}/sessions`, undefined],
    ["DELETE", `/users/${id}/two-factor`, undefined],
    ["DELETE", `/users/${id}`, undefined],
  ] as const;

describe("who may use the routes", () => {
  it("answers 401 without a session on every route", async () => {
    for (const [method, path, payload] of adminRoutes(newId()))
      expect(
        (await call(method, path, undefined, payload)).statusCode,
        `${method} ${path}`,
      ).toBe(401);
  });

  it("answers 403 to a person who is not the admin, whether or not the id exists", async () => {
    const other = await addPerson("bob");
    for (const id of [newId(), other.id, who.admin?.id as string])
      for (const [method, path, payload] of adminRoutes(id)) {
        const response = await call(method, path, who.ann?.cookie, payload);
        expect(response.statusCode, `${method} ${path}`).toBe(403);
      }
    // Nothing happened: the person is still live, enabled and has their ledger.
    const after = await row(other.id);
    expect(after.deletedAt).toBeNull();
    expect(after.disabledAt).toBeNull();
    expect((await call("GET", "/users", who.ann?.cookie)).body).not.toContain(
      mailbox("bob"),
    );
  });

  it("refuses a write without the app's Origin, like every other write", async () => {
    const other = await addPerson("bob");
    for (const [method, path, payload] of adminRoutes(other.id).slice(1)) {
      const response = await call(method, path, who.admin?.cookie, payload, {
        origin: "http://attacker.example.com",
      });
      expect(response.statusCode, `${method} ${path}`).toBe(403);
    }
    expect((await row(other.id)).deletedAt).toBeNull();
  });

  it("stops being usable when the admin's own sign-in is stopped", async () => {
    await db
      .update(user)
      .set({ disabledAt: new Date() })
      .where(eq(user.id, who.admin?.id as string));
    expect((await call("GET", "/users", who.admin?.cookie)).statusCode).toBe(
      401,
    );
  });
});

describe("GET /users", () => {
  it("lists live people with account facts only", async () => {
    const bob = await addPerson("bob");
    const gone = await addPerson("gone");
    expect(
      (await call("DELETE", `/users/${gone.id}`, who.admin?.cookie)).statusCode,
    ).toBe(204);
    await call("PATCH", `/users/${bob.id}`, who.admin?.cookie, {
      disabled: true,
    });
    const response = await call("GET", "/users", who.admin?.cookie);
    expect(response.statusCode).toBe(200);
    const list = managedUserListSchema.parse(response.json());
    const mine = list.items.filter((item) => item.email.startsWith("users-"));
    expect(mine.map((item) => item.email).sort()).toEqual(
      [mailbox("admin"), mailbox("ann"), mailbox("bob")].sort(),
    );
    const byName = Object.fromEntries(mine.map((item) => [item.name, item]));
    expect(byName.admin).toMatchObject({
      isAdmin: true,
      mustChangePassword: false,
      disabled: false,
      twoFactorEnabled: false,
    });
    expect(byName["Person bob"]).toMatchObject({
      isAdmin: false,
      mustChangePassword: true,
      disabled: true,
    });
    // Only account facts: no password, hash, token or anything of a ledger.
    for (const item of list.items)
      expect(Object.keys(item).sort()).toEqual(
        [
          "createdAt",
          "disabled",
          "email",
          "id",
          "isAdmin",
          // A date or null (ADR 0049): the one thing about a ledger the admin may see.
          "ledgerClearedAt",
          "mustChangePassword",
          "name",
          "twoFactorEnabled",
        ].sort(),
      );
    const stored = await db
      .select({ hash: credentials.password })
      .from(credentials);
    for (const { hash } of stored)
      if (hash) expect(response.body).not.toContain(hash);
    expect(response.body).not.toContain(who.ann?.ledgerId as string);
  });

  it("lists oldest first, so the order never changes under the admin", async () => {
    await addPerson("bob");
    await addPerson("cy");
    const list = managedUserListSchema.parse(
      (await call("GET", "/users", who.admin?.cookie)).json(),
    );
    const times = list.items.map((item) => item.createdAt);
    expect(times).toEqual([...times].sort());
  });
});

describe("POST /users", () => {
  it("adds a person with their own ledger, flagged for a new password, and never returns the password", async () => {
    const response = await call("POST", "/users", who.admin?.cookie, {
      name: "  Bea  ",
      email: "Users-Bea@Example.com",
      temporaryPassword: temporary,
    });
    expect(response.statusCode, response.body).toBe(201);
    expect(response.body).not.toContain(temporary);
    const created = managedUserSchema.parse(response.json());
    expect(created).toMatchObject({
      name: "Bea",
      email: "users-bea@example.com",
      isAdmin: false,
      mustChangePassword: true,
      disabled: false,
      twoFactorEnabled: false,
    });
    const stored = await row(created.id);
    expect(stored.isAdmin).toBe(false);
    expect(stored.mustChangePassword).toBe(true);
    const [login] = await db
      .select()
      .from(credentials)
      .where(
        and(eq(credentials.userId, created.id), isNull(credentials.deletedAt)),
      );
    expect(login?.password).not.toContain(temporary);
    expect(
      await verifyPassword({
        hash: login?.password ?? "",
        password: temporary,
      }),
    ).toBe(true);
    // One ledger of their own, with them as its only member and owner; the admin is not a member of it.
    const members = await db
      .select()
      .from(ledgerMembers)
      .where(eq(ledgerMembers.userId, created.id));
    expect(members.map((member) => member.role)).toEqual(["owner"]);
    const [ledger] = await db
      .select()
      .from(ledgers)
      .where(eq(ledgers.id, members[0]?.ledgerId as string));
    expect(ledger).toMatchObject({
      name: "Personal ledger",
      baseCurrency: "USD",
    });
    expect(
      await db
        .select()
        .from(ledgerMembers)
        .where(eq(ledgerMembers.ledgerId, ledger?.id as string)),
    ).toHaveLength(1);
    const adminLedgers = await call("GET", "/ledgers", who.admin?.cookie);
    expect(adminLedgers.body).not.toContain(ledger?.id as string);
  });

  it("lets the new person sign in, forces a new password, then they see only their own ledger", async () => {
    const bea = await addPerson("bea");
    const first = await signedIn(mailbox("bea"));
    const me = await call("GET", "/me", first.cookie);
    expect(me.json()).toMatchObject({
      mustChangePassword: true,
      isAdmin: false,
    });
    const refused = await call("GET", "/ledgers", first.cookie);
    expect(refused.statusCode).toBe(403);
    expect(refused.json().type).toBe(passwordChangeRequiredType);
    const changed = await call("POST", "/me/password", first.cookie, {
      currentPassword: temporary,
      newPassword: own,
    });
    expect(changed.statusCode, changed.body).toBe(204);
    expect((await row(bea.id)).mustChangePassword).toBe(false);
    const ledgersList = await call("GET", "/ledgers", first.cookie);
    expect(ledgersList.statusCode).toBe(200);
    expect(
      ledgersList.json().items.map((item: { id: string }) => item.id),
    ).toEqual([bea.ledgerId]);
  });

  it("answers 409 for a taken email in any letter case, deleted people included, and adds nothing", async () => {
    await addPerson("bea");
    const gone = await addPerson("gone");
    await call("DELETE", `/users/${gone.id}`, who.admin?.cookie);
    const counts = async () => ({
      users: (await db.select({ id: user.id }).from(user)).length,
      ledgers: (await db.select({ id: ledgers.id }).from(ledgers)).length,
      members: (await db.select({ id: ledgerMembers.id }).from(ledgerMembers))
        .length,
      logins: (await db.select({ id: credentials.id }).from(credentials))
        .length,
    });
    const before = await counts();
    for (const email of [
      mailbox("bea"),
      "USERS-BEA@example.com",
      mailbox("gone"),
      mailbox("ann"),
    ]) {
      const response = await call("POST", "/users", who.admin?.cookie, {
        name: "Again",
        email,
        temporaryPassword: temporary,
      });
      expect(response.statusCode, email).toBe(409);
      expect(response.headers["content-type"]).toContain(
        "application/problem+json",
      );
      expect(response.body).not.toContain(temporary);
    }
    expect(await counts()).toEqual(before);
  });

  it("makes one person when the same email is sent twice at once", async () => {
    const send = () =>
      call("POST", "/users", who.admin?.cookie, {
        name: "Twin",
        email: mailbox("twin"),
        temporaryPassword: temporary,
      });
    const codes = (await Promise.all([send(), send()]))
      .map((response) => response.statusCode)
      .sort();
    expect(codes).toEqual([201, 409]);
    expect(
      await db
        .select()
        .from(user)
        .where(eq(user.email, mailbox("twin"))),
    ).toHaveLength(1);
  });

  it("checks the fields and adds nothing when one is wrong", async () => {
    const good = {
      name: "Bea",
      email: mailbox("bea"),
      temporaryPassword: temporary,
    };
    const bad = [
      { ...good, temporaryPassword: "short" },
      { ...good, temporaryPassword: "x".repeat(129) },
      { ...good, email: "not-an-email" },
      { ...good, name: "   " },
      { ...good, name: "n".repeat(101) },
      { name: "Bea", email: mailbox("bea") },
      {},
    ];
    for (const payload of bad)
      expect(
        (await call("POST", "/users", who.admin?.cookie, payload)).statusCode,
        JSON.stringify(payload).replace(/x{20,}|n{20,}/g, "…"),
      ).toBe(400);
    expect(
      await db
        .select()
        .from(user)
        .where(eq(user.email, mailbox("bea"))),
    ).toHaveLength(0);
    // The edges of the rule are fine.
    for (const length of [12, 128])
      expect(
        (
          await call("POST", "/users", who.admin?.cookie, {
            ...good,
            email: mailbox(`edge${length}`),
            temporaryPassword: "p".repeat(length),
          })
        ).statusCode,
      ).toBe(201);
  });

  it("cannot make an admin or set the flags: unknown fields are ignored", async () => {
    const response = await call("POST", "/users", who.admin?.cookie, {
      name: "Sly",
      email: mailbox("sly"),
      temporaryPassword: temporary,
      isAdmin: true,
      mustChangePassword: false,
    });
    expect(response.statusCode).toBe(201);
    const stored = await row(response.json().id);
    expect(stored.isAdmin).toBe(false);
    expect(stored.mustChangePassword).toBe(true);
  });
});

describe("a ledger or membership that was deleted", () => {
  it("is out of reach even for a person who is otherwise live", async () => {
    const ann = who.ann as { id: string; ledgerId: string; cookie: string };
    const reach = () =>
      call("GET", `/ledgers/${ann.ledgerId}/accounts`, ann.cookie);
    expect((await reach()).statusCode).toBe(200);
    // The ledger alone is deleted.
    await db
      .update(ledgers)
      .set({ deletedAt: new Date() })
      .where(eq(ledgers.id, ann.ledgerId));
    expect((await reach()).statusCode).toBe(404);
    expect((await call("GET", "/ledgers", ann.cookie)).json().items).toEqual(
      [],
    );
    await db
      .update(ledgers)
      .set({ deletedAt: null })
      .where(eq(ledgers.id, ann.ledgerId));
    expect((await reach()).statusCode).toBe(200);
    // The membership alone is deleted.
    await db
      .update(ledgerMembers)
      .set({ deletedAt: new Date() })
      .where(eq(ledgerMembers.userId, ann.id));
    expect((await reach()).statusCode).toBe(404);
    expect((await call("GET", "/ledgers", ann.cookie)).json().items).toEqual(
      [],
    );
  });
});

describe("PATCH /users/{id} (stop or allow sign-in)", () => {
  it("stops a person: their browser and app token end, sign-in gives the wrong-password answer, their ledger stays", async () => {
    const bea = await addPerson("bea");
    await db
      .update(user)
      .set({ mustChangePassword: false })
      .where(eq(user.id, bea.id));
    const web = await signedIn(mailbox("bea"));
    const app1 = await signedIn(mailbox("bea"), temporary, {
      "x-ledgerline-client": "android",
    });
    expect((await call("GET", "/me", web.cookie)).statusCode).toBe(200);
    const response = await call(
      "PATCH",
      `/users/${bea.id}`,
      who.admin?.cookie,
      { disabled: true },
    );
    expect(response.statusCode, response.body).toBe(200);
    expect(managedUserSchema.parse(response.json())).toMatchObject({
      id: bea.id,
      disabled: true,
    });
    expect((await call("GET", "/me", web.cookie)).statusCode).toBe(401);
    expect(
      (
        await call("GET", "/me", undefined, undefined, {
          authorization: `Bearer ${app1.token}`,
        })
      ).statusCode,
    ).toBe(401);
    expect(await liveSessions(bea.id)).toBe(0);
    const stopped = await signIn(mailbox("bea"), temporary);
    const wrong = await signIn(mailbox("ann"), "a-wrong-password-1");
    expect(stopped.status).toBe(wrong.status);
    expect(stopped.status).toBeGreaterThanOrEqual(400);
    expect(stopped.cookie).toBe("");
    const ledger = await db
      .select()
      .from(ledgers)
      .where(eq(ledgers.id, bea.ledgerId));
    expect(ledger[0]?.deletedAt).toBeNull();
    expect((await row(bea.id)).deletedAt).toBeNull();
  });

  it("allows them again, and the list shows the change", async () => {
    const bea = await addPerson("bea");
    await call("PATCH", `/users/${bea.id}`, who.admin?.cookie, {
      disabled: true,
    });
    const back = await call("PATCH", `/users/${bea.id}`, who.admin?.cookie, {
      disabled: false,
    });
    expect(back.json().disabled).toBe(false);
    expect((await row(bea.id)).disabledAt).toBeNull();
    expect((await signIn(mailbox("bea"), temporary)).status).toBe(200);
  });

  it("is safe to repeat and does not touch anyone else", async () => {
    const bea = await addPerson("bea");
    const before = await row(who.ann?.id as string);
    for (let i = 0; i < 2; i++)
      expect(
        (
          await call("PATCH", `/users/${bea.id}`, who.admin?.cookie, {
            disabled: true,
          })
        ).statusCode,
      ).toBe(200);
    const after = await row(who.ann?.id as string);
    expect(after.disabledAt).toBeNull();
    expect(after.updatedAt).toEqual(before.updatedAt);
    expect(await liveSessions(who.ann?.id as string)).toBeGreaterThan(0);
  });

  it("refuses the admin stopping themselves (409) and changes nothing", async () => {
    const response = await call(
      "PATCH",
      `/users/${who.admin?.id}`,
      who.admin?.cookie,
      { disabled: true },
    );
    expect(response.statusCode).toBe(409);
    expect((await row(who.admin?.id as string)).disabledAt).toBeNull();
    expect((await call("GET", "/users", who.admin?.cookie)).statusCode).toBe(
      200,
    );
  });

  it("answers 404 for an unknown or deleted person and 400 for a bad body or id", async () => {
    const gone = await addPerson("gone");
    await call("DELETE", `/users/${gone.id}`, who.admin?.cookie);
    for (const id of [newId(), gone.id])
      expect(
        (
          await call("PATCH", `/users/${id}`, who.admin?.cookie, {
            disabled: true,
          })
        ).statusCode,
      ).toBe(404);
    expect(
      (await call("PATCH", `/users/${who.ann?.id}`, who.admin?.cookie, {}))
        .statusCode,
    ).toBe(400);
    expect(
      (
        await call("PATCH", `/users/${who.ann?.id}`, who.admin?.cookie, {
          disabled: "yes",
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await call("PATCH", "/users/not-an-id", who.admin?.cookie, {
          disabled: true,
        })
      ).statusCode,
    ).toBe(400);
    expect((await row(who.ann?.id as string)).disabledAt).toBeNull();
  });
});

describe("POST /users/{id}/password (a new temporary password)", () => {
  it("replaces the password, flags the person and ends their sessions", async () => {
    const ann = who.ann as { id: string; cookie: string };
    const phone = await signedIn(mailbox("ann"), own, {
      "x-ledgerline-client": "android",
    });
    const next = "another-temp-9999";
    const response = await call(
      "POST",
      `/users/${ann.id}/password`,
      who.admin?.cookie,
      {
        temporaryPassword: next,
      },
    );
    expect(response.statusCode, response.body).toBe(204);
    expect(response.body).not.toContain(next);
    expect((await row(ann.id)).mustChangePassword).toBe(true);
    expect(await liveSessions(ann.id)).toBe(0);
    expect((await call("GET", "/me", ann.cookie)).statusCode).toBe(401);
    expect(
      (
        await call("GET", "/me", undefined, undefined, {
          authorization: `Bearer ${phone.token}`,
        })
      ).statusCode,
    ).toBe(401);
    expect((await signIn(mailbox("ann"), own)).status).toBeGreaterThanOrEqual(
      400,
    );
    const fresh = await signedIn(mailbox("ann"), next);
    expect(
      (await call("GET", "/me", fresh.cookie)).json().mustChangePassword,
    ).toBe(true);
    expect((await call("GET", "/ledgers", fresh.cookie)).statusCode).toBe(403);
    const [login] = await db
      .select()
      .from(credentials)
      .where(eq(credentials.userId, ann.id));
    expect(login?.password).not.toContain(next);
  });

  it("leaves everyone else alone, and a stopped person stays stopped", async () => {
    const bea = await addPerson("bea");
    await call("PATCH", `/users/${bea.id}`, who.admin?.cookie, {
      disabled: true,
    });
    expect(
      (
        await call("POST", `/users/${bea.id}/password`, who.admin?.cookie, {
          temporaryPassword: "fresh-temp-pass-1",
        })
      ).statusCode,
    ).toBe(204);
    expect((await row(bea.id)).disabledAt).not.toBeNull();
    expect(
      (await signIn(mailbox("bea"), "fresh-temp-pass-1")).status,
    ).toBeGreaterThanOrEqual(400);
    expect((await call("GET", "/me", who.ann?.cookie)).statusCode).toBe(200);
    expect((await call("GET", "/me", who.admin?.cookie)).statusCode).toBe(200);
  });

  it("changes only that person's password: everyone else still signs in with theirs", async () => {
    await call("POST", `/users/${who.ann?.id}/password`, who.admin?.cookie, {
      temporaryPassword: "another-temp-9999",
    });
    expect((await signIn(mailbox("admin"), own)).status).toBe(200);
    expect(
      (await signIn(mailbox("admin"), "another-temp-9999")).status,
    ).toBeGreaterThanOrEqual(400);
    const bea = await addPerson("bea");
    await call("POST", `/users/${who.ann?.id}/password`, who.admin?.cookie, {
      temporaryPassword: "third-temp-password-1",
    });
    expect((await signIn(mailbox("bea"), temporary)).status).toBe(200);
    expect(bea.id).toBeDefined();
  });

  it("refuses the admin's own id (409), an unknown or deleted id (404) and a bad password (400)", async () => {
    expect(
      (
        await call(
          "POST",
          `/users/${who.admin?.id}/password`,
          who.admin?.cookie,
          { temporaryPassword: temporary },
        )
      ).statusCode,
    ).toBe(409);
    expect((await signIn(mailbox("admin"), own)).status).toBe(200);
    const gone = await addPerson("gone");
    await call("DELETE", `/users/${gone.id}`, who.admin?.cookie);
    for (const id of [newId(), gone.id])
      expect(
        (
          await call("POST", `/users/${id}/password`, who.admin?.cookie, {
            temporaryPassword: temporary,
          })
        ).statusCode,
      ).toBe(404);
    for (const payload of [
      { temporaryPassword: "short" },
      { temporaryPassword: "x".repeat(129) },
      {},
    ])
      expect(
        (
          await call(
            "POST",
            `/users/${who.ann?.id}/password`,
            who.admin?.cookie,
            payload,
          )
        ).statusCode,
      ).toBe(400);
    expect((await signIn(mailbox("ann"), own)).status).toBe(200);
  });
});

describe("DELETE /users/{id}/sessions", () => {
  it("ends that person's sessions and nobody else's", async () => {
    const bea = await addPerson("bea");
    await signedIn(mailbox("bea"));
    await signedIn(mailbox("bea"), temporary, {
      "x-ledgerline-client": "android",
    });
    expect(await liveSessions(bea.id)).toBe(2);
    const annBefore = await liveSessions(who.ann?.id as string);
    const response = await call(
      "DELETE",
      `/users/${bea.id}/sessions`,
      who.admin?.cookie,
    );
    expect(response.statusCode).toBe(204);
    expect(await liveSessions(bea.id)).toBe(0);
    expect(await liveSessions(who.ann?.id as string)).toBe(annBefore);
    expect(await liveSessions(who.admin?.id as string)).toBeGreaterThan(0);
    // Safe to repeat; the person can sign in again.
    expect(
      (await call("DELETE", `/users/${bea.id}/sessions`, who.admin?.cookie))
        .statusCode,
    ).toBe(204);
    expect((await signIn(mailbox("bea"), temporary)).status).toBe(200);
    expect((await row(bea.id)).mustChangePassword).toBe(true);
  });

  it("refuses the admin's own id (409) and an unknown or deleted id (404)", async () => {
    expect(
      (
        await call(
          "DELETE",
          `/users/${who.admin?.id}/sessions`,
          who.admin?.cookie,
        )
      ).statusCode,
    ).toBe(409);
    expect(await liveSessions(who.admin?.id as string)).toBeGreaterThan(0);
    const gone = await addPerson("gone");
    await call("DELETE", `/users/${gone.id}`, who.admin?.cookie);
    for (const id of [newId(), gone.id])
      expect(
        (await call("DELETE", `/users/${id}/sessions`, who.admin?.cookie))
          .statusCode,
      ).toBe(404);
  });
});

describe("DELETE /users/{id}/two-factor", () => {
  const enroll = async (id: string) => {
    await db.insert(twoFactor).values({
      userId: id,
      secret: "stored-secret",
      backupCodes: "stored-codes",
    });
    await db
      .update(user)
      .set({ twoFactorEnabled: true })
      .where(eq(user.id, id));
  };

  it("turns two-factor off for that person only and ends their sessions", async () => {
    const ann = who.ann as { id: string };
    const bea = await addPerson("bea");
    await enroll(ann.id);
    await enroll(bea.id);
    const list = async () =>
      managedUserListSchema.parse(
        (await call("GET", "/users", who.admin?.cookie)).json(),
      ).items;
    expect(
      (await list()).find((item) => item.id === ann.id)?.twoFactorEnabled,
    ).toBe(true);
    const response = await call(
      "DELETE",
      `/users/${ann.id}/two-factor`,
      who.admin?.cookie,
    );
    expect(response.statusCode, response.body).toBe(204);
    expect((await row(ann.id)).twoFactorEnabled).toBe(false);
    const secrets = await db
      .select()
      .from(twoFactor)
      .where(eq(twoFactor.userId, ann.id));
    expect(secrets).toHaveLength(1);
    expect(secrets[0]?.deletedAt).not.toBeNull();
    expect(await liveSessions(ann.id)).toBe(0);
    // Bea keeps hers.
    expect((await row(bea.id)).twoFactorEnabled).toBe(true);
    const kept = await db
      .select()
      .from(twoFactor)
      .where(eq(twoFactor.userId, bea.id));
    expect(kept[0]?.deletedAt).toBeNull();
    expect(
      (await list()).find((item) => item.id === bea.id)?.twoFactorEnabled,
    ).toBe(true);
    // Safe to repeat, also for a person without two-factor.
    expect(
      (await call("DELETE", `/users/${ann.id}/two-factor`, who.admin?.cookie))
        .statusCode,
    ).toBe(204);
    expect((await signIn(mailbox("ann"), own)).status).toBe(200);
  });

  it("refuses the admin's own id (409) and an unknown or deleted id (404)", async () => {
    await enroll(who.admin?.id as string);
    expect(
      (
        await call(
          "DELETE",
          `/users/${who.admin?.id}/two-factor`,
          who.admin?.cookie,
        )
      ).statusCode,
    ).toBe(409);
    expect((await row(who.admin?.id as string)).twoFactorEnabled).toBe(true);
    const gone = await addPerson("gone");
    await call("DELETE", `/users/${gone.id}`, who.admin?.cookie);
    for (const id of [newId(), gone.id])
      expect(
        (await call("DELETE", `/users/${id}/two-factor`, who.admin?.cookie))
          .statusCode,
      ).toBe(404);
  });
});

describe("DELETE /users/{id}", () => {
  it("soft-deletes the person, their ledger and memberships, and ends their sessions", async () => {
    const bea = await addPerson("bea");
    await signedIn(mailbox("bea"));
    const response = await call(
      "DELETE",
      `/users/${bea.id}`,
      who.admin?.cookie,
    );
    expect(response.statusCode, response.body).toBe(204);
    const stored = await row(bea.id);
    expect(stored.deletedAt).not.toBeNull();
    const [ledger] = await db
      .select()
      .from(ledgers)
      .where(eq(ledgers.id, bea.ledgerId));
    expect(ledger?.deletedAt).not.toBeNull();
    const members = await db
      .select()
      .from(ledgerMembers)
      .where(eq(ledgerMembers.userId, bea.id));
    expect(members).toHaveLength(1);
    expect(members[0]?.deletedAt).not.toBeNull();
    expect(await liveSessions(bea.id)).toBe(0);
    const logins = await db
      .select()
      .from(credentials)
      .where(eq(credentials.userId, bea.id));
    expect(logins).toHaveLength(1);
    expect(logins[0]?.deletedAt).not.toBeNull();
    // Nothing is removed for good, the sign-in is gone, and the person leaves the list.
    expect(
      await db.select().from(user).where(eq(user.id, bea.id)),
    ).toHaveLength(1);
    expect(
      (await signIn(mailbox("bea"), temporary)).status,
    ).toBeGreaterThanOrEqual(400);
    const list = await call("GET", "/users", who.admin?.cookie);
    expect(list.body).not.toContain(mailbox("bea"));
    // The background jobs no longer act for that ledger.
    expect((await listLedgerOwners(db)).map((item) => item.id)).not.toContain(
      bea.ledgerId,
    );
    // The email cannot be used again.
    expect(
      (
        await call("POST", "/users", who.admin?.cookie, {
          name: "Bea",
          email: mailbox("bea"),
          temporaryPassword: temporary,
        })
      ).statusCode,
    ).toBe(409);
  });

  it("deletes only that person: other people, their ledgers and sessions stay", async () => {
    const bea = await addPerson("bea");
    await call("DELETE", `/users/${bea.id}`, who.admin?.cookie);
    // Their sign-ins are whole: nobody else loses the ability to sign in.
    expect((await signIn(mailbox("ann"), own)).status).toBe(200);
    expect((await signIn(mailbox("admin"), own)).status).toBe(200);
    for (const name of ["ann", "admin"]) {
      const rows = await db
        .select()
        .from(credentials)
        .where(eq(credentials.userId, who[name]?.id as string));
      expect(rows.map((login) => login.deletedAt)).toEqual([null]);
    }
    for (const name of ["ann", "admin"]) {
      const person = who[name] as {
        id: string;
        ledgerId: string;
        cookie: string;
      };
      expect((await row(person.id)).deletedAt).toBeNull();
      const [ledger] = await db
        .select()
        .from(ledgers)
        .where(eq(ledgers.id, person.ledgerId));
      expect(ledger?.deletedAt).toBeNull();
      const members = await db
        .select()
        .from(ledgerMembers)
        .where(eq(ledgerMembers.userId, person.id));
      expect(members.every((member) => member.deletedAt === null)).toBe(true);
      expect((await call("GET", "/me", person.cookie)).statusCode).toBe(200);
    }
    expect((await listLedgerOwners(db)).map((item) => item.id)).toEqual(
      expect.arrayContaining([who.ann?.ledgerId, who.admin?.ledgerId]),
    );
  });

  it("leaves a ledger alone when another live person is a member of it", async () => {
    // Sharing is not built, so this cannot happen through the app; the rule is still pinned.
    const bea = await addPerson("bea");
    await db.insert(ledgerMembers).values({
      ledgerId: bea.ledgerId,
      userId: who.ann?.id as string,
      role: "editor",
    });
    expect(
      (await call("DELETE", `/users/${bea.id}`, who.admin?.cookie)).statusCode,
    ).toBe(204);
    const [ledger] = await db
      .select()
      .from(ledgers)
      .where(eq(ledgers.id, bea.ledgerId));
    expect(ledger?.deletedAt).toBeNull();
    const members = await db
      .select()
      .from(ledgerMembers)
      .where(eq(ledgerMembers.ledgerId, bea.ledgerId));
    expect(
      members.map((member) => [member.userId, member.deletedAt === null]),
    ).toEqual(
      expect.arrayContaining([
        [who.ann?.id, true],
        [bea.id, false],
      ]),
    );
    expect((await listLedgerOwners(db)).map((item) => item.id)).not.toContain(
      bea.ledgerId,
    );
  });

  it("answers 404 the second time, 404 for an unknown id and 409 for the admin themselves", async () => {
    const bea = await addPerson("bea");
    expect(
      (await call("DELETE", `/users/${bea.id}`, who.admin?.cookie)).statusCode,
    ).toBe(204);
    expect(
      (await call("DELETE", `/users/${bea.id}`, who.admin?.cookie)).statusCode,
    ).toBe(404);
    expect(
      (await call("DELETE", `/users/${newId()}`, who.admin?.cookie)).statusCode,
    ).toBe(404);
    expect(
      (await call("DELETE", `/users/${who.admin?.id}`, who.admin?.cookie))
        .statusCode,
    ).toBe(409);
    expect((await row(who.admin?.id as string)).deletedAt).toBeNull();
    const [ledger] = await db
      .select()
      .from(ledgers)
      .where(eq(ledgers.id, who.admin?.ledgerId as string));
    expect(ledger?.deletedAt).toBeNull();
    expect((await call("GET", "/users", who.admin?.cookie)).statusCode).toBe(
      200,
    );
  });
});

describe("what the server logs", () => {
  it("never holds a password or an email, whatever the answer", async () => {
    // A second app that really logs (the test one has its logger off), listening to everything written to the log.
    const canary = "log-canary-password-123";
    const writes: string[] = [];
    const spy = vi.spyOn(process.stdout, "write").mockImplementation(((
      data: unknown,
    ) => {
      writes.push(String(data));
      return true;
    }) as typeof process.stdout.write);
    const logging = await buildApp(db, { ...config, NODE_ENV: "development" });
    try {
      await logging.ready();
      const send = (
        method: "POST" | "PATCH" | "DELETE",
        path: string,
        payload?: unknown,
      ) =>
        logging.inject({
          method,
          url: `/api/v1${path}`,
          headers: { origin: config.APP_URL, cookie: who.admin?.cookie ?? "" },
          ...(payload === undefined ? {} : { payload: payload as object }),
        });
      const made = await send("POST", "/users", {
        name: "Logged Person",
        email: mailbox("logged"),
        temporaryPassword: canary,
      });
      expect(made.statusCode, made.body).toBe(201);
      const id = made.json().id;
      await send("POST", "/users", {
        name: "Logged Person",
        email: mailbox("logged"),
        temporaryPassword: canary,
      });
      await send("POST", "/users", {
        name: "Short",
        email: mailbox("short"),
        temporaryPassword: "short",
      });
      await send("POST", `/users/${id}/password`, {
        temporaryPassword: canary,
      });
      await send("PATCH", `/users/${id}`, { disabled: true });
      await send("DELETE", `/users/${id}`);
    } finally {
      await logging.close();
      spy.mockRestore();
    }
    const logged = writes.join("");
    // The capture works: the requests were logged, with their status, and nothing else.
    expect(logged).toContain("Request completed");
    expect(logged).toContain('"status":201');
    expect(logged).toContain('"status":409');
    expect(logged).toContain('"status":400');
    expect(logged).not.toContain(canary);
    expect(logged).not.toContain("example.com");
    expect(logged).not.toContain("Logged Person");
  });
});
