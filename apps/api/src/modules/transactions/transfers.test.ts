import {
  createTransferSchema,
  newId,
  type Transfer,
  transactionSchema,
  transferSchema,
} from "@ledgerline/shared";
import { and, eq, inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../../app";
import { readConfig } from "../../config";
import { createDatabase } from "../../db/client";
import { applyMigrations } from "../../db/migrate";
import {
  accounts,
  categories,
  account as credentials,
  ledgerMembers,
  ledgers,
  session,
  transactions,
  user,
  writeReceipts,
} from "../../db/schema";
import { hashPassword } from "../auth/password";

const url = process.env.TEST_DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith("/ledgerline_test"))
  throw new Error(
    "Transactions tests require the dedicated ledgerline_test database.",
  );
const config = readConfig({
  NODE_ENV: "test",
  DATABASE_URL: url,
  APP_URL: "http://localhost:5173",
  BETTER_AUTH_SECRET: "transfers-test-secret-only-00000000000000000",
  OWNER_EMAIL: "transfers-owner@example.com",
  OWNER_PASSWORD: "Transactions-test-password-000",
  OWNER_NAME: "Transactions owner",
});
const { db, pool } = createDatabase(url);
const app = await buildApp(db, config);
let ledgerId = "",
  ownerId = "",
  ownerCookie = "",
  editorCookie = "",
  viewerCookie = "";
let cashId = "",
  foreignAccountId = "",
  archivedId = "";
let accountId = "",
  categoryId = "",
  incomeCategoryId = "";
const secondLedger = newId(),
  foreignLedger = newId();
const base = (ledger = ledgerId) => `/api/v1/ledgers/${ledger}/transfers`;
const input = (amount = 123) => ({
  fromAccountId: accountId,
  toAccountId: cashId,
  date: "2026-10-07",
  time: "09:05",
  note: "Synthetic transfer",
  amount: { amount, currency: "USD" as const },
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
  payload: unknown = { ...input(200), expectedVersion: 1 },
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
const remove = (
  id: string,
  expectedVersion = 1,
  ledger = ledgerId,
  cookie = ownerCookie,
  key = newId(),
) =>
  app.inject({
    method: "DELETE",
    url: `${base(ledger)}/${id}`,
    headers: headers(cookie, key),
    payload: { expectedVersion },
  });
const restore = (
  id: string,
  expectedVersion = 2,
  ledger = ledgerId,
  cookie = ownerCookie,
  key = newId(),
) =>
  app.inject({
    method: "POST",
    url: `${base(ledger)}/${id}/restore`,
    headers: headers(cookie, key),
    payload: { expectedVersion },
  });
const read = (path: string, cookie = ownerCookie) =>
  app.inject({ url: path, headers: { cookie } });
async function saved(payload: unknown = input()): Promise<Transfer> {
  const response = await create(payload);
  expect(response.statusCode).toBe(201);
  return transferSchema.parse(response.json());
}
async function balance(id = accountId) {
  const response = await read(`/api/v1/ledgers/${ledgerId}/accounts/${id}`);
  expect(response.statusCode).toBe(200);
  return response.json().balance.amount as number;
}
async function legs(id: string) {
  return db
    .select()
    .from(transactions)
    .where(
      and(eq(transactions.ledgerId, ledgerId), eq(transactions.transferId, id)),
    );
}
async function receipt(key: string) {
  return db
    .select()
    .from(writeReceipts)
    .where(
      and(eq(writeReceipts.ledgerId, ledgerId), eq(writeReceipts.key, key)),
    );
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

const fixtureUsers = [newId(), newId(), newId()];
const fixtureLedgers = [newId(), secondLedger, foreignLedger];
beforeAll(async () => {
  await applyMigrations(url);
  ledgerId = fixtureLedgers[0] ?? "";
  ownerId = fixtureUsers[0] ?? "";
  await db.insert(ledgers).values(
    fixtureLedgers.map((id) => ({
      id,
      name: "Synthetic transfers test ledger",
    })),
  );
  const password = await hashPassword(config.OWNER_PASSWORD);
  for (const [index, role] of (
    ["owner", "editor", "viewer"] as const
  ).entries()) {
    const id = fixtureUsers[index];
    if (!id) throw new Error("Missing fixture ID");
    const email = `transfers-${role}-${id}@example.com`;
    await db.insert(user).values({ id, name: role, email });
    await db.insert(credentials).values({
      userId: id,
      accountId: id,
      providerId: "credential",
      password,
    });
    await db.insert(ledgerMembers).values({ userId: id, ledgerId, role });
  }
  await db
    .insert(ledgerMembers)
    .values({ userId: ownerId, ledgerId: secondLedger, role: "owner" });
  await app.ready();
  ownerCookie = await signIn(`transfers-owner-${ownerId}@example.com`);
  editorCookie = await signIn(
    `transfers-editor-${fixtureUsers[1]}@example.com`,
  );
  viewerCookie = await signIn(
    `transfers-viewer-${fixtureUsers[2]}@example.com`,
  );
});
const fixtureScope = inArray(transactions.ledgerId, fixtureLedgers);
beforeEach(async () => {
  // Clear only this suite's synthetic rows, retaining every unrelated ledger.
  await db.delete(transactions).where(fixtureScope);
  await db
    .delete(categories)
    .where(inArray(categories.ledgerId, fixtureLedgers));
  await db.delete(accounts).where(inArray(accounts.ledgerId, fixtureLedgers));
  await db
    .delete(writeReceipts)
    .where(inArray(writeReceipts.ledgerId, fixtureLedgers));
  await db
    .update(ledgers)
    .set({ deletedAt: null })
    .where(inArray(ledgers.id, fixtureLedgers));
  await db
    .update(ledgerMembers)
    .set({ deletedAt: null, role: "owner" })
    .where(
      and(
        eq(ledgerMembers.ledgerId, ledgerId),
        eq(ledgerMembers.userId, ownerId),
      ),
    );
  cashId = newId();
  foreignAccountId = newId();
  archivedId = newId();
  await db.insert(accounts).values([
    { id: cashId, ledgerId, name: "Cash", type: "cash", openingBalance: 5000 },
    {
      id: archivedId,
      ledgerId,
      name: "Archived",
      type: "bank",
      openingBalance: 0,
      archivedAt: new Date(),
    },
    {
      id: foreignAccountId,
      ledgerId: secondLedger,
      name: "Other ledger",
      type: "bank",
      openingBalance: 0,
    },
  ]);
  accountId = newId();
  categoryId = newId();
  incomeCategoryId = newId();
  await db.insert(accounts).values({
    id: accountId,
    ledgerId,
    name: "Checking",
    type: "bank",
    openingBalance: 10000,
  });
  await db.insert(categories).values([
    { id: categoryId, ledgerId, name: "Food", kind: "expense" },
    { id: incomeCategoryId, ledgerId, name: "Salary", kind: "income" },
  ]);
});
afterAll(async () => {
  await app.close();
  await db.delete(transactions).where(fixtureScope);
  await db
    .delete(categories)
    .where(inArray(categories.ledgerId, fixtureLedgers));
  await db.delete(accounts).where(inArray(accounts.ledgerId, fixtureLedgers));
  await db
    .delete(writeReceipts)
    .where(inArray(writeReceipts.ledgerId, fixtureLedgers));
  await db.delete(session).where(inArray(session.userId, fixtureUsers));
  await db.delete(credentials).where(inArray(credentials.userId, fixtureUsers));
  await db
    .delete(ledgerMembers)
    .where(inArray(ledgerMembers.ledgerId, fixtureLedgers));
  await db.delete(ledgers).where(inArray(ledgers.id, fixtureLedgers));
  await db.delete(user).where(inArray(user.id, fixtureUsers));
  await pool.end();
});

describe("Transfers API", () => {
  it("creates two cleared opposite uncategorized legs and exact balances without income/spending", async () => {
    const row = await saved();
    expect(row).toMatchObject({ ...input(), version: 1, ledgerId });
    const stored = await legs(row.id);
    expect(stored).toHaveLength(2);
    expect(stored.map((leg) => leg.amount).sort((a, b) => a - b)).toEqual([
      -123, 123,
    ]);
    for (const leg of stored)
      expect(leg).toMatchObject({
        kind: "transfer",
        categoryId: null,
        transferId: row.id,
        status: "cleared",
        fxRate: 1,
        baseAmount: leg.amount,
        time: "09:05",
      });
    expect(await balance()).toBe(9877);
    expect(await balance(cashId)).toBe(5123);
    const prefix = `/api/v1/ledgers/${ledgerId}/transactions`;
    for (const query of [
      "kind=expense",
      "kind=income",
      `categoryId=${categoryId}`,
    ])
      expect((await read(`${prefix}?${query}`)).json().items).toEqual([]);
    expect((await read(`${prefix}?kind=transfer`)).json().items).toHaveLength(
      2,
    );
    expect(
      transactionSchema.parse(
        (await read(`${prefix}/${row.fromTransactionId}`)).json(),
      ).transferId,
    ).toBe(row.id);
  });
  it("rejects same-account, cross-ledger, archived, missing and invalid inputs without rows or receipts", async () => {
    for (const patch of [
      { toAccountId: accountId.toUpperCase() },
      { toAccountId: foreignAccountId },
      { fromAccountId: archivedId },
      { toAccountId: archivedId },
      { toAccountId: newId() },
      { amount: { amount: 0, currency: "USD" } },
      { amount: { amount: -1, currency: "USD" } },
      { amount: { amount: 1.5, currency: "USD" } },
      { amount: { amount: Number.MAX_SAFE_INTEGER + 1, currency: "USD" } },
      { amount: { amount: 1, currency: "BDT" } },
      { time: "24:00" },
      { date: "2026-02-30" },
      { status: "pending" },
      { categoryId },
    ]) {
      const key = newId();
      const result = await create(
        { ...input(), ...patch },
        ledgerId,
        ownerCookie,
        key,
      );
      expect([400, 404, 409]).toContain(result.statusCode);
      expect(result.headers["content-type"]).toContain(
        "application/problem+json",
      );
      expect(await receipt(key)).toHaveLength(0);
    }
    expect(
      await db.select().from(transactions).where(fixtureScope),
    ).toHaveLength(0);
  });
  it("scopes every endpoint even when the actor owns both ledgers", async () => {
    const row = await saved();
    for (const ledger of [secondLedger, foreignLedger]) {
      expect((await read(`${base(ledger)}/${row.id}`)).statusCode).toBe(404);
      expect((await create(input(), ledger)).statusCode).toBe(404);
      expect((await edit(row.id, undefined, ledger)).statusCode).toBe(404);
      expect((await remove(row.id, 1, ledger)).statusCode).toBe(404);
      expect((await restore(row.id, 2, ledger)).statusCode).toBe(404);
    }
    expect(await balance()).toBe(9877);
  });
  it("enforces anonymous/viewer access and owner/editor writes on every endpoint", async () => {
    const row = await saved();
    for (const cookie of ["", viewerCookie]) {
      const status = cookie ? 403 : 401;
      for (const result of await Promise.all([
        create(input(), ledgerId, cookie),
        edit(row.id, undefined, ledgerId, cookie),
        remove(row.id, 1, ledgerId, cookie),
        restore(row.id, 2, ledgerId, cookie),
      ]))
        expect(result.statusCode).toBe(status);
      expect((await read(`${base()}/${row.id}`, cookie)).statusCode).toBe(
        cookie ? 200 : 401,
      );
    }
    expect(
      (await edit(row.id, undefined, ledgerId, editorCookie)).statusCode,
    ).toBe(200);
    expect((await remove(row.id, 2, ledgerId, editorCookie)).statusCode).toBe(
      204,
    );
    expect((await restore(row.id, 3, ledgerId, editorCookie)).statusCode).toBe(
      200,
    );
  });
  it("requires keys and trusted Origin on all writes", async () => {
    const row = await saved();
    for (const [method, path, payload] of [
      ["POST", base(), input()],
      ["PATCH", `${base()}/${row.id}`, { ...input(), expectedVersion: 1 }],
      ["DELETE", `${base()}/${row.id}`, { expectedVersion: 1 }],
      ["POST", `${base()}/${row.id}/restore`, { expectedVersion: 2 }],
    ] as const)
      for (const badHeaders of [
        { cookie: ownerCookie, origin: config.APP_URL },
        { cookie: ownerCookie, "idempotency-key": newId() },
        { ...headers(), origin: "https://evil.example" },
      ]) {
        const result = await app.inject({
          method,
          url: path,
          headers: badHeaders,
          payload,
        });
        expect([400, 403]).toContain(result.statusCode);
      }
  });
  it("serializes duplicate creates, preserves immutable replay after edits and rejects changed intent", async () => {
    const key = newId();
    const responses = await Promise.all([
      create(input(), ledgerId, ownerCookie, key),
      create(input(), ledgerId, ownerCookie, key),
    ]);
    expect(responses.map((r) => r.statusCode)).toEqual([201, 201]);
    expect(responses[0]?.json()).toEqual(responses[1]?.json());
    const row = transferSchema.parse(responses[0]?.json());
    expect(await legs(row.id)).toHaveLength(2);
    await edit(row.id);
    expect((await create(input(), ledgerId, ownerCookie, key)).json()).toEqual(
      row,
    );
    expect(
      (await create(input(124), ledgerId, ownerCookie, key)).statusCode,
    ).toBe(409);
    const restarted = createDatabase(url);
    const { createTransfer } = await import("./transfer-service");
    try {
      expect(
        await createTransfer(
          restarted.db,
          { actorId: ownerId, ledgerId, key },
          createTransferSchema.parse(input()),
        ),
      ).toMatchObject({ replayed: true, body: row });
    } finally {
      await restarted.pool.end();
    }
    expect(await balance()).toBe(9800);
  });
  it("edits accounts, amount, date, local time and note together, retaining leg identities", async () => {
    const row = await saved();
    const changes = {
      ...input(29),
      fromAccountId: cashId,
      toAccountId: accountId,
      date: "0001-01-01",
      time: null,
      note: null,
      expectedVersion: 1,
    };
    const result = await edit(row.id, changes);
    expect(result.statusCode).toBe(200);
    const { expectedVersion: _expected, ...changedFields } = changes;
    expect(result.json()).toMatchObject({
      ...changedFields,
      id: row.id,
      fromTransactionId: row.fromTransactionId,
      toTransactionId: row.toTransactionId,
      version: 2,
      createdAt: row.createdAt,
    });
    const stored = await legs(row.id);
    expect(
      stored.every(
        (leg) =>
          leg.version === 2 && leg.time === null && leg.date === "0001-01-01",
      ),
    ).toBe(true);
    expect(await balance()).toBe(10029);
    expect(await balance(cashId)).toBe(4971);
  });
  it("atomically deletes and restores original identities with versioned replay", async () => {
    const row = await saved(),
      deleteKey = newId(),
      restoreKey = newId();
    expect((await remove(row.id, 2)).statusCode).toBe(409);
    const result = await remove(row.id, 1, ledgerId, ownerCookie, deleteKey);
    expect(result.statusCode).toBe(204);
    expect(result.body).toBe("");
    expect(
      (await remove(row.id, 1, ledgerId, ownerCookie, deleteKey)).headers[
        "idempotency-replayed"
      ],
    ).toBe("true");
    expect((await read(`${base()}/${row.id}`)).statusCode).toBe(404);
    expect((await edit(row.id)).statusCode).toBe(404);
    expect((await remove(row.id)).statusCode).toBe(404);
    expect(
      (await legs(row.id)).every((leg) => leg.deletedAt && leg.version === 2),
    ).toBe(true);
    expect(await balance()).toBe(10000);
    expect(await balance(cashId)).toBe(5000);
    const restored = await restore(
      row.id,
      2,
      ledgerId,
      ownerCookie,
      restoreKey,
    );
    expect(restored.statusCode).toBe(200);
    expect(restored.json()).toMatchObject({
      ...row,
      version: 3,
      updatedAt: expect.any(String),
    });
    expect(
      (await restore(row.id, 2, ledgerId, ownerCookie, restoreKey)).json(),
    ).toEqual(restored.json());
    expect((await restore(row.id, 3)).statusCode).toBe(409);
    expect(await balance()).toBe(9877);
    expect(await balance(cashId)).toBe(5123);
  });
  it("rejects independent leg edits/deletes/restores through ordinary endpoints", async () => {
    const row = await saved();
    for (const id of [row.fromTransactionId, row.toTransactionId]) {
      const prefix = `/api/v1/ledgers/${ledgerId}/transactions/${id}`;
      for (const [method, path, payload] of [
        ["PATCH", prefix, { note: "Wrong", expectedVersion: 1 }],
        ["DELETE", prefix, { expectedVersion: 1 }],
        ["POST", `${prefix}/restore`, { expectedVersion: 1 }],
      ] as const)
        expect(
          (await app.inject({ method, url: path, headers: headers(), payload }))
            .statusCode,
        ).toBe(409);
    }
    expect(await balance()).toBe(9877);
  });
  it("preserves archived historical corrections/deletion/Undo but rejects new archived assignments", async () => {
    const row = await saved();
    await db
      .update(accounts)
      .set({ archivedAt: new Date() })
      .where(inArray(accounts.id, [accountId, cashId]));
    expect((await read(`${base()}/${row.id}`)).json()).toEqual(row);
    expect(
      (await edit(row.id, { ...input(30), expectedVersion: 1 })).statusCode,
    ).toBe(200);
    expect(
      (
        await edit(row.id, {
          ...input(31),
          fromAccountId: cashId,
          toAccountId: accountId,
          expectedVersion: 2,
        })
      ).statusCode,
    ).toBe(409);
    expect(
      (
        await edit(row.id, {
          ...input(),
          toAccountId: archivedId,
          expectedVersion: 2,
        })
      ).statusCode,
    ).toBe(409);
    expect((await remove(row.id, 2)).statusCode).toBe(204);
    expect((await restore(row.id, 3)).statusCode).toBe(200);
    expect(await balance()).toBe(9970);
    expect(await balance(cashId)).toBe(5030);
  });
  it("rejects tombstoned references on create/edit/delete/restore", async () => {
    const row = await saved();
    await remove(row.id);
    await db
      .update(accounts)
      .set({ deletedAt: new Date() })
      .where(eq(accounts.id, cashId));
    expect((await restore(row.id)).statusCode).toBe(404);
    expect((await create()).statusCode).toBe(404);
    expect(
      (await legs(row.id)).every((leg) => leg.deletedAt && leg.version === 2),
    ).toBe(true);
  });
  it("resolves concurrent edits and restores with one winning version", async () => {
    const row = await saved();
    const results = await Promise.all([
      edit(row.id),
      edit(row.id, { ...input(300), expectedVersion: 1 }),
    ]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    const latest = transferSchema.parse(
      (await read(`${base()}/${row.id}`)).json(),
    );
    expect(latest.version).toBe(2);
    expect(await balance()).toBe(10000 - latest.amount.amount);
    expect(await balance(cashId)).toBe(5000 + latest.amount.amount);
    await remove(row.id, 2);
    const undone = await Promise.all([restore(row.id, 3), restore(row.id, 3)]);
    expect(undone.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    expect(
      (await legs(row.id)).every((leg) => leg.version === 4 && !leg.deletedAt),
    ).toBe(true);
  });
  it("rolls back overflow on the second account and receipt, then retries the same key", async () => {
    await db
      .update(accounts)
      .set({ openingBalance: Number.MAX_SAFE_INTEGER })
      .where(eq(accounts.id, cashId));
    const key = newId();
    expect((await create(input(), ledgerId, ownerCookie, key)).statusCode).toBe(
      409,
    );
    expect(
      await db.select().from(transactions).where(fixtureScope),
    ).toHaveLength(0);
    expect(await receipt(key)).toHaveLength(0);
    expect(await balance()).toBe(10000);
    await db
      .update(accounts)
      .set({ openingBalance: 5000 })
      .where(eq(accounts.id, cashId));
    expect((await create(input(), ledgerId, ownerCookie, key)).statusCode).toBe(
      201,
    );
  });
  it("rolls back overflowing edits and Undo without changing either leg or receipt", async () => {
    const row = await saved();
    await db
      .update(accounts)
      .set({ openingBalance: Number.MAX_SAFE_INTEGER - 123 })
      .where(eq(accounts.id, cashId));
    const key = newId();
    expect(
      (
        await edit(
          row.id,
          { ...input(124), expectedVersion: 1 },
          ledgerId,
          ownerCookie,
          key,
        )
      ).statusCode,
    ).toBe(409);
    expect(await receipt(key)).toHaveLength(0);
    expect((await read(`${base()}/${row.id}`)).json()).toEqual(row);
    await remove(row.id);
    await db
      .update(accounts)
      .set({ openingBalance: Number.MAX_SAFE_INTEGER })
      .where(eq(accounts.id, cashId));
    const undoKey = newId();
    expect(
      (await restore(row.id, 2, ledgerId, ownerCookie, undoKey)).statusCode,
    ).toBe(409);
    expect(await receipt(undoKey)).toHaveLength(0);
    expect(
      (await legs(row.id)).every((leg) => leg.deletedAt && leg.version === 2),
    ).toBe(true);
    await db
      .update(accounts)
      .set({ openingBalance: 5000 })
      .where(eq(accounts.id, cashId));
    expect(
      (await restore(row.id, 2, ledgerId, ownerCookie, undoKey)).statusCode,
    ).toBe(200);
  });
  it("rolls back an overflowing deletion of the debit leg and retries exactly once", async () => {
    const row = await saved();
    await db.insert(transactions).values({
      ledgerId,
      accountId,
      categoryId: incomeCategoryId,
      kind: "income",
      date: "2026-10-07",
      amount: 123,
      baseAmount: 123,
    });
    await db
      .update(accounts)
      .set({ openingBalance: Number.MAX_SAFE_INTEGER })
      .where(eq(accounts.id, accountId));
    expect(await balance()).toBe(Number.MAX_SAFE_INTEGER);
    const key = newId();
    expect(
      (await remove(row.id, 1, ledgerId, ownerCookie, key)).statusCode,
    ).toBe(409);
    expect(await receipt(key)).toHaveLength(0);
    expect(
      (await legs(row.id)).every((leg) => !leg.deletedAt && leg.version === 1),
    ).toBe(true);
    expect(await balance(cashId)).toBe(5123);
    await db
      .update(accounts)
      .set({ openingBalance: 10000 })
      .where(eq(accounts.id, accountId));
    expect(
      (await remove(row.id, 1, ledgerId, ownerCookie, key)).statusCode,
    ).toBe(204);
    expect(await balance()).toBe(10123);
    expect(await balance(cashId)).toBe(5000);
  });
  it("supports the exact safe-integer boundary without floating point", async () => {
    await db
      .update(accounts)
      .set({ openingBalance: 0 })
      .where(inArray(accounts.id, [accountId, cashId]));
    const row = await saved(input(Number.MAX_SAFE_INTEGER));
    expect(await balance()).toBe(Number.MIN_SAFE_INTEGER);
    expect(await balance(cashId)).toBe(Number.MAX_SAFE_INTEGER);
    expect(
      (await legs(row.id)).reduce((sum, leg) => sum + BigInt(leg.amount), 0n),
    ).toBe(0n);
    await remove(row.id);
    expect(await balance()).toBe(0);
    expect(await balance(cashId)).toBe(0);
  });
  it("serializes account assignment against archiving with sorted account locks", async () => {
    let release!: () => void, acquired!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const locked = new Promise<void>((resolve) => {
      acquired = resolve;
    });
    const archive = db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT id FROM accounts WHERE ledger_id=${ledgerId} AND id=${cashId} FOR UPDATE`,
      );
      acquired();
      await gate;
      await tx
        .update(accounts)
        .set({ archivedAt: new Date() })
        .where(eq(accounts.id, cashId));
    });
    await locked;
    const request = create();
    release();
    await archive;
    expect((await request).statusCode).toBe(409);
    expect(
      await db.select().from(transactions).where(fixtureScope),
    ).toHaveLength(0);
  });
  it("replays original edits after later changes and rejects stale versions without partial legs", async () => {
    const row = await saved(),
      key = newId();
    const body = { ...input(200), expectedVersion: 1 };
    const first = await edit(row.id, body, ledgerId, ownerCookie, key);
    expect(first.statusCode).toBe(200);
    await edit(row.id, { ...input(300), expectedVersion: 2 });
    expect(
      (await edit(row.id, body, ledgerId, ownerCookie, key)).json(),
    ).toEqual(first.json());
    expect(
      (
        await edit(
          row.id,
          { ...body, note: "Different" },
          ledgerId,
          ownerCookie,
          key,
        )
      ).statusCode,
    ).toBe(409);
    expect((await edit(row.id, body)).statusCode).toBe(409);
    expect((await remove(row.id, 2)).statusCode).toBe(409);
    expect((await legs(row.id)).every((leg) => leg.version === 3)).toBe(true);
    expect(await balance()).toBe(9700);
    expect(await balance(cashId)).toBe(5300);
  });
  it("database rejects lone, unbalanced, mismatched and independent updates at commit", async () => {
    const row = await saved();
    await expect(
      db
        .update(transactions)
        .set({ amount: -124, baseAmount: -124 })
        .where(eq(transactions.id, row.fromTransactionId)),
    ).rejects.toThrow();
    await expect(
      db
        .update(transactions)
        .set({ version: 2 })
        .where(eq(transactions.id, row.toTransactionId)),
    ).rejects.toThrow();
    await expect(
      db
        .update(transactions)
        .set({ deletedAt: new Date() })
        .where(eq(transactions.id, row.toTransactionId)),
    ).rejects.toThrow();
    await expect(
      db.insert(transactions).values({
        ledgerId,
        accountId,
        categoryId: null,
        kind: "transfer",
        transferId: newId(),
        date: "2026-10-07",
        amount: -1,
        baseAmount: -1,
      }),
    ).rejects.toThrow();
    expect((await read(`${base()}/${row.id}`)).json()).toEqual(row);
  });
  it("rechecks role revocation and deleted ledger before replay", async () => {
    const key = newId();
    await create(input(), ledgerId, ownerCookie, key);
    await db
      .update(ledgerMembers)
      .set({ role: "viewer" })
      .where(
        and(
          eq(ledgerMembers.ledgerId, ledgerId),
          eq(ledgerMembers.userId, ownerId),
        ),
      );
    expect((await create(input(), ledgerId, ownerCookie, key)).statusCode).toBe(
      403,
    );
    await db
      .update(ledgers)
      .set({ deletedAt: new Date() })
      .where(eq(ledgers.id, ledgerId));
    expect((await create(input(), ledgerId, ownerCookie, key)).statusCode).toBe(
      404,
    );
  });
  it("documents all five secured transfer endpoints and paired versions", async () => {
    const doc = (await read("/api/v1/openapi.json")).json();
    expect(doc.info.version).toBe("0.1.21");
    const prefix = "/api/v1/ledgers/{ledgerId}/transfers";
    for (const [path, method] of [
      [prefix, "post"],
      [`${prefix}/{transferId}`, "get"],
      [`${prefix}/{transferId}`, "patch"],
      [`${prefix}/{transferId}`, "delete"],
      [`${prefix}/{transferId}/restore`, "post"],
    ]) {
      const operation = doc.paths[path as string][method as string];
      expect(operation.security).toEqual([{ sessionCookie: [] }]);
      expect(operation.responses["404"]).toBeDefined();
      if (method !== "get") {
        expect(operation.parameters).toContainEqual(
          expect.objectContaining({ name: "idempotency-key", required: true }),
        );
        expect(operation.responses["409"]).toBeDefined();
      }
    }
  });
  it("blocks deletion of accounts referenced by transfers until both legs are deleted, then refuses paired Undo", async () => {
    const row = await saved();
    const deleteAccount = (id: string) =>
      app.inject({
        method: "DELETE",
        url: `/api/v1/ledgers/${ledgerId}/accounts/${id}`,
        headers: headers(),
        payload: { expectedVersion: 1 },
      });
    for (const id of [accountId, cashId])
      expect((await deleteAccount(id)).statusCode).toBe(409);
    await remove(row.id);
    expect((await deleteAccount(accountId)).statusCode).toBe(204);
    expect((await restore(row.id)).statusCode).toBe(404);
    expect(
      (await legs(row.id)).every((leg) => leg.deletedAt && leg.version === 2),
    ).toBe(true);
    expect(await balance(cashId)).toBe(5000);
  });
});
