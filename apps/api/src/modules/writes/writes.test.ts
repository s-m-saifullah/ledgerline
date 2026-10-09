import { newId, usdMoneySchema, versionSchema } from "@ledgerline/shared";
import { and, eq, isNull, sql } from "drizzle-orm";
import { integer, pgTable, timestamp, uuid } from "drizzle-orm/pg-core";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { buildApp } from "../../app";
import { readConfig } from "../../config";
import { createDatabase } from "../../db/client";
import { applyMigrations } from "../../db/migrate";
import {
  account,
  ledgerMembers,
  ledgers,
  user,
  writeReceipts,
} from "../../db/schema";
import { ApiProblem } from "../../lib/problem";
import { provisionOwner } from "../auth/owner";
import { hashPassword } from "../auth/password";
import { createAuth } from "../auth/service";
import { financialWriteIdentity, sendFinancialWrite } from "./http";
import { runFinancialWrite } from "./service";
import { nextVersion, requireVersionUpdate } from "./version";

const url = process.env.TEST_DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith("/ledgerline_test"))
  throw new Error(
    "Writes tests require the dedicated ledgerline_test database.",
  );
const config = readConfig({
  NODE_ENV: "test",
  DATABASE_URL: url,
  APP_URL: "http://localhost:5173",
  BETTER_AUTH_SECRET: "writes-test-secret-only-000000000000000000",
  OWNER_EMAIL: "writes-owner@example.com",
  OWNER_PASSWORD: "Writes-test-password-000",
  OWNER_NAME: "Writes owner",
});
const { db, pool } = createDatabase(url);
const app = await buildApp(db, config);
const auth = createAuth(db, config);
// Probe resources/routes exist only in this test database and test app.
const entries = pgTable("write_foundation_test_entries", {
  id: uuid("id").primaryKey().$defaultFn(newId),
  ledgerId: uuid("ledger_id").notNull(),
  amount: integer("amount").notNull(),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  deletedAt: timestamp("deleted_at"),
});
const createSchema = z.object({ money: usdMoneySchema });
const updateSchema = createSchema.extend({ expectedVersion: versionSchema });
let failWrite = false;
let ownerId = "";
let ledgerId = "";
const editorId = newId();
const viewerId = newId();
const foreignLedger = newId();
const secondLedger = newId();
let ownerCookie = "";
let editorCookie = "";
let viewerCookie = "";

app.post(
  "/api/v1/ledgers/:ledgerId/test-writes",
  { schema: { hide: true, body: createSchema } },
  async (request, reply) => {
    const identity = await financialWriteIdentity(auth, config, request);
    const result = await runFinancialWrite(
      db,
      { ...identity, operation: "POST test-writes", request: request.body },
      async ({ tx, ledgerId }) => {
        const [entry] = await tx
          .insert(entries)
          .values({ ledgerId, amount: request.body.money.amount })
          .returning();
        if (!entry) throw new Error("Missing probe entry");
        await tx.execute(sql`SELECT pg_sleep(0.025)`);
        if (failWrite)
          throw new Error("Private financial text must never be exposed");
        return {
          status: 201,
          body: {
            id: entry.id,
            money: request.body.money,
            version: entry.version,
          },
        };
      },
    );
    return sendFinancialWrite(reply, result);
  },
);
app.patch(
  "/api/v1/ledgers/:ledgerId/test-writes/:id",
  { schema: { hide: true, body: updateSchema } },
  async (request, reply) => {
    const identity = await financialWriteIdentity(auth, config, request);
    const id = (request.params as { id: string }).id;
    const result = await runFinancialWrite(
      db,
      {
        ...identity,
        operation: `PATCH test-writes/${id}`,
        request: request.body,
      },
      async ({ tx, ledgerId }) => {
        const scope = and(
          eq(entries.id, id),
          eq(entries.ledgerId, ledgerId),
          isNull(entries.deletedAt),
        );
        const [current] = await tx.select().from(entries).where(scope);
        if (!current)
          throw new ApiProblem(404, "Not found", "Entry not found.");
        const version = nextVersion(
          current.version,
          request.body.expectedVersion,
        );
        const entry = requireVersionUpdate(
          await tx
            .update(entries)
            .set({
              amount: request.body.money.amount,
              version,
              updatedAt: new Date(),
            })
            .where(
              and(scope, eq(entries.version, request.body.expectedVersion)),
            )
            .returning(),
        );
        return {
          status: 200,
          body: {
            id: entry.id,
            money: request.body.money,
            version: entry.version,
          },
        };
      },
    );
    return sendFinancialWrite(reply, result);
  },
);

async function signIn(email: string) {
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/auth/sign-in/email",
    headers: { origin: config.APP_URL },
    payload: { email, password: config.OWNER_PASSWORD },
  });
  expect(response.statusCode).toBe(200);
  const header = response.headers["set-cookie"];
  return (Array.isArray(header) ? header : [header ?? ""])
    .map((value) => value.split(";")[0])
    .join("; ");
}
const money = (amount = -125) => ({ money: { amount, currency: "USD" } });
function create(
  key = newId(),
  cookie = ownerCookie,
  ledger = ledgerId,
  payload = money(),
) {
  return app.inject({
    method: "POST",
    url: `/api/v1/ledgers/${ledger}/test-writes`,
    headers: { cookie, origin: config.APP_URL, "idempotency-key": key },
    payload,
  });
}
function update(
  id: string,
  key = newId(),
  expectedVersion = 1,
  ledger = ledgerId,
) {
  return app.inject({
    method: "PATCH",
    url: `/api/v1/ledgers/${ledger}/test-writes/${id}`,
    headers: {
      cookie: ownerCookie,
      origin: config.APP_URL,
      "idempotency-key": key,
    },
    payload: { ...money(-250), expectedVersion },
  });
}
async function counts() {
  return [
    (await db.select().from(entries)).length,
    (await db.select().from(writeReceipts)).length,
  ];
}

beforeAll(async () => {
  await applyMigrations(url);
  await db.execute(
    sql`TRUNCATE auth_sessions, auth_accounts, auth_verifications, ledger_members, ledgers, users CASCADE`,
  );
  await db.execute(
    sql`CREATE TABLE write_foundation_test_entries (id uuid PRIMARY KEY, ledger_id uuid NOT NULL REFERENCES ledgers(id), amount integer NOT NULL, version integer NOT NULL DEFAULT 1, created_at timestamp NOT NULL DEFAULT now(), updated_at timestamp NOT NULL DEFAULT now(), deleted_at timestamp)`,
  );
  await provisionOwner(db, config);
  const [owner] = await db
    .select()
    .from(user)
    .where(eq(user.email, config.OWNER_EMAIL));
  if (!owner) throw new Error("Missing owner");
  ownerId = owner.id;
  const [membership] = await db
    .select()
    .from(ledgerMembers)
    .where(eq(ledgerMembers.userId, ownerId));
  if (!membership) throw new Error("Missing owner ledger");
  ledgerId = membership.ledgerId;
  const password = await hashPassword(config.OWNER_PASSWORD);
  for (const [id, role] of [
    [editorId, "editor"],
    [viewerId, "viewer"],
  ] as const) {
    await db
      .insert(user)
      .values({ id, name: role, email: `${role}@example.com` });
    await db.insert(account).values({
      userId: id,
      accountId: id,
      providerId: "credential",
      password,
    });
    await db.insert(ledgerMembers).values({ ledgerId, userId: id, role });
  }
  await db.insert(ledgers).values([
    { id: foreignLedger, name: "Foreign ledger" },
    { id: secondLedger, name: "Second owner ledger" },
  ]);
  await db
    .insert(ledgerMembers)
    .values({ ledgerId: secondLedger, userId: ownerId, role: "owner" });
  await app.ready();
  ownerCookie = await signIn(config.OWNER_EMAIL);
  editorCookie = await signIn("editor@example.com");
  viewerCookie = await signIn("viewer@example.com");
});
beforeEach(async () => {
  failWrite = false;
  await db.execute(sql`TRUNCATE write_foundation_test_entries, write_receipts`);
  await db.update(ledgers).set({ deletedAt: null });
  await db.update(ledgerMembers).set({ deletedAt: null });
  await db
    .update(ledgerMembers)
    .set({ role: "owner" })
    .where(eq(ledgerMembers.userId, ownerId));
});
afterAll(async () => {
  await app.close();
  await db.execute(sql`DROP TABLE IF EXISTS write_foundation_test_entries`);
  await pool.end();
});

describe("safe financial writes", () => {
  it("requires a session, a trusted origin, a valid key and ledger ID", async () => {
    expect((await create(newId(), "")).statusCode).toBe(401);
    for (const origin of [undefined, "https://evil.example"]) {
      const response = await app.inject({
        method: "POST",
        url: `/api/v1/ledgers/${ledgerId}/test-writes`,
        headers: {
          cookie: ownerCookie,
          ...(origin ? { origin } : {}),
          "idempotency-key": newId(),
        },
        payload: money(),
      });
      expect(response.statusCode).toBe(403);
    }
    const invalidKey = await create("short");
    expect(invalidKey.statusCode).toBe(400);
    expect(invalidKey.json().errors[0].field).toBe("Idempotency-Key");
    expect((await create(newId(), ownerCookie, "invalid")).statusCode).toBe(
      400,
    );
    expect(await counts()).toEqual([0, 0]);
  });
  it("permits owners/editors but denies viewers and foreign ledgers", async () => {
    expect((await create(newId(), viewerCookie)).statusCode).toBe(403);
    expect((await create(newId(), ownerCookie, foreignLedger)).statusCode).toBe(
      404,
    );
    expect(await counts()).toEqual([0, 0]);
    expect((await create()).statusCode).toBe(201);
    expect((await create(newId(), editorCookie)).statusCode).toBe(201);
    expect(await counts()).toEqual([2, 2]);
  });
  it("performs one mutation for simultaneous retries with equivalent JSON", async () => {
    const key = newId();
    const responses = await Promise.all([
      create(key),
      create(key, ownerCookie, ledgerId, {
        money: { currency: "USD", amount: -125 },
      }),
    ]);
    expect(responses.map((response) => response.statusCode)).toEqual([
      201, 201,
    ]);
    expect(responses[0]?.json()).toEqual(responses[1]?.json());
    expect(
      responses.filter(
        (response) => response.headers["idempotency-replayed"] === "true",
      ),
    ).toHaveLength(1);
    expect(await counts()).toEqual([1, 1]);
  });
  it("conflicts on changed payload or operation without another mutation", async () => {
    const key = newId();
    const first = await create(key);
    expect(
      (await create(key, ownerCookie, ledgerId, money(-126))).statusCode,
    ).toBe(409);
    expect((await update(first.json().id, key)).statusCode).toBe(409);
    expect(await counts()).toEqual([1, 1]);
  });
  it("separates the same key for different actors and ledgers", async () => {
    const key = newId();
    expect((await create(key)).statusCode).toBe(201);
    expect((await create(key, editorCookie)).statusCode).toBe(201);
    expect((await create(key, ownerCookie, secondLedger)).statusCode).toBe(201);
    expect(await counts()).toEqual([3, 3]);
  });
  it("rolls back failures and permits retry with the original key", async () => {
    const key = newId();
    failWrite = true;
    const failed = await create(key);
    expect(failed.statusCode).toBe(500);
    expect(failed.headers["content-type"]).toContain(
      "application/problem+json",
    );
    expect(failed.body).not.toContain("Private financial text");
    expect(await counts()).toEqual([0, 0]);
    failWrite = false;
    expect((await create(key)).statusCode).toBe(201);
    expect(await counts()).toEqual([1, 1]);
  });
  it("persists replay across a new database connection", async () => {
    const key = newId();
    const first = await create(key);
    const restarted = createDatabase(url);
    try {
      const result = await runFinancialWrite(
        restarted.db,
        {
          actorId: ownerId,
          ledgerId,
          key,
          operation: "POST test-writes",
          request: money(),
        },
        async () => {
          throw new Error("Must not mutate on replay");
        },
      );
      expect(result).toEqual({
        status: 201,
        body: first.json(),
        replayed: true,
      });
    } finally {
      await restarted.pool.end();
    }
  });
  it("rechecks revoked roles, memberships and ledger tombstones on replay", async () => {
    const key = newId();
    await create(key);
    const scope = and(
      eq(ledgerMembers.userId, ownerId),
      eq(ledgerMembers.ledgerId, ledgerId),
    );
    await db.update(ledgerMembers).set({ role: "viewer" }).where(scope);
    expect((await create(key)).statusCode).toBe(403);
    await db
      .update(ledgerMembers)
      .set({ role: "owner", deletedAt: new Date() })
      .where(scope);
    expect((await create(key)).statusCode).toBe(404);
    await db.update(ledgerMembers).set({ deletedAt: null }).where(scope);
    await db
      .update(ledgers)
      .set({ deletedAt: new Date() })
      .where(eq(ledgers.id, ledgerId));
    expect((await create(key)).statusCode).toBe(404);
    expect(await counts()).toEqual([1, 1]);
  });
  it("rejects stale edits while replaying a successful edit exactly once", async () => {
    const first = await create();
    const id = first.json().id;
    const key = newId();
    const edited = await update(id, key);
    expect(edited.statusCode).toBe(200);
    expect(edited.json().version).toBe(2);
    const replay = await update(id, key);
    expect(replay.json()).toEqual(edited.json());
    expect(replay.headers["idempotency-replayed"]).toBe("true");
    const stale = await update(id);
    expect(stale.statusCode).toBe(409);
    expect(stale.json().errors[0].field).toBe("expectedVersion");
    expect((await db.select().from(entries))[0]?.version).toBe(2);
    expect(await counts()).toEqual([1, 2]);
  });
  it("cannot update another ledger's resource or a soft-deleted resource", async () => {
    const first = await create(newId(), ownerCookie, secondLedger);
    expect((await update(first.json().id)).statusCode).toBe(404);
    await db.update(entries).set({ deletedAt: new Date() });
    expect(
      (await update(first.json().id, newId(), 1, secondLedger)).statusCode,
    ).toBe(404);
    expect(await counts()).toEqual([1, 1]);
  });
  it("allows only one of two concurrent edits from the same version", async () => {
    const first = await create();
    const responses = await Promise.all([
      update(first.json().id),
      update(first.json().id),
    ]);
    expect(responses.map((response) => response.statusCode).sort()).toEqual([
      200, 409,
    ]);
    expect((await db.select().from(entries))[0]?.version).toBe(2);
    expect(await counts()).toEqual([1, 2]);
  });
  it("persists no-content responses without running the mutation twice", async () => {
    const input = {
      actorId: ownerId,
      ledgerId,
      key: newId(),
      operation: "DELETE probe",
      request: {},
    };
    const first = await runFinancialWrite(db, input, async () => ({
      status: 204,
      body: null,
    }));
    const replay = await runFinancialWrite(db, input, async () => {
      throw new Error("Must not repeat deletion");
    });
    expect(first).toEqual({ status: 204, body: null, replayed: false });
    expect(replay).toEqual({ ...first, replayed: true });
    expect(await counts()).toEqual([0, 1]);
  });
  it("rejects invalid money and returns safe field details", async () => {
    const response = await create(newId(), ownerCookie, ledgerId, money(1.25));
    expect(response.statusCode).toBe(400);
    expect(response.json().errors).toContainEqual({
      field: "body.money.amount",
      message: "Check this field.",
    });
    expect(await counts()).toEqual([0, 0]);
  });
  it("keeps tombstoned receipt keys reserved", async () => {
    const key = newId();
    await create(key);
    await db.update(writeReceipts).set({ deletedAt: new Date() });
    expect((await create(key)).statusCode).toBe(409);
    expect(await counts()).toEqual([1, 1]);
  });
  it("rolls back a mutation if its response cannot be serialized", async () => {
    await expect(
      runFinancialWrite(
        db,
        {
          actorId: ownerId,
          ledgerId,
          key: newId(),
          operation: "invalid response",
          request: {},
        },
        async ({ tx }) => {
          await tx.insert(entries).values({ ledgerId, amount: 50 });
          return { status: 201, body: { amount: Number.NaN } };
        },
      ),
    ).rejects.toThrow("Expected JSON data");
    expect(await counts()).toEqual([0, 0]);
  });
  it("bounds versions and treats lost compare-and-set updates as conflicts", () => {
    expect(nextVersion(1, 1)).toBe(2);
    expect(() => nextVersion(1, 0)).toThrow(ApiProblem);
    expect(() => nextVersion(2, 1)).toThrow(ApiProblem);
    expect(() => nextVersion(2_147_483_647, 2_147_483_647)).toThrow(ApiProblem);
    expect(() => requireVersionUpdate([])).toThrow(ApiProblem);
  });
});
