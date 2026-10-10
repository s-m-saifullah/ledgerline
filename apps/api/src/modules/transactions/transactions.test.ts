import {
  newId,
  type Transaction,
  transactionListSchema,
  transactionSchema,
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
  transactionSplits,
  transactions,
  user,
  writeReceipts,
} from "../../db/schema";
import { hashPassword } from "../auth/password";
import { postedBalance, postedCategoryTotals } from "./balance-service";

const url = process.env.TEST_DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith("/ledgerline_test"))
  throw new Error(
    "Transactions tests require the dedicated ledgerline_test database.",
  );
const config = readConfig({
  NODE_ENV: "test",
  DATABASE_URL: url,
  APP_URL: "http://localhost:5173",
  BETTER_AUTH_SECRET: "transactions-test-secret-only-00000000000000000",
  OWNER_EMAIL: "transactions-owner@example.com",
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
let accountId = "",
  categoryId = "",
  incomeCategoryId = "";
const secondLedger = newId(),
  foreignLedger = newId();
const base = (ledger = ledgerId) => `/api/v1/ledgers/${ledger}/transactions`;
const input = (amount = -123) => ({
  accountId,
  categoryId: amount < 0 ? categoryId : incomeCategoryId,
  kind: amount < 0 ? "expense" : "income",
  date: "2026-10-07",
  amount: { amount, currency: "USD" },
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
  payload: unknown = { note: "Corrected", expectedVersion: 1 },
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
async function saved(payload: unknown = input()): Promise<Transaction> {
  const response = await create(payload);
  expect(response.statusCode).toBe(201);
  return transactionSchema.parse(response.json());
}
async function balance(id = accountId) {
  const response = await read(`/api/v1/ledgers/${ledgerId}/accounts/${id}`);
  expect(response.statusCode).toBe(200);
  return response.json().balance.amount as number;
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
      name: "Synthetic transactions test ledger",
    })),
  );
  const password = await hashPassword(config.OWNER_PASSWORD);
  for (const [index, role] of (
    ["owner", "editor", "viewer"] as const
  ).entries()) {
    const id = fixtureUsers[index];
    if (!id) throw new Error("Missing fixture ID");
    const email = `transactions-${role}-${id}@example.com`;
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
  ownerCookie = await signIn(`transactions-owner-${ownerId}@example.com`);
  editorCookie = await signIn(
    `transactions-editor-${fixtureUsers[1]}@example.com`,
  );
  viewerCookie = await signIn(
    `transactions-viewer-${fixtureUsers[2]}@example.com`,
  );
});
const fixtureScope = inArray(transactions.ledgerId, fixtureLedgers);
beforeEach(async () => {
  // Clear only this suite's synthetic rows, retaining every unrelated ledger.
  await db.transaction(async (tx) => {
    await tx
      .delete(transactionSplits)
      .where(inArray(transactionSplits.ledgerId, fixtureLedgers));
    await tx.delete(transactions).where(fixtureScope);
  });
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
  await db.transaction(async (tx) => {
    await tx
      .delete(transactionSplits)
      .where(inArray(transactionSplits.ledgerId, fixtureLedgers));
    await tx.delete(transactions).where(fixtureScope);
  });
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

describe("Transactions API", () => {
  it("starts empty and round-trips signed USD, calendar dates and defaults", async () => {
    expect((await read(base())).json()).toEqual({
      items: [],
      nextCursor: null,
    });
    for (const amount of [-29, 1000]) {
      const row = await saved({
        ...input(amount),
        date: "2024-02-29",
        payee: "  Shop  ",
        note: "  Lunch  ",
      });
      expect(row).toMatchObject({
        ledgerId,
        accountId,
        amount: { amount, currency: "USD" },
        baseAmount: { amount, currency: "USD" },
        fxRate: 1,
        date: "2024-02-29",
        time: null,
        status: "cleared",
        payee: "Shop",
        note: "Lunch",
        version: 1,
        transferId: null,
      });
      expect((await read(`${base()}/${row.id}`)).json()).toEqual(row);
    }
    expect(await balance()).toBe(10971);
  });
  it("round-trips optional local times and preserves or clears them with versioned edits", async () => {
    const key = newId(),
      payload = { ...input(), time: "23:59" };
    const created = await create(payload, ledgerId, ownerCookie, key);
    expect(created.statusCode).toBe(201);
    const row = created.json();
    expect(row.time).toBe("23:59");
    expect((await create(payload, ledgerId, ownerCookie, key)).json()).toEqual(
      row,
    );
    expect(
      (await create({ ...payload, time: "23:58" }, ledgerId, ownerCookie, key))
        .statusCode,
    ).toBe(409);
    expect((await read(`${base()}/${row.id}`)).json().time).toBe("23:59");
    expect((await read(base())).json().items[0].time).toBe("23:59");
    expect(
      (await edit(row.id, { note: "Keep time", expectedVersion: 1 })).json()
        .time,
    ).toBe("23:59");
    expect(
      (await edit(row.id, { time: "00:00", expectedVersion: 2 })).json().time,
    ).toBe("00:00");
    expect(
      (await edit(row.id, { time: null, expectedVersion: 2 })).statusCode,
    ).toBe(409);
    expect(
      (await edit(row.id, { time: null, expectedVersion: 3 })).json().time,
    ).toBeNull();
    expect(
      (await edit(row.id, { time: "24:00", expectedVersion: 4 })).statusCode,
    ).toBe(400);
    expect(await balance()).toBe(9877);
    await expect(
      db
        .update(transactions)
        .set({ time: "24:00" })
        .where(eq(transactions.id, row.id)),
    ).rejects.toThrow();
  });
  it("replays pre-time idempotency receipts without changing their original request fingerprint", async () => {
    const key = newId(),
      payload = input();
    const response = await create(payload, ledgerId, ownerCookie, key);
    const legacy = response.json();
    delete legacy.time;
    await db
      .update(writeReceipts)
      .set({ responseBody: legacy })
      .where(
        and(eq(writeReceipts.ledgerId, ledgerId), eq(writeReceipts.key, key)),
      );
    const replay = await create(payload, ledgerId, ownerCookie, key);
    expect(replay.statusCode).toBe(201);
    expect(replay.json()).toEqual({ ...legacy, time: null });
    expect(await balance()).toBe(9877);
  });
  it("round-trips safe money boundaries and sums exactly even when intermediate sums exceed them", async () => {
    await db
      .update(accounts)
      .set({ openingBalance: 0 })
      .where(eq(accounts.id, accountId));
    const max = Number.MAX_SAFE_INTEGER;
    await saved(input(-max));
    await saved(input(max));
    expect(await balance()).toBe(0);
    await db
      .update(accounts)
      .set({ openingBalance: -max })
      .where(eq(accounts.id, accountId));
    await saved(input(max));
    await saved(input(max));
    // SQL sum exceeds safe-number bounds, but the final opening + sum is exact and supported.
    expect(await balance()).toBe(max);
    expect(postedBalance(-max, BigInt(max) + BigInt(max))).toBe(max);
    for (const amount of [-max, max])
      expect(
        (await saved({ ...input(amount), status: "pending" })).amount.amount,
      ).toBe(amount);
  });
  it("validates signs, safe cents, USD, dates, text lengths and rejects server-owned fields", async () => {
    for (const payload of [
      input(0),
      input(1.5),
      input(Number.MAX_SAFE_INTEGER + 1),
      { ...input(), kind: "income" },
      { ...input(), amount: { amount: -1, currency: "BDT" } },
      { ...input(), date: "2025-02-29" },
      { ...input(), date: "0000-01-01" },
      ...["", "24:00", "12:60", "9:05", "12:34:56", "12:34Z"].map((time) => ({
        ...input(),
        time,
      })),
      { ...input(), date: "2026-10-07T00:00:00Z" },
      { ...input(), payee: "a".repeat(201) },
      { ...input(), note: "a".repeat(2001) },
      { ...input(), status: "posted" },
      { ...input(), fxRate: 2 },
      { ...input(), baseAmount: -1 },
      { ...input(), transferId: newId() },
      { ...input(), ledgerId: secondLedger },
    ]) {
      const response = await create(payload);
      expect(response.statusCode).toBe(400);
      expect(response.headers["content-type"]).toContain(
        "application/problem+json",
      );
      expect(response.json().errors.length).toBeGreaterThan(0);
    }
    expect(
      await db.select().from(transactions).where(fixtureScope),
    ).toHaveLength(0);
  });
  it("validates cursor, query bounds, date ranges and identifiers", async () => {
    for (const query of [
      "limit=0",
      "limit=101",
      "limit=1.5",
      "cursor=bad",
      `cursor=2025-02-29_${newId()}`,
      "accountId=bad",
      "categoryId=bad",
      "from=2025-02-29",
      "from=0000-01-01",
      "from=2026-10-08&to=2026-10-07",
      "text=",
      `text=${"a".repeat(201)}`,
      "status=deleted",
      "kind=unknown",
    ] as const)
      expect((await read(`${base()}?${query}`)).statusCode).toBe(400);
    expect((await read(base("bad"))).statusCode).toBe(400);
    expect((await read(`${base()}/bad`)).statusCode).toBe(400);
  });
  it("requires authentication for every endpoint", async () => {
    const row = await saved();
    for (const response of await Promise.all([
      read(base(), ""),
      read(`${base()}/${row.id}`, ""),
      create(input(), ledgerId, ""),
      edit(row.id, undefined, ledgerId, ""),
      remove(row.id, 1, ledgerId, ""),
    ]))
      expect(response.statusCode).toBe(401);
  });
  it("allows viewer reads and editor writes, denies every viewer mutation", async () => {
    const row = await saved();
    expect((await read(base(), viewerCookie)).statusCode).toBe(200);
    expect((await read(`${base()}/${row.id}`, viewerCookie)).statusCode).toBe(
      200,
    );
    for (const response of await Promise.all([
      create(input(), ledgerId, viewerCookie),
      edit(row.id, undefined, ledgerId, viewerCookie),
      remove(row.id, 1, ledgerId, viewerCookie),
    ]))
      expect(response.statusCode).toBe(403);
    const other = transactionSchema.parse(
      (await create(input(), ledgerId, editorCookie)).json(),
    );
    expect(
      (await edit(other.id, undefined, ledgerId, editorCookie)).statusCode,
    ).toBe(200);
    expect((await remove(other.id, 2, ledgerId, editorCookie)).statusCode).toBe(
      204,
    );
  });
  it("denies inaccessible ledgers for every endpoint", async () => {
    const row = await saved();
    for (const response of await Promise.all([
      read(base(foreignLedger)),
      read(`${base(foreignLedger)}/${row.id}`),
      create(input(), foreignLedger),
      edit(row.id, undefined, foreignLedger),
      remove(row.id, 1, foreignLedger),
    ]))
      expect(response.statusCode).toBe(404);
  });
  it("scopes every query and target when both ledgers are accessible", async () => {
    const row = await saved();
    expect((await read(base(secondLedger))).json().items).toEqual([]);
    for (const response of await Promise.all([
      read(`${base(secondLedger)}/${row.id}`),
      edit(row.id, undefined, secondLedger),
      remove(row.id, 1, secondLedger),
      create(input(), secondLedger),
    ]))
      expect(response.statusCode).toBe(404);
    expect(
      (
        await read(
          `${base(secondLedger)}?accountId=${accountId}&categoryId=${categoryId}`,
        )
      ).json().items,
    ).toEqual([]);
    expect(await balance()).toBe(9877);
  });
  it("rejects foreign and missing account/category references without leaking rows", async () => {
    const otherAccount = newId(),
      otherCategory = newId();
    await db.insert(accounts).values({
      id: otherAccount,
      ledgerId: secondLedger,
      name: "Other",
      type: "bank",
      openingBalance: 0,
    });
    await db.insert(categories).values({
      id: otherCategory,
      ledgerId: secondLedger,
      name: "Other",
      kind: "expense",
    });
    const row = await saved();
    for (const changes of [
      { accountId: otherAccount },
      { categoryId: otherCategory },
      { accountId: newId() },
      { categoryId: newId() },
    ]) {
      expect((await create({ ...input(), ...changes })).statusCode).toBe(404);
      expect(
        (await edit(row.id, { ...changes, expectedVersion: 1 })).statusCode,
      ).toBe(404);
    }
    expect(
      (await read(`${base()}?accountId=${otherAccount}`)).json().items,
    ).toEqual([]);
    expect(await balance()).toBe(9877);
  });
  it("rejects wrong-kind categories and validates the complete partial edit", async () => {
    expect(
      (await create({ ...input(), categoryId: incomeCategoryId })).statusCode,
    ).toBe(409);
    const row = await saved();
    expect(
      (
        await edit(row.id, {
          amount: { amount: 20, currency: "USD" },
          expectedVersion: 1,
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await edit(row.id, {
          kind: "income",
          amount: { amount: 20, currency: "USD" },
          expectedVersion: 1,
        })
      ).statusCode,
    ).toBe(409);
    const response = await edit(row.id, {
      kind: "income",
      categoryId: incomeCategoryId,
      amount: { amount: 20, currency: "USD" },
      expectedVersion: 1,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().baseAmount.amount).toBe(20);
    expect(await balance()).toBe(10020);
  });
  it("keeps historical archive reads and corrections but rejects new assignments", async () => {
    const row = await saved();
    await db
      .update(accounts)
      .set({ archivedAt: new Date() })
      .where(eq(accounts.id, accountId));
    await db
      .update(categories)
      .set({ archivedAt: new Date() })
      .where(eq(categories.id, categoryId));
    expect((await read(`${base()}/${row.id}`)).json()).toEqual(row);
    expect((await read(base())).json().items).toHaveLength(1);
    expect((await create(input())).statusCode).toBe(409);
    expect(
      (
        await edit(row.id, {
          accountId: accountId.toUpperCase(),
          categoryId: categoryId.toUpperCase(),
          note: "History",
          expectedVersion: 1,
        })
      ).statusCode,
    ).toBe(200);
    expect(await balance()).toBe(9877);
    const freshAccount = newId(),
      freshCategory = newId();
    await db.insert(accounts).values({
      id: freshAccount,
      ledgerId,
      name: "Active",
      type: "cash",
      openingBalance: 0,
    });
    await db
      .insert(categories)
      .values({ id: freshCategory, ledgerId, name: "Active", kind: "expense" });
    const fresh = await saved({
      ...input(),
      accountId: freshAccount,
      categoryId: freshCategory,
    });
    expect(
      (await edit(fresh.id, { accountId, expectedVersion: 1 })).statusCode,
    ).toBe(409);
    expect(
      (await edit(fresh.id, { categoryId, expectedVersion: 1 })).statusCode,
    ).toBe(409);
    expect((await remove(row.id, 2)).statusCode).toBe(204);
    expect(await balance()).toBe(10000);
  });
  it("serializes assignments against account and category archive transactions", async () => {
    for (const target of ["account", "category"] as const) {
      let release!: () => void, locked!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const ready = new Promise<void>((resolve) => {
        locked = resolve;
      });
      const archiving = db.transaction(async (tx) => {
        if (target === "category")
          await tx.execute(
            sql`SELECT pg_advisory_xact_lock(hashtextextended(${`categories:${ledgerId}`}, 0))`,
          );
        if (target === "account")
          await tx
            .update(accounts)
            .set({ archivedAt: new Date() })
            .where(eq(accounts.id, accountId));
        else
          await tx
            .update(categories)
            .set({ archivedAt: new Date() })
            .where(eq(categories.id, categoryId));
        locked();
        await gate;
      });
      await ready;
      const writing = create();
      // Observe blocked write using PostgreSQL rather than a timing assumption.
      try {
        let blocked = false;
        for (let i = 0; i < 100; i++) {
          const result = await db.execute(
            sql`SELECT 1 FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND pid <> pg_backend_pid()`,
          );
          if (result.rows.length) {
            blocked = true;
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        expect(blocked).toBe(true);
      } finally {
        release();
        await archiving;
      }
      expect((await writing).statusCode).toBe(409);
      await db
        .update(accounts)
        .set({ archivedAt: null })
        .where(eq(accounts.id, accountId));
      await db
        .update(categories)
        .set({ archivedAt: null })
        .where(eq(categories.id, categoryId));
    }
  });
  it("requires valid keys and trusted origins for all mutations", async () => {
    const row = await saved();
    for (const [method, path, payload] of [
      ["POST", base(), input()],
      ["PATCH", `${base()}/${row.id}`, { note: "Edit", expectedVersion: 1 }],
      ["DELETE", `${base()}/${row.id}`, { expectedVersion: 1 }],
    ] as const) {
      for (const key of [undefined, "short"])
        expect(
          (
            await app.inject({
              method,
              url: path,
              payload,
              headers: {
                cookie: ownerCookie,
                origin: config.APP_URL,
                ...(key ? { "idempotency-key": key } : {}),
              },
            })
          ).statusCode,
        ).toBe(400);
      for (const origin of [undefined, "https://evil.example"])
        expect(
          (
            await app.inject({
              method,
              url: path,
              payload,
              headers: {
                cookie: ownerCookie,
                "idempotency-key": newId(),
                ...(origin ? { origin } : {}),
              },
            })
          ).statusCode,
        ).toBe(403);
    }
  });
  it("commits concurrent create retries once and rejects changed requests", async () => {
    const key = newId();
    const responses = await Promise.all([
      create(input(), ledgerId, ownerCookie, key),
      create(input(), ledgerId.toUpperCase(), ownerCookie, key),
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
      (await create(input(-124), ledgerId, ownerCookie, key)).statusCode,
    ).toBe(409);
    expect(
      await db.select().from(transactions).where(fixtureScope),
    ).toHaveLength(1);
    expect(await balance()).toBe(9877);
  });
  it("replays edits and prevents stale or concurrent overwrites", async () => {
    const row = await saved();
    const key = newId(),
      body = { note: "Changed", expectedVersion: 1 };
    const first = await edit(row.id, body, ledgerId, ownerCookie, key);
    const replay = await edit(
      row.id.toUpperCase(),
      body,
      ledgerId,
      ownerCookie,
      key,
    );
    expect(first.statusCode).toBe(200);
    expect(replay.json()).toEqual(first.json());
    expect(replay.headers["idempotency-replayed"]).toBe("true");
    expect((await edit(row.id)).statusCode).toBe(409);
    const responses = await Promise.all([
      edit(row.id, { note: "A", expectedVersion: 2 }),
      edit(row.id, { note: "B", expectedVersion: 2 }),
    ]);
    expect(responses.map((response) => response.statusCode).sort()).toEqual([
      200, 409,
    ]);
    expect((await read(`${base()}/${row.id}`)).json().version).toBe(3);
  });
  it("recomputes list/detail/write account balances after status, amount, account and opening changes", async () => {
    const row = await saved({ ...input(-300), status: "pending" });
    expect(await balance()).toBe(10000);
    await edit(row.id, { status: "cleared", expectedVersion: 1 });
    expect(await balance()).toBe(9700);
    await edit(row.id, {
      amount: { amount: -400, currency: "USD" },
      expectedVersion: 2,
    });
    expect(await balance()).toBe(9600);
    const other = newId();
    await db.insert(accounts).values({
      id: other,
      ledgerId,
      name: "Cash",
      type: "cash",
      openingBalance: 1000,
    });
    await edit(row.id, { accountId: other, expectedVersion: 3 });
    expect(await balance()).toBe(10000);
    expect(await balance(other)).toBe(600);
    const edited = await app.inject({
      method: "PATCH",
      url: `/api/v1/ledgers/${ledgerId}/accounts/${other}`,
      headers: headers(),
      payload: {
        openingBalance: { amount: 2000, currency: "USD" },
        expectedVersion: 1,
      },
    });
    expect(edited.json().balance.amount).toBe(1600);
    const archived = await app.inject({
      method: "POST",
      url: `/api/v1/ledgers/${ledgerId}/accounts/${other}/archive`,
      headers: headers(),
      payload: { expectedVersion: 2 },
    });
    expect(archived.json().balance.amount).toBe(1600);
    const list = (await read(`/api/v1/ledgers/${ledgerId}/accounts`)).json()
      .items;
    expect(
      list.find((a: { id: string }) => a.id === other).balance.amount,
    ).toBe(1600);
    await edit(row.id, { status: "pending", expectedVersion: 4 });
    expect(await balance(other)).toBe(2000);
  });
  it("soft-deletes with version protection and replays empty 204 responses", async () => {
    const row = await saved();
    const key = newId();
    expect((await remove(row.id, 2)).statusCode).toBe(409);
    const first = await remove(row.id, 1, ledgerId, ownerCookie, key);
    expect(first.statusCode).toBe(204);
    expect(first.body).toBe("");
    const replay = await remove(row.id, 1, ledgerId, ownerCookie, key);
    expect(replay.statusCode).toBe(204);
    expect(replay.body).toBe("");
    expect(replay.headers["idempotency-replayed"]).toBe("true");
    for (const response of await Promise.all([
      read(`${base()}/${row.id}`),
      edit(row.id),
      remove(row.id),
    ]))
      expect(response.statusCode).toBe(404);
    expect((await read(base())).json().items).toEqual([]);
    expect(await balance()).toBe(10000);
    const [stored] = await db
      .select()
      .from(transactions)
      .where(eq(transactions.id, row.id));
    expect(stored?.deletedAt).not.toBeNull();
    expect(stored?.version).toBe(2);
    expect(stored?.amount).toBe(-123);
  });
  it("rolls back overflowing creates, edits, deletes and opening balances with no receipt", async () => {
    await db
      .update(accounts)
      .set({ openingBalance: Number.MAX_SAFE_INTEGER })
      .where(eq(accounts.id, accountId));
    const key = newId();
    expect(
      (await create(input(1), ledgerId, ownerCookie, key)).statusCode,
    ).toBe(409);
    expect(
      await db.select().from(transactions).where(fixtureScope),
    ).toHaveLength(0);
    expect(
      await db
        .select()
        .from(writeReceipts)
        .where(inArray(writeReceipts.ledgerId, fixtureLedgers)),
    ).toHaveLength(0);
    const offset = await saved(input(-1));
    const income = await saved(input(1));
    expect((await remove(offset.id)).statusCode).toBe(409);
    expect(
      (
        await edit(income.id, {
          amount: { amount: 2, currency: "USD" },
          expectedVersion: 1,
        })
      ).statusCode,
    ).toBe(409);
    expect((await read(`${base()}/${offset.id}`)).json().version).toBe(1);
    expect((await read(`${base()}/${income.id}`)).json().amount.amount).toBe(1);
    await remove(income.id);
    expect(
      (await create(input(1), ledgerId, ownerCookie, key)).statusCode,
    ).toBe(201);
    expect(await balance()).toBe(Number.MAX_SAFE_INTEGER);
    await db
      .update(accounts)
      .set({ openingBalance: Number.MAX_SAFE_INTEGER - 1 })
      .where(eq(accounts.id, accountId));
    await remove(offset.id); // now +1 is posted
    const response = await app.inject({
      method: "PATCH",
      url: `/api/v1/ledgers/${ledgerId}/accounts/${accountId}`,
      headers: headers(),
      payload: {
        openingBalance: { amount: Number.MAX_SAFE_INTEGER, currency: "USD" },
        expectedVersion: 1,
      },
    });
    expect(response.statusCode).toBe(409);
    expect(await balance()).toBe(Number.MAX_SAFE_INTEGER);
  });
  it("filters accounts, categories, inclusive dates, literal text, kind and status together", async () => {
    const first = await saved({
      ...input(-100),
      date: "2026-10-01",
      payee: "Market 50%_OFF",
      note: "Lunch",
    });
    await saved({ ...input(200), date: "2026-10-02", note: "MARKET" });
    await saved({ ...input(-300), date: "2026-10-03", status: "pending" });
    for (const [query, count] of [
      ["from=2026-10-01&to=2026-10-02", 2],
      ["text=market", 2],
      [`text=${encodeURIComponent("%_")}`, 1],
      ["status=pending", 1],
      ["kind=income", 1],
      [
        `accountId=${accountId}&categoryId=${categoryId}&from=2026-10-01&to=2026-10-01&text=lunch&status=cleared&kind=expense`,
        1,
      ],
      [`accountId=${newId()}`, 0],
    ] as const)
      expect((await read(`${base()}?${query}`)).json().items).toHaveLength(
        count,
      );
    expect(
      (await read(`${base()}?text=${encodeURIComponent("%_")}`)).json().items[0]
        .id,
    ).toBe(first.id);
  });
  it("paginates tied dates without duplicates or omissions and survives deletion of a cursor row", async () => {
    const rows: Transaction[] = [];
    for (const date of [
      "2026-10-02",
      "2026-10-01",
      "2026-10-03",
      "2026-10-02",
      "2026-10-02",
    ])
      rows.push(await saved({ ...input(), date }));
    const expected = [...rows]
      .sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id))
      .map((row) => row.id);
    const ids: string[] = [];
    let cursor: string | null = null;
    do {
      const page = transactionListSchema.parse(
        (
          await read(`${base()}?limit=2${cursor ? `&cursor=${cursor}` : ""}`)
        ).json(),
      );
      ids.push(...page.items.map((row) => row.id));
      cursor = page.nextCursor;
      if (ids.length > 5) throw new Error("Cursor did not advance");
    } while (cursor);
    expect(ids).toEqual(expected);
    const first = transactionListSchema.parse(
      (await read(`${base()}?limit=2`)).json(),
    );
    await remove(first.items[1]?.id ?? "");
    const next = transactionListSchema.parse(
      (await read(`${base()}?limit=2&cursor=${first.nextCursor}`)).json(),
    );
    expect(next.items.map((row) => row.id)).toEqual(expected.slice(2, 4));
  });
  it("rechecks deleted ledger/membership and revoked roles before retries", async () => {
    const key = newId();
    const row = transactionSchema.parse(
      (await create(input(), ledgerId, ownerCookie, key)).json(),
    );
    const memberScope = and(
      eq(ledgerMembers.ledgerId, ledgerId),
      eq(ledgerMembers.userId, ownerId),
    );
    for (const target of ["ledger", "membership"]) {
      if (target === "ledger")
        await db
          .update(ledgers)
          .set({ deletedAt: new Date() })
          .where(eq(ledgers.id, ledgerId));
      else
        await db
          .update(ledgerMembers)
          .set({ deletedAt: new Date() })
          .where(memberScope);
      for (const response of await Promise.all([
        read(base()),
        read(`${base()}/${row.id}`),
        create(input(), ledgerId, ownerCookie, key),
        edit(row.id),
        remove(row.id),
      ]))
        expect(response.statusCode).toBe(404);
      await db
        .update(ledgers)
        .set({ deletedAt: null })
        .where(eq(ledgers.id, ledgerId));
      await db
        .update(ledgerMembers)
        .set({ deletedAt: null })
        .where(memberScope);
    }
    await db.update(ledgerMembers).set({ role: "viewer" }).where(memberScope);
    expect((await create(input(), ledgerId, ownerCookie, key)).statusCode).toBe(
      403,
    );
  });
  it("rejects tombstoned reference assignments", async () => {
    await saved();
    // Paired leg mutation guards are covered by the Transfers integration suite.
    await db
      .update(categories)
      .set({ deletedAt: new Date() })
      .where(eq(categories.id, categoryId));
    expect((await create()).statusCode).toBe(404);
    await db
      .update(categories)
      .set({ deletedAt: null })
      .where(eq(categories.id, categoryId));
    await db
      .update(accounts)
      .set({ deletedAt: new Date() })
      .where(eq(accounts.id, accountId));
    expect((await create()).statusCode).toBe(404);
  });
  it("enforces composite ledger/kind references and exact money invariants in PostgreSQL", async () => {
    const body = {
      ledgerId,
      accountId,
      categoryId,
      kind: "expense" as const,
      date: "2026-10-07",
      amount: -1,
      baseAmount: -1,
    };
    for (const changes of [
      { ledgerId: secondLedger },
      { categoryId: incomeCategoryId },
      { amount: 0, baseAmount: 0 },
      { amount: -2 },
      { fxRate: 2 },
      { currency: "BDT" },
      { status: "invalid" as "cleared" },
    ])
      await expect(
        db.insert(transactions).values({ ...body, ...changes }),
      ).rejects.toThrow();
  });
  it("keeps foreign transaction totals and filtered pages isolated", async () => {
    const otherAccount = newId(),
      otherCategory = newId(),
      otherTransaction = newId();
    await db.insert(accounts).values({
      id: otherAccount,
      ledgerId: secondLedger,
      name: "Other",
      type: "bank",
      openingBalance: 2000,
    });
    await db.insert(categories).values({
      id: otherCategory,
      ledgerId: secondLedger,
      name: "Other",
      kind: "income",
    });
    await db.insert(transactions).values({
      id: otherTransaction,
      ledgerId: secondLedger,
      accountId: otherAccount,
      categoryId: otherCategory,
      kind: "income",
      date: "2026-10-07",
      amount: 999,
      baseAmount: 999,
    });
    const a = await saved({ ...input(-1), payee: "Match" });
    await saved({ ...input(-2), status: "pending", payee: "Match" });
    const b = await saved({ ...input(-3), payee: "match" });
    const first = transactionListSchema.parse(
      (await read(`${base()}?limit=1&status=cleared&text=match`)).json(),
    );
    expect(first.items.map((row) => row.id)).toEqual([b.id]);
    const last = transactionListSchema.parse(
      (
        await read(
          `${base()}?limit=1&status=cleared&text=match&cursor=${first.nextCursor}`,
        )
      ).json(),
    );
    expect(last.items.map((row) => row.id)).toEqual([a.id]);
    expect(last.nextCursor).toBeNull();
    expect(
      (await read(base(secondLedger)))
        .json()
        .items.map((row: Transaction) => row.id),
    ).toEqual([otherTransaction]);
    for (const response of await Promise.all([
      read(`${base()}/${otherTransaction}`),
      edit(otherTransaction),
      remove(otherTransaction),
    ]))
      expect(response.statusCode).toBe(404);
    expect(await balance()).toBe(9996);
    expect(
      (
        await read(`/api/v1/ledgers/${secondLedger}/accounts/${otherAccount}`)
      ).json().balance.amount,
    ).toBe(2999);
  });
  it("replays persisted create receipts from a fresh connection and after later correction", async () => {
    const key = newId();
    const row = transactionSchema.parse(
      (await create(input(), ledgerId, ownerCookie, key)).json(),
    );
    await edit(row.id, { note: "Later", expectedVersion: 1 });
    const restarted = createDatabase(url);
    const { createTransaction } = await import("./service");
    try {
      const result = await createTransaction(
        restarted.db,
        { actorId: ownerId, ledgerId, key },
        {
          ...input(),
          kind: "expense",
          amount: { amount: -123, currency: "USD" },
          status: "cleared",
          payee: null,
          note: null,
        },
      );
      expect(result.replayed).toBe(true);
      expect(result.body).toEqual(row);
    } finally {
      await restarted.pool.end();
    }
    expect((await read(`${base()}/${row.id}`)).json().version).toBe(2);
    expect(await balance()).toBe(9877);
  });
  it("resolves concurrent edit/delete without a lost version or duplicate balance effect", async () => {
    const row = await saved();
    const responses = await Promise.all([
      edit(row.id, {
        amount: { amount: -200, currency: "USD" },
        expectedVersion: 1,
      }),
      remove(row.id),
    ]);
    const statuses = responses.map((response) => response.statusCode).sort();
    expect([
      [200, 409],
      [204, 404],
    ]).toContainEqual(statuses);
    const detail = await read(`${base()}/${row.id}`);
    if (detail.statusCode === 404) expect(await balance()).toBe(10000);
    else {
      expect(detail.json().version).toBe(2);
      expect(await balance()).toBe(9800);
    }
  });
  it("restores the same deleted identity/history and archived references with exact balance and replay", async () => {
    const row = await saved({ ...input(), time: "14:30", note: "History" });
    await remove(row.id);
    await db
      .update(accounts)
      .set({ archivedAt: new Date() })
      .where(eq(accounts.id, accountId));
    await db
      .update(categories)
      .set({ archivedAt: new Date() })
      .where(eq(categories.id, categoryId));
    const key = newId();
    const result = await restore(row.id, 2, ledgerId, ownerCookie, key);
    expect(result.statusCode).toBe(200);
    expect(result.json()).toMatchObject({
      ...row,
      version: 3,
      updatedAt: expect.any(String),
    });
    expect(
      (await restore(row.id, 2, ledgerId, ownerCookie, key)).json(),
    ).toEqual(result.json());
    expect((await restore(row.id, 2)).statusCode).toBe(409);
    expect((await restore(row.id, 3)).statusCode).toBe(409);
    expect(await balance()).toBe(9877);
    expect((await read(base())).json().items).toHaveLength(1);
  });
  it("scopes restore and enforces authentication, roles, Origin, keys and expected versions", async () => {
    const row = await saved();
    await remove(row.id);
    expect((await restore(row.id, 2, secondLedger)).statusCode).toBe(404);
    expect((await restore(row.id, 2, foreignLedger)).statusCode).toBe(404);
    expect((await restore(row.id, 2, ledgerId, "")).statusCode).toBe(401);
    expect((await restore(row.id, 2, ledgerId, viewerCookie)).statusCode).toBe(
      403,
    );
    expect((await restore(row.id, 1)).statusCode).toBe(409);
    for (const headers of [
      { cookie: ownerCookie, origin: config.APP_URL },
      { cookie: ownerCookie, "idempotency-key": newId() },
      {
        cookie: ownerCookie,
        origin: "https://evil.example",
        "idempotency-key": newId(),
      },
    ]) {
      const result = await app.inject({
        method: "POST",
        url: `${base()}/${row.id}/restore`,
        headers,
        payload: { expectedVersion: 2 },
      });
      expect([400, 403]).toContain(result.statusCode);
    }
    expect((await restore(row.id, 2, ledgerId, editorCookie)).statusCode).toBe(
      200,
    );
    expect(await balance()).toBe(9877);
  });
  it("restores pending entries without posting and serializes concurrent restore intents", async () => {
    const row = await saved({ ...input(), status: "pending" });
    await remove(row.id);
    const results = await Promise.all([restore(row.id), restore(row.id)]);
    expect(results.map((item) => item.statusCode).sort()).toEqual([200, 409]);
    expect((await read(`${base()}/${row.id}`)).json()).toMatchObject({
      status: "pending",
      version: 3,
    });
    expect(await balance()).toBe(10000);
  });
  it("rolls back overflowing restoration and its receipt, then permits the same-key retry", async () => {
    const row = await saved();
    await remove(row.id);
    await db
      .update(accounts)
      .set({ openingBalance: Number.MIN_SAFE_INTEGER })
      .where(eq(accounts.id, accountId));
    const key = newId();
    expect(
      (await restore(row.id, 2, ledgerId, ownerCookie, key)).statusCode,
    ).toBe(409);
    expect((await read(`${base()}/${row.id}`)).statusCode).toBe(404);
    expect(
      await db
        .select()
        .from(writeReceipts)
        .where(
          and(eq(writeReceipts.ledgerId, ledgerId), eq(writeReceipts.key, key)),
        ),
    ).toHaveLength(0);
    await db
      .update(accounts)
      .set({ openingBalance: 10000 })
      .where(eq(accounts.id, accountId));
    expect(
      (await restore(row.id, 2, ledgerId, ownerCookie, key)).statusCode,
    ).toBe(200);
    expect(await balance()).toBe(9877);
  });
  it("rejects restoration with tombstoned references", async () => {
    const row = await saved();
    await remove(row.id);
    for (const table of [accounts, categories]) {
      const id = table === accounts ? accountId : categoryId;
      await db
        .update(table)
        .set({ deletedAt: new Date() })
        .where(eq(table.id, id));
      expect((await restore(row.id)).statusCode).toBe(404);
      await db.update(table).set({ deletedAt: null }).where(eq(table.id, id));
    }
    // Paired leg restoration is covered by the Transfers integration suite.
    expect(await balance()).toBe(10000);
  });
  it("documents all six secured endpoints with keys, versions and problem responses", async () => {
    const doc = (await read("/api/v1/openapi.json")).json();
    expect(doc.info.version).toBe("0.1.19");
    const prefix = "/api/v1/ledgers/{ledgerId}/transactions";
    for (const [path, method] of [
      [prefix, "get"],
      [prefix, "post"],
      [`${prefix}/{transactionId}`, "get"],
      [`${prefix}/{transactionId}`, "patch"],
      [`${prefix}/{transactionId}`, "delete"],
      [`${prefix}/{transactionId}/restore`, "post"],
    ]) {
      const operation = doc.paths[path as string][method as string];
      expect(operation.security).toEqual([{ sessionCookie: [] }]);
      expect(operation.responses["404"]).toBeDefined();
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
  it("rejects deletion of an account with a posted zero balance while any transaction remains", async () => {
    await saved(input(-10000));
    expect(await balance()).toBe(0);
    const response = await app.inject({
      method: "DELETE",
      url: `/api/v1/ledgers/${ledgerId}/accounts/${accountId}`,
      headers: headers(),
      payload: { expectedVersion: 1 },
    });
    expect(response.statusCode).toBe(409);
    expect(await balance()).toBe(0);
  });
  for (const resource of ["accounts", "categories"] as const) {
    const referenceId = () =>
      resource === "accounts" ? accountId : categoryId;
    const referenceTable = () =>
      resource === "accounts" ? accounts : categories;
    const referencePath = (ledger = ledgerId) =>
      `/api/v1/ledgers/${ledger}/${resource}/${referenceId()}`;
    const deleteReference = (
      version = 1,
      ledger = ledgerId,
      cookie = ownerCookie,
      key = newId(),
    ) =>
      app.inject({
        method: "DELETE",
        url: referencePath(ledger),
        headers: headers(cookie, key),
        payload: { expectedVersion: version },
      });
    it(`deletes unused ${resource}, including archives, with versioned 204 replay and hidden tombstones`, async () => {
      await db
        .update(referenceTable())
        .set({ archivedAt: new Date() })
        .where(eq(referenceTable().id, referenceId()));
      const before = (await read(referencePath())).json();
      expect((await deleteReference(2)).statusCode).toBe(409);
      const key = newId();
      const responses = await Promise.all([
        deleteReference(1, ledgerId, ownerCookie, key),
        deleteReference(1, ledgerId, ownerCookie, key),
      ]);
      expect(responses.map((r) => r.statusCode)).toEqual([204, 204]);
      expect(responses.every((r) => r.body === "")).toBe(true);
      expect(
        (await deleteReference(1, ledgerId, ownerCookie, key)).headers[
          "idempotency-replayed"
        ],
      ).toBe("true");
      expect((await deleteReference()).statusCode).toBe(404);
      expect((await read(referencePath())).statusCode).toBe(404);
      expect(
        (await read(`/api/v1/ledgers/${ledgerId}/${resource}`))
          .json()
          .items.some((item: { id: string }) => item.id === referenceId()),
      ).toBe(false);
      const stored = (
        await db
          .select()
          .from(referenceTable())
          .where(eq(referenceTable().id, referenceId()))
      )[0];
      expect(stored).toMatchObject({ version: 2, name: before.name });
      expect(stored?.deletedAt).not.toBeNull();
      expect((await create()).statusCode).toBe(404);
      expect(
        (await deleteReference(2, ledgerId, ownerCookie, key)).statusCode,
      ).toBe(409);
    });
    it(`blocks ${resource} deletion for cleared and pending transactions`, async () => {
      const row = await saved();
      const key = newId();
      expect(
        (await deleteReference(1, ledgerId, ownerCookie, key)).statusCode,
      ).toBe(409);
      expect(
        await db
          .select()
          .from(writeReceipts)
          .where(
            and(
              eq(writeReceipts.ledgerId, ledgerId),
              eq(writeReceipts.key, key),
            ),
          ),
      ).toHaveLength(0);
      await edit(row.id, { status: "pending", expectedVersion: 1 });
      expect((await deleteReference()).statusCode).toBe(409);
      await remove(row.id, 2);
      expect(
        (await deleteReference(1, ledgerId, ownerCookie, key)).statusCode,
      ).toBe(204);
      const result = await restore(row.id, 3);
      expect(result.statusCode).toBe(404);
      expect(
        (
          await db
            .select()
            .from(transactions)
            .where(eq(transactions.id, row.id))
        )[0],
      ).toMatchObject({ version: 3, accountId, categoryId });
      expect((await read(base())).json().items).toEqual([]);
    });
    it(`allows editor deletion and enforces ${resource} ledger/role/Origin/key/privacy guards`, async () => {
      for (const ledger of [secondLedger, foreignLedger])
        expect((await deleteReference(1, ledger)).statusCode).toBe(404);
      expect((await deleteReference(1, ledgerId, "")).statusCode).toBe(401);
      expect(
        (await deleteReference(1, ledgerId, viewerCookie)).statusCode,
      ).toBe(403);
      for (const badHeaders of [
        { cookie: ownerCookie, origin: config.APP_URL },
        { cookie: ownerCookie, "idempotency-key": newId() },
        { ...headers(), origin: "https://evil.example" },
      ]) {
        const result = await app.inject({
          method: "DELETE",
          url: referencePath(),
          headers: badHeaders,
          payload: { expectedVersion: 1 },
        });
        expect([400, 403]).toContain(result.statusCode);
        expect(result.body).not.toContain("Checking");
        expect(result.body).not.toContain("Food");
      }
      expect(
        (await deleteReference(1, ledgerId, editorCookie)).statusCode,
      ).toBe(204);
      const doc = (await read("/api/v1/openapi.json")).json();
      const operation =
        doc.paths[
          `/api/v1/ledgers/{ledgerId}/${resource}/{${resource === "accounts" ? "accountId" : "categoryId"}}`
        ].delete;
      expect(operation.security).toEqual([{ sessionCookie: [] }]);
      expect(operation.parameters).toContainEqual(
        expect.objectContaining({ name: "idempotency-key", required: true }),
      );
      expect(operation.responses["204"]).toBeDefined();
      expect(operation.responses["409"]).toBeDefined();
    });
    it(`serializes ${resource} deletion against new assignments without dangling live entries`, async () => {
      const responses = await Promise.all([create(), deleteReference()]);
      expect([
        [201, 409],
        [404, 204],
      ]).toContainEqual(responses.map((r) => r.statusCode));
      if (responses[0]?.statusCode === 201)
        expect((await read(referencePath())).statusCode).toBe(200);
      else expect((await read(base())).json().items).toEqual([]);
    });
    it(`serializes ${resource} deletion against transaction Undo`, async () => {
      const row = await saved();
      await remove(row.id);
      const responses = await Promise.all([restore(row.id), deleteReference()]);
      expect([
        [200, 409],
        [404, 204],
      ]).toContainEqual(responses.map((r) => r.statusCode));
      if (responses[0]?.statusCode === 200)
        expect((await read(referencePath())).statusCode).toBe(200);
      else expect((await read(`${base()}/${row.id}`)).statusCode).toBe(404);
    });
  }
  it("requires deletion or reparenting of category children, including archives, and releases deleted names", async () => {
    const childId = newId();
    await db.insert(categories).values({
      id: childId,
      ledgerId,
      parentId: categoryId,
      name: "Child",
      kind: "expense",
      archivedAt: new Date(),
    });
    const removeCategory = (id: string) =>
      app.inject({
        method: "DELETE",
        url: `/api/v1/ledgers/${ledgerId}/categories/${id}`,
        headers: headers(),
        payload: { expectedVersion: 1 },
      });
    expect((await removeCategory(categoryId)).statusCode).toBe(409);
    expect((await removeCategory(childId)).statusCode).toBe(204);
    expect((await removeCategory(categoryId)).statusCode).toBe(204);
    const replacement = await app.inject({
      method: "POST",
      url: `/api/v1/ledgers/${ledgerId}/categories`,
      headers: headers(),
      payload: { name: "Food", kind: "expense" },
    });
    expect(replacement.statusCode).toBe(201);
    expect(replacement.json().id).not.toBe(categoryId);
  });
  describe("split transactions", () => {
    const splitInput = (amount = -123) => ({
      ...input(amount),
      categoryId: null,
      splits: [
        {
          categoryId: amount < 0 ? categoryId : incomeCategoryId,
          amount: { amount: amount < 0 ? -23 : 23, currency: "USD" },
          note: "First",
        },
        {
          categoryId: amount < 0 ? categoryId : incomeCategoryId,
          amount: { amount: amount < 0 ? -100 : 100, currency: "USD" },
          note: null,
        },
      ],
    });
    const splitRows = () =>
      db
        .select()
        .from(transactionSplits)
        .where(eq(transactionSplits.ledgerId, ledgerId));
    it("normalizes pre-split receipts without changing the saved request fingerprint", async () => {
      const key = newId();
      const response = await create(input(), ledgerId, ownerCookie, key);
      const legacy = response.json();
      delete legacy.isSplit;
      delete legacy.splits;
      await db
        .update(writeReceipts)
        .set({ responseBody: legacy })
        .where(
          and(eq(writeReceipts.ledgerId, ledgerId), eq(writeReceipts.key, key)),
        );
      const replay = await create(input(), ledgerId, ownerCookie, key);
      expect(replay.statusCode).toBe(201);
      expect(replay.headers["idempotency-replayed"]).toBe("true");
      expect(replay.json()).toEqual({ ...legacy, isSplit: false, splits: [] });
    });
    it("creates exact category allocations while posting the parent once, with category-filter discovery", async () => {
      const row = await saved(splitInput());
      expect(row).toMatchObject({
        isSplit: true,
        categoryId: null,
        time: null,
        amount: { amount: -123 },
        fxRate: 1,
        baseAmount: { amount: -123 },
      });
      expect(row.splits.map((line) => line.amount.amount)).toEqual([-23, -100]);
      expect(await balance()).toBe(9877);
      expect(
        (await read(`${base()}?categoryId=${categoryId}`))
          .json()
          .items.map((r: Transaction) => r.id),
      ).toEqual([row.id]);
      expect(
        await postedCategoryTotals(db, ledgerId, "2026-10-01", "2026-10-31"),
      ).toEqual(new Map([[categoryId, -123n]]));
      expect(
        await postedCategoryTotals(
          db,
          secondLedger,
          "2026-10-01",
          "2026-10-31",
        ),
      ).toEqual(new Map());
      expect(
        await postedCategoryTotals(db, ledgerId, "2026-11-01", "2026-11-30"),
      ).toEqual(new Map());
    });
    it("supports income and pending splits without double-counting or posting pending lines", async () => {
      const row = await saved({
        ...splitInput(123),
        status: "pending",
        time: "09:05",
      });
      expect(await balance()).toBe(10000);
      expect(
        await postedCategoryTotals(db, ledgerId, "2026-10-01", "2026-10-31"),
      ).toEqual(new Map());
      expect(
        (await edit(row.id, { status: "cleared", expectedVersion: 1 }))
          .statusCode,
      ).toBe(200);
      expect(await balance()).toBe(10123);
      expect(
        await postedCategoryTotals(db, ledgerId, "2026-10-01", "2026-10-31"),
      ).toEqual(new Map([[incomeCategoryId, 123n]]));
    });
    it("replays create/edit/delete/Undo with stable identities and same shared versions", async () => {
      const key = newId();
      const results = await Promise.all([
        create(splitInput(), ledgerId, ownerCookie, key),
        create(splitInput(), ledgerId, ownerCookie, key),
      ]);
      expect(results.map((r) => r.statusCode)).toEqual([201, 201]);
      expect(results[1]?.json()).toEqual(results[0]?.json());
      const row: Transaction = results[0]?.json();
      const patch = { note: "Correction", expectedVersion: 1 };
      const editKey = newId();
      const updated = await edit(row.id, patch, ledgerId, ownerCookie, editKey);
      expect(
        (await edit(row.id, patch, ledgerId, ownerCookie, editKey)).json(),
      ).toEqual(updated.json());
      expect(
        updated.json().splits.map((l: Transaction["splits"][number]) => l.id),
      ).toEqual(row.splits.map((l) => l.id));
      const deleteKey = newId();
      expect(
        (await remove(row.id, 2, ledgerId, ownerCookie, deleteKey)).statusCode,
      ).toBe(204);
      expect(
        (await remove(row.id, 2, ledgerId, ownerCookie, deleteKey)).headers[
          "idempotency-replayed"
        ],
      ).toBe("true");
      expect(
        (await splitRows()).every((l) => l.deletedAt && l.version === 3),
      ).toBe(true);
      const restoreKey = newId();
      const restored = await restore(
        row.id,
        3,
        ledgerId,
        ownerCookie,
        restoreKey,
      );
      expect(
        (await restore(row.id, 3, ledgerId, ownerCookie, restoreKey)).json(),
      ).toEqual(restored.json());
      expect(
        restored.json().splits.map((l: Transaction["splits"][number]) => l.id),
      ).toEqual(row.splits.map((l) => l.id));
      expect(
        (await splitRows()).every((l) => !l.deletedAt && l.version === 4),
      ).toBe(true);
      expect(await balance()).toBe(9877);
    });
    it("retains kept line IDs, tombstones removed lines, adds new lines, and restores only the last allocation", async () => {
      const row = await saved(splitInput());
      const payload = {
        categoryId: null,
        splits: [
          {
            id: row.splits[0]?.id,
            categoryId,
            amount: { amount: -24, currency: "USD" },
            note: null,
          },
          { categoryId, amount: { amount: -99, currency: "USD" }, note: "New" },
        ],
        expectedVersion: 1,
      };
      const response = await edit(row.id, payload);
      expect(response.statusCode).toBe(200);
      const updated: Transaction = response.json();
      expect(updated.splits[0]?.id).toBe(row.splits[0]?.id);
      expect(updated.splits[1]?.id).not.toBe(row.splits[1]?.id);
      expect(
        (await splitRows()).find((l) => l.id === row.splits[1]?.id)?.deletedAt,
      ).not.toBeNull();
      await remove(row.id, 2);
      await restore(row.id, 3);
      expect(
        (await read(`${base()}/${row.id}`))
          .json()
          .splits.map((l: Transaction["splits"][number]) => l.id),
      ).toEqual(updated.splits.map((l) => l.id));
    });
    it("converts ordinary entries to splits and back without resurrecting removed allocations", async () => {
      const row = await saved();
      expect(
        (
          await edit(row.id, {
            categoryId: null,
            splits: splitInput().splits,
            expectedVersion: 1,
          })
        ).statusCode,
      ).toBe(200);
      expect(
        (
          await edit(row.id, { categoryId, splits: null, expectedVersion: 2 })
        ).json(),
      ).toMatchObject({ isSplit: false, splits: [] });
      expect((await splitRows()).every((l) => l.deletedAt)).toBe(true);
      await remove(row.id, 3);
      await restore(row.id, 4);
      expect((await read(`${base()}/${row.id}`)).json().splits).toEqual([]);
      expect(await balance()).toBe(9877);
    });
    it("rejects mismatches, mixed directions, unsafe cents, fewer lines, IDs on create and stale parents without receipts", async () => {
      const invalid = [
        { ...splitInput(), amount: { amount: -124, currency: "USD" } },
        { ...splitInput(), categoryId },
        { ...splitInput(), splits: splitInput().splits.slice(0, 1) },
        {
          ...splitInput(),
          splits: splitInput().splits.map((l) => ({ ...l, id: newId() })),
        },
        {
          ...splitInput(),
          splits: [
            { categoryId, amount: { amount: 23, currency: "USD" }, note: null },
            splitInput().splits[1],
          ],
        },
      ];
      for (const payload of invalid)
        expect((await create(payload)).statusCode).toBe(400);
      expect(await splitRows()).toHaveLength(0);
      const row = await saved(splitInput());
      expect(
        (await edit(row.id, { note: "Stale", expectedVersion: 2 })).statusCode,
      ).toBe(409);
      expect((await remove(row.id, 2)).statusCode).toBe(409);
      expect(
        (await splitRows()).every((l) => l.version === 1 && !l.deletedAt),
      ).toBe(true);
    });
    it("rejects foreign/wrong-kind/deleted/new archived categories and unrelated line IDs", async () => {
      const foreign = newId();
      await db.insert(categories).values({
        id: foreign,
        ledgerId: secondLedger,
        name: "Other",
        kind: "expense",
      });
      for (const [id, status] of [
        [foreign, 404],
        [incomeCategoryId, 409],
        [newId(), 404],
      ] as const) {
        const payload = splitInput();
        if (payload.splits[0]) payload.splits[0].categoryId = id;
        expect((await create(payload)).statusCode).toBe(status);
      }
      const row = await saved(splitInput());
      await db
        .update(categories)
        .set({ archivedAt: new Date() })
        .where(eq(categories.id, categoryId));
      expect(
        (await edit(row.id, { note: "Historical", expectedVersion: 1 }))
          .statusCode,
      ).toBe(200);
      expect((await create(splitInput())).statusCode).toBe(409);
      const payload = {
        ...splitInput(),
        splits: splitInput().splits.map((l) => ({ ...l, id: newId() })),
        expectedVersion: 2,
      };
      expect((await edit(row.id, payload)).statusCode).toBe(404);
      await remove(row.id, 2);
      expect((await restore(row.id, 3)).statusCode).toBe(200);
    });
    it("blocks category deletion for live allocations and refuses Undo after reference deletion", async () => {
      const row = await saved(splitInput());
      const deleteCategory = () =>
        app.inject({
          method: "DELETE",
          url: `/api/v1/ledgers/${ledgerId}/categories/${categoryId}`,
          headers: headers(),
          payload: { expectedVersion: 1 },
        });
      expect((await deleteCategory()).statusCode).toBe(409);
      await remove(row.id);
      expect((await deleteCategory()).statusCode).toBe(204);
      expect((await restore(row.id)).statusCode).toBe(404);
      expect(
        (await splitRows()).every((l) => l.deletedAt && l.version === 2),
      ).toBe(true);
      expect(await balance()).toBe(10000);
    });
    it("denies inaccessible ledger and viewer mutations, with no financial values in errors", async () => {
      for (const ledger of [secondLedger, foreignLedger])
        expect((await create(splitInput(), ledger)).statusCode).toBe(404);
      expect(
        (await create(splitInput(), ledgerId, viewerCookie)).statusCode,
      ).toBe(403);
      const row = await saved(splitInput());
      for (const ledger of [secondLedger, foreignLedger]) {
        expect((await read(`${base(ledger)}/${row.id}`)).statusCode).toBe(404);
        expect(
          (await edit(row.id, { note: "Secret", expectedVersion: 1 }, ledger))
            .statusCode,
        ).toBe(404);
        expect((await remove(row.id, 1, ledger)).statusCode).toBe(404);
        expect((await restore(row.id, 2, ledger)).statusCode).toBe(404);
      }
      for (const result of [
        await edit(
          row.id,
          { note: "Secret", expectedVersion: 1 },
          ledgerId,
          viewerCookie,
        ),
        await remove(row.id, 1, ledgerId, viewerCookie),
        await restore(row.id, 2, ledgerId, viewerCookie),
      ]) {
        expect(result.statusCode).toBe(403);
        expect(result.body).not.toContain("Secret");
        expect(result.body).not.toContain("First");
      }
    });
    it("rolls back partial allocations and the parent/receipt when a late line insert fails", async () => {
      const name = `split_fault_${ledgerId.replaceAll("-", "")}`;
      await pool.query(
        `CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.ledger_id='${ledgerId}' AND NEW.position=1 THEN RAISE EXCEPTION 'Synthetic failure'; END IF; RETURN NEW; END $$`,
      );
      await pool.query(
        `CREATE TRIGGER ${name} BEFORE INSERT ON transaction_splits FOR EACH ROW EXECUTE FUNCTION ${name}()`,
      );
      const key = newId();
      try {
        expect(
          (await create(splitInput(), ledgerId, ownerCookie, key)).statusCode,
        ).toBe(500);
        expect(await splitRows()).toHaveLength(0);
        expect((await read(base())).json().items).toHaveLength(0);
        expect(await balance()).toBe(10000);
      } finally {
        await pool.query(`DROP TRIGGER ${name} ON transaction_splits`);
        await pool.query(`DROP FUNCTION ${name}()`);
      }
      expect(
        (await create(splitInput(), ledgerId, ownerCookie, key)).statusCode,
      ).toBe(201);
    });
    it("enforces the exact parent/line invariant even for direct database writes", async () => {
      const row = await saved(splitInput());
      await expect(
        db.transaction(async (tx) => {
          await tx
            .update(transactionSplits)
            .set({ amount: -25 })
            .where(eq(transactionSplits.id, row.splits[0]?.id ?? ""));
        }),
      ).rejects.toThrow();
      expect(
        (await edit(row.id, { note: "Next version", expectedVersion: 1 }))
          .statusCode,
      ).toBe(200);
      await expect(
        db.transaction(async (tx) => {
          await tx.insert(transactionSplits).values({
            id: newId(),
            ledgerId,
            transactionId: row.id,
            categoryId,
            kind: "expense",
            amount: -1,
            position: 2,
            version: 1,
          });
        }),
      ).rejects.toThrow();
      expect(await balance()).toBe(9877);
      expect((await splitRows()).map((l) => l.amount)).toEqual([-23, -100]);
    });
    it("serializes concurrent stale corrections of all allocations", async () => {
      const row = await saved(splitInput());
      const results = await Promise.all([
        edit(row.id, { note: "A", expectedVersion: 1 }),
        edit(row.id, { note: "B", expectedVersion: 1 }),
      ]);
      expect(results.map((r) => r.statusCode).sort()).toEqual([200, 409]);
      expect((await splitRows()).every((l) => l.version === 2)).toBe(true);
    });
    it("serializes category deletion against incoming split references", async () => {
      const results = await Promise.all([
        create(splitInput()),
        app.inject({
          method: "DELETE",
          url: `/api/v1/ledgers/${ledgerId}/categories/${categoryId}`,
          headers: headers(),
          payload: { expectedVersion: 1 },
        }),
      ]);
      expect([
        [201, 409],
        [404, 204],
      ]).toContainEqual(results.map((r) => r.statusCode));
    });
    it("rolls back split allocations when the parent would overflow its posted balance", async () => {
      await db
        .update(accounts)
        .set({ openingBalance: Number.MAX_SAFE_INTEGER })
        .where(eq(accounts.id, accountId));
      const result = await create(splitInput(123));
      expect(result.statusCode).toBe(409);
      expect(await splitRows()).toHaveLength(0);
      expect((await read(base())).json().items).toHaveLength(0);
      expect(await balance()).toBe(Number.MAX_SAFE_INTEGER);
    });
  });
});
