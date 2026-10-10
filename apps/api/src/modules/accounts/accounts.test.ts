import {
  type Account,
  accountListSchema,
  accountSchema,
  newId,
} from "@ledgerline/shared";
import { and, eq, inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../../app";
import { readConfig } from "../../config";
import { createDatabase } from "../../db/client";
import { applyMigrations } from "../../db/migrate";
import {
  accounts,
  account as credentials,
  ledgerMembers,
  ledgers,
  user,
  writeReceipts,
} from "../../db/schema";
import { provisionOwner } from "../auth/owner";
import { hashPassword } from "../auth/password";

const url = process.env.TEST_DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith("/ledgerline_test"))
  throw new Error(
    "Accounts tests require the dedicated ledgerline_test database.",
  );
const config = readConfig({
  NODE_ENV: "test",
  DATABASE_URL: url,
  APP_URL: "http://localhost:5173",
  BETTER_AUTH_SECRET: "accounts-test-secret-only-00000000000000000",
  OWNER_EMAIL: "accounts-owner@example.com",
  OWNER_PASSWORD: "Accounts-test-password-000",
  OWNER_NAME: "Accounts owner",
});
const { db, pool } = createDatabase(url);
const app = await buildApp(db, config);
let ledgerId = "";
let ownerId = "";
let ownerCookie = "";
let editorCookie = "";
let viewerCookie = "";
const secondLedger = newId();
const foreignLedger = newId();
const base = (ledger = ledgerId) => `/api/v1/ledgers/${ledger}/accounts`;
const input = (amount = 12345, type = "bank", name = "Checking") => ({
  name,
  type,
  openingBalance: { amount, currency: "USD" },
});
const headers = (cookie = ownerCookie, key = newId()) => ({
  "content-type": "application/json",
  cookie,
  origin: config.APP_URL,
  "idempotency-key": key,
});
const create = (
  payload: unknown = input(),
  ledger = ledgerId,
  cookie = ownerCookie,
  key = newId(),
) =>
  app.inject({
    method: "POST",
    url: base(ledger),
    headers: headers(cookie, key),
    payload: JSON.stringify(payload),
  });
const edit = (
  id: string,
  payload: unknown = { name: "Renamed", expectedVersion: 1 },
  ledger = ledgerId,
  cookie = ownerCookie,
  key = newId(),
) =>
  app.inject({
    method: "PATCH",
    url: `${base(ledger)}/${id}`,
    headers: headers(cookie, key),
    payload: JSON.stringify(payload),
  });
const archive = (
  id: string,
  expectedVersion = 1,
  ledger = ledgerId,
  cookie = ownerCookie,
  key = newId(),
) =>
  app.inject({
    method: "POST",
    url: `${base(ledger)}/${id}/archive`,
    headers: headers(cookie, key),
    payload: { expectedVersion },
  });
const unarchive = (
  id: string,
  expectedVersion = 1,
  ledger = ledgerId,
  cookie = ownerCookie,
  key = newId(),
) =>
  app.inject({
    method: "POST",
    url: `${base(ledger)}/${id}/unarchive`,
    headers: headers(cookie, key),
    payload: { expectedVersion },
  });
const read = (path: string, cookie = ownerCookie) =>
  app.inject({ url: path, headers: { cookie } });
async function saved(
  payload: unknown = input(),
  ledger = ledgerId,
): Promise<Account> {
  const response = await create(payload, ledger);
  expect(response.statusCode).toBe(201);
  return accountSchema.parse(response.json());
}
async function signIn(email: string) {
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/auth/sign-in/email",
    headers: { origin: config.APP_URL },
    payload: { email, password: config.OWNER_PASSWORD },
  });
  expect(response.statusCode).toBe(200);
  const cookie = response.headers["set-cookie"];
  return (Array.isArray(cookie) ? cookie : [cookie ?? ""])
    .map((value) => value.split(";")[0])
    .join("; ");
}

beforeAll(async () => {
  await applyMigrations(url);
  await db.execute(
    sql`TRUNCATE auth_sessions, auth_accounts, auth_verifications, ledger_members, ledgers, users CASCADE`,
  );
  await provisionOwner(db, config);
  const [owner] = await db
    .select()
    .from(user)
    .where(eq(user.email, config.OWNER_EMAIL));
  if (!owner) throw new Error("Missing test owner");
  ownerId = owner.id;
  const [membership] = await db
    .select()
    .from(ledgerMembers)
    .where(eq(ledgerMembers.userId, ownerId));
  if (!membership) throw new Error("Missing test ledger");
  ledgerId = membership.ledgerId;
  await db.insert(ledgers).values([
    { id: secondLedger, name: "Second accessible ledger" },
    { id: foreignLedger, name: "Foreign ledger" },
  ]);
  await db
    .insert(ledgerMembers)
    .values({ ledgerId: secondLedger, userId: ownerId, role: "owner" });
  const password = await hashPassword(config.OWNER_PASSWORD);
  for (const role of ["editor", "viewer"] as const) {
    const id = newId();
    await db
      .insert(user)
      .values({ id, name: role, email: `accounts-${role}@example.com` });
    await db.insert(credentials).values({
      userId: id,
      accountId: id,
      providerId: "credential",
      password,
    });
    await db.insert(ledgerMembers).values({ userId: id, ledgerId, role });
  }
  await app.ready();
  ownerCookie = await signIn(config.OWNER_EMAIL);
  editorCookie = await signIn("accounts-editor@example.com");
  viewerCookie = await signIn("accounts-viewer@example.com");
});
beforeEach(async () => {
  const scope = [ledgerId, secondLedger, foreignLedger];
  await db.delete(accounts).where(inArray(accounts.ledgerId, scope));
  await db.delete(writeReceipts).where(inArray(writeReceipts.ledgerId, scope));
  await db
    .update(ledgers)
    .set({ deletedAt: null })
    .where(inArray(ledgers.id, scope));
  await db
    .update(ledgerMembers)
    .set({ deletedAt: null })
    .where(inArray(ledgerMembers.ledgerId, scope));
});
afterAll(async () => {
  await app.close();
  await pool.end();
});

describe("Accounts API", () => {
  it("starts empty and creates each of the six account types without a balance cache", async () => {
    expect((await read(base())).json()).toEqual({
      items: [],
      nextCursor: null,
    });
    for (const type of ["bank", "cash", "card", "wallet", "loan", "savings"]) {
      const amount = type === "card" || type === "loan" ? -125050 : 12345;
      const account = await saved(input(amount, type, `  ${type}  `));
      expect(account.name).toBe(type);
      expect(account.ledgerId).toBe(ledgerId);
      expect(account.currency).toBe("USD");
      expect(account.openingBalance).toEqual({ amount, currency: "USD" });
      expect(account.balance).toEqual(account.openingBalance);
      expect(account.version).toBe(1);
      expect(account.archivedAt).toBeNull();
      expect((await read(`${base()}/${account.id}`)).json()).toEqual(account);
    }
    expect(
      accountListSchema.parse((await read(base())).json()).items,
    ).toHaveLength(6);
  });
  it("round-trips zero and safe integer boundaries exactly through PostgreSQL bigint", async () => {
    for (const amount of [
      0,
      -29,
      Number.MIN_SAFE_INTEGER,
      Number.MAX_SAFE_INTEGER,
    ]) {
      const account = await saved(input(amount));
      expect(account.balance.amount).toBe(amount);
      expect(
        (await read(`${base()}/${account.id}`)).json().openingBalance.amount,
      ).toBe(amount);
    }
  });
  it("validates account fields, USD-only money, IDs and bounded pagination", async () => {
    for (const payload of [
      input(1.25),
      input(Number.MAX_SAFE_INTEGER + 1),
      input(0, "crypto"),
      input(0, "bank", " "),
      input(0, "bank", "a".repeat(101)),
      { ...input(), openingBalance: { amount: 123, currency: "BDT" } },
      { ...input(), ledgerId: secondLedger },
      { ...input(), archivedAt: new Date().toISOString() },
    ]) {
      const response = await create(payload);
      expect(response.statusCode).toBe(400);
      expect(response.headers["content-type"]).toContain(
        "application/problem+json",
      );
      expect(response.json().errors.length).toBeGreaterThan(0);
    }
    expect((await read(base("invalid"))).statusCode).toBe(400);
    expect((await read(`${base()}/invalid`)).statusCode).toBe(400);
    for (const query of [
      "limit=0",
      "limit=101",
      "limit=2.5",
      "cursor=invalid",
      "status=deleted",
    ])
      expect((await read(`${base()}?${query}`)).statusCode).toBe(400);
    expect(await db.select().from(accounts)).toHaveLength(0);
    expect(await db.select().from(writeReceipts)).toHaveLength(0);
  });
  it("requires authentication for all five endpoints", async () => {
    const account = await saved();
    for (const response of await Promise.all([
      read(base(), ""),
      read(`${base()}/${account.id}`, ""),
      create(input(), ledgerId, ""),
      edit(
        account.id,
        { name: "Unauthorized", expectedVersion: 1 },
        ledgerId,
        "",
      ),
      archive(account.id, 1, ledgerId, ""),
    ]))
      expect(response.statusCode).toBe(401);
  });
  it("allows viewer reads, editor writes, and denies all three viewer mutations", async () => {
    const account = await saved();
    expect((await read(base(), viewerCookie)).statusCode).toBe(200);
    expect(
      (await read(`${base()}/${account.id}`, viewerCookie)).statusCode,
    ).toBe(200);
    expect((await create(input(), ledgerId, viewerCookie)).statusCode).toBe(
      403,
    );
    expect(
      (
        await edit(
          account.id,
          { name: "Denied", expectedVersion: 1 },
          ledgerId,
          viewerCookie,
        )
      ).statusCode,
    ).toBe(403);
    expect(
      (await archive(account.id, 1, ledgerId, viewerCookie)).statusCode,
    ).toBe(403);
    const editorAccount = accountSchema.parse(
      (await create(input(), ledgerId, editorCookie)).json(),
    );
    expect(
      (
        await edit(
          editorAccount.id,
          { name: "Editor edit", expectedVersion: 1 },
          ledgerId,
          editorCookie,
        )
      ).statusCode,
    ).toBe(200);
    expect(
      (await archive(editorAccount.id, 2, ledgerId, editorCookie)).statusCode,
    ).toBe(200);
  });
  it("denies foreign ledgers for every endpoint and cannot retarget a create", async () => {
    const account = await saved();
    for (const response of await Promise.all([
      read(base(foreignLedger)),
      read(`${base(foreignLedger)}/${account.id}`),
      create(input(), foreignLedger),
      edit(account.id, { name: "Denied", expectedVersion: 1 }, foreignLedger),
      archive(account.id, 1, foreignLedger),
    ]))
      expect(response.statusCode).toBe(404);
    expect(await db.select().from(accounts)).toHaveLength(1);
    expect(
      (await create({ ...input(), ledgerId: secondLedger })).statusCode,
    ).toBe(400);
  });
  it("scopes list, detail, edit and archive when both ledgers are accessible", async () => {
    const local = await saved();
    const other = await saved(input(-999, "loan", "Other debt"), secondLedger);
    expect(
      (await read(base())).json().items.map((item: Account) => item.id),
    ).toEqual([local.id]);
    expect(
      (await read(base(secondLedger)))
        .json()
        .items.map((item: Account) => item.id),
    ).toEqual([other.id]);
    expect((await read(`${base()}/${other.id}`)).statusCode).toBe(404);
    expect((await edit(other.id)).statusCode).toBe(404);
    expect((await archive(other.id)).statusCode).toBe(404);
    expect((await read(`${base(secondLedger)}/${other.id}`)).json()).toEqual(
      other,
    );
  });
  it("requires write keys and trusted origins for every mutation", async () => {
    const account = await saved();
    const mutations = [
      { method: "POST" as const, path: base(), payload: input() },
      {
        method: "PATCH" as const,
        path: `${base()}/${account.id}`,
        payload: { name: "Edit", expectedVersion: 1 },
      },
      {
        method: "POST" as const,
        path: `${base()}/${account.id}/archive`,
        payload: { expectedVersion: 1 },
      },
    ];
    for (const mutation of mutations) {
      for (const key of [undefined, "short"]) {
        const response = await app.inject({
          method: mutation.method,
          url: mutation.path,
          payload: mutation.payload,
          headers: {
            cookie: ownerCookie,
            origin: config.APP_URL,
            ...(key ? { "idempotency-key": key } : {}),
          },
        });
        expect(response.statusCode).toBe(400);
      }
      for (const origin of [undefined, "https://evil.example"]) {
        const response = await app.inject({
          method: mutation.method,
          url: mutation.path,
          payload: mutation.payload,
          headers: {
            cookie: ownerCookie,
            "idempotency-key": newId(),
            ...(origin ? { origin } : {}),
          },
        });
        expect(response.statusCode).toBe(403);
      }
    }
  });
  it("commits concurrent retries across UUID casing only once and rejects a changed request", async () => {
    const key = newId();
    const responses = await Promise.all([
      create(input(-29), ledgerId.toUpperCase(), ownerCookie, key),
      create(input(-29), ledgerId, ownerCookie, key),
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
    expect(
      (await create(input(-30), ledgerId, ownerCookie, key)).statusCode,
    ).toBe(409);
    expect(await db.select().from(accounts)).toHaveLength(1);
  });
  it("edits name, type and opening balance with a version guard and replay", async () => {
    const account = await saved();
    const key = newId();
    const body = {
      expectedVersion: 1,
      name: "  Credit card  ",
      type: "card",
      openingBalance: { amount: -56789, currency: "USD" },
    };
    const first = await edit(account.id, body, ledgerId, ownerCookie, key);
    expect(first.statusCode).toBe(200);
    const updated = accountSchema.parse(first.json());
    expect(updated.name).toBe("Credit card");
    expect(updated.type).toBe("card");
    expect(updated.balance.amount).toBe(-56789);
    expect(updated.version).toBe(2);
    expect(updated.createdAt).toBe(account.createdAt);
    const replay = await edit(account.id, body, ledgerId, ownerCookie, key);
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toEqual(updated);
    expect(replay.headers["idempotency-replayed"]).toBe("true");
    const stale = await edit(account.id);
    expect(stale.statusCode).toBe(409);
    expect(stale.json().errors[0].field).toBe("expectedVersion");
    expect((await read(`${base()}/${account.id}`)).json()).toEqual(updated);
  });
  it("does not allow version-only edits or currency changes", async () => {
    const account = await saved();
    for (const body of [
      { expectedVersion: 1 },
      { name: "Missing version" },
      { name: "Invalid", expectedVersion: 0 },
      { name: "Currency change", expectedVersion: 1, currency: "BDT" },
      { expectedVersion: 1, openingBalance: { amount: 1, currency: "BDT" } },
    ])
      expect((await edit(account.id, body)).statusCode).toBe(400);
    expect((await read(`${base()}/${account.id}`)).json()).toEqual(account);
  });
  it("allows only one simultaneous edit from the same version", async () => {
    const account = await saved();
    const responses = await Promise.all([
      edit(account.id, { name: "First", expectedVersion: 1 }),
      edit(account.id, { name: "Second", expectedVersion: 1 }),
    ]);
    expect(responses.map((response) => response.statusCode).sort()).toEqual([
      200, 409,
    ]);
    expect((await read(`${base()}/${account.id}`)).json().version).toBe(2);
    expect(await db.select().from(writeReceipts)).toHaveLength(2);
  });
  it("archives without deleting history or changing the balance, and replays safely", async () => {
    const account = await saved(input(-9850, "loan"));
    const key = newId();
    const first = await archive(account.id, 1, ledgerId, ownerCookie, key);
    expect(first.statusCode).toBe(200);
    const archived = accountSchema.parse(first.json());
    expect(archived.archivedAt).not.toBeNull();
    expect(archived.balance).toEqual(account.balance);
    expect(archived.openingBalance).toEqual(account.openingBalance);
    expect(archived.version).toBe(2);
    expect((await read(`${base()}/${account.id}`)).json()).toEqual(archived);
    expect((await read(`${base()}?status=active`)).json().items).toEqual([]);
    expect((await read(`${base()}?status=archived`)).json().items).toEqual([
      archived,
    ]);
    expect((await read(base())).json().items).toEqual([archived]);
    const replay = await archive(account.id, 1, ledgerId, ownerCookie, key);
    expect(replay.json()).toEqual(archived);
    expect(replay.headers["idempotency-replayed"]).toBe("true");
    expect((await archive(account.id, 2)).statusCode).toBe(409);
    expect((await db.select().from(accounts))[0]?.deletedAt).toBeNull();
  });
  it("unarchives an account with its identity, balance and history, and replays safely", async () => {
    const account = await saved(input(-9850, "loan"));
    const archived = accountSchema.parse((await archive(account.id)).json());
    const key = newId();
    const first = await unarchive(account.id, 2, ledgerId, ownerCookie, key);
    expect(first.statusCode, first.body).toBe(200);
    const restored = accountSchema.parse(first.json());
    expect(restored.id).toBe(account.id);
    expect(restored.archivedAt).toBeNull();
    expect(restored.balance).toEqual(archived.balance);
    expect(restored.openingBalance).toEqual(account.openingBalance);
    expect(restored.version).toBe(3);
    expect((await read(`${base()}?status=active`)).json().items).toEqual([
      restored,
    ]);
    expect((await read(`${base()}?status=archived`)).json().items).toEqual([]);
    const replay = await unarchive(account.id, 2, ledgerId, ownerCookie, key);
    expect(replay.json()).toEqual(restored);
    expect(replay.headers["idempotency-replayed"]).toBe("true");
    // Not archived any more, stale versions and a missing account all fail safely.
    expect((await unarchive(account.id, 3)).statusCode).toBe(409);
    expect((await archive(account.id, 3)).statusCode).toBe(200);
    expect((await unarchive(account.id, 3)).statusCode).toBe(409);
    expect((await unarchive(newId(), 1)).statusCode).toBe(404);
  });
  it("restricts unarchive to writers inside the same ledger", async () => {
    const account = await saved();
    expect((await archive(account.id)).statusCode).toBe(200);
    expect((await unarchive(account.id, 2, ledgerId, "")).statusCode).toBe(401);
    expect(
      (await unarchive(account.id, 2, ledgerId, viewerCookie)).statusCode,
    ).toBe(403);
    expect((await unarchive(account.id, 2, foreignLedger)).statusCode).toBe(
      404,
    );
    expect(
      (await unarchive(account.id, 2, ledgerId, editorCookie)).statusCode,
    ).toBe(200);
  });
  it("guards stale archive actions and preserves archive state during correction", async () => {
    const account = await saved();
    await edit(account.id);
    expect((await archive(account.id)).statusCode).toBe(409);
    const archived = accountSchema.parse((await archive(account.id, 2)).json());
    const corrected = accountSchema.parse(
      (
        await edit(account.id, { name: "Old checking", expectedVersion: 3 })
      ).json(),
    );
    expect(corrected.archivedAt).toBe(archived.archivedAt);
    expect(corrected.balance).toEqual(archived.balance);
    expect(corrected.version).toBe(4);
  });
  it("fingerprints each target and operation when a write key is reused", async () => {
    const first = await saved();
    const second = await saved();
    const key = newId();
    expect(
      (
        await edit(
          first.id,
          { name: "Edited", expectedVersion: 1 },
          ledgerId,
          ownerCookie,
          key,
        )
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await edit(
          second.id,
          { name: "Edited", expectedVersion: 1 },
          ledgerId,
          ownerCookie,
          key,
        )
      ).statusCode,
    ).toBe(409);
    expect(
      (await archive(first.id, 2, ledgerId, ownerCookie, key)).statusCode,
    ).toBe(409);
    expect((await read(`${base()}/${second.id}`)).json()).toEqual(second);
  });
  it("paginates without duplicates or skipped entries and filters archived accounts", async () => {
    const all: Account[] = [];
    for (let i = 0; i < 5; i++)
      all.push(await saved(input(i, "cash", `Account ${i}`)));
    const archivedId = all[2]?.id;
    if (!archivedId) throw new Error("Missing fixture");
    await archive(archivedId);
    const ids: string[] = [];
    let path = `${base()}?limit=2`;
    let pages = 0;
    while (true) {
      const page = accountListSchema.parse((await read(path)).json());
      pages++;
      ids.push(...page.items.map((item) => item.id));
      if (!page.nextCursor) break;
      if (pages > 3) throw new Error("Cursor failed to advance");
      path = `${base()}?limit=2&cursor=${page.nextCursor}`;
    }
    expect(pages).toBe(3);
    expect(ids).toEqual(all.map((account) => account.id).sort());
    expect((await read(`${base()}?status=active`)).json().items).toHaveLength(
      4,
    );
    expect(
      (await read(`${base()}?status=archived`))
        .json()
        .items.map((item: Account) => item.id),
    ).toEqual([archivedId]);
  });
  it("hides account tombstones in lists, details and both target mutations", async () => {
    const account = await saved();
    await db
      .update(accounts)
      .set({ deletedAt: new Date() })
      .where(and(eq(accounts.id, account.id), eq(accounts.ledgerId, ledgerId)));
    expect((await read(base())).json().items).toEqual([]);
    expect((await read(`${base()}/${account.id}`)).statusCode).toBe(404);
    expect((await edit(account.id)).statusCode).toBe(404);
    expect((await archive(account.id)).statusCode).toBe(404);
  });
  it("rechecks soft-deleted ledgers and memberships for all endpoints and retries", async () => {
    const key = newId();
    const first = await create(input(), ledgerId, ownerCookie, key);
    const account = accountSchema.parse(first.json());
    const scope = and(
      eq(ledgerMembers.userId, ownerId),
      eq(ledgerMembers.ledgerId, ledgerId),
    );
    for (const target of ["membership", "ledger"] as const) {
      if (target === "membership")
        await db
          .update(ledgerMembers)
          .set({ deletedAt: new Date() })
          .where(scope);
      else
        await db
          .update(ledgers)
          .set({ deletedAt: new Date() })
          .where(eq(ledgers.id, ledgerId));
      for (const response of await Promise.all([
        read(base()),
        read(`${base()}/${account.id}`),
        create(input(), ledgerId, ownerCookie, key),
        edit(account.id),
        archive(account.id),
      ]))
        expect(response.statusCode).toBe(404);
      await db.update(ledgerMembers).set({ deletedAt: null }).where(scope);
      await db
        .update(ledgers)
        .set({ deletedAt: null })
        .where(eq(ledgers.id, ledgerId));
    }
    expect(await db.select().from(accounts)).toHaveLength(1);
  });
  it("generates OpenAPI for all endpoints with money, version, key and error contracts", async () => {
    const doc = (await app.inject({ url: "/api/v1/openapi.json" })).json();
    expect(doc.info.version).toBe("0.1.21");
    const prefix = "/api/v1/ledgers/{ledgerId}/accounts";
    for (const [path, method] of [
      [prefix, "get"],
      [prefix, "post"],
      [`${prefix}/{accountId}`, "get"],
      [`${prefix}/{accountId}`, "patch"],
      [`${prefix}/{accountId}/archive`, "post"],
    ]) {
      const operation = doc.paths[path as string][method as string];
      expect(operation.security).toEqual([{ sessionCookie: [] }]);
      expect(operation.responses["404"]).toBeDefined();
      expect(operation.responses["400"]).toBeDefined();
      if (method !== "get") {
        expect(operation.parameters).toContainEqual(
          expect.objectContaining({
            name: "idempotency-key",
            in: "header",
            required: true,
          }),
        );
        expect(operation.responses["409"]).toBeDefined();
      }
    }
  });
});
