import { newId, transferSchema } from "@ledgerline/shared";
import { and, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../../app";
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
import {
  requireTestDatabase,
  seedUser,
  signInCookie,
  testConfig,
} from "../../test-support/harness";

const url = requireTestDatabase("Transactions tests");
const config = testConfig(url, "bonus");
const { db, pool } = createDatabase(url);
const app = await buildApp(db, config);
let ledgerId = "",
  ownerId = "",
  ownerCookie = "",
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
async function signIn(email: string) {
  return signInCookie(app, config, email);
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
      name: "Synthetic bonus test ledger",
    })),
  );

  for (const [index, role] of (
    ["owner", "editor", "viewer"] as const
  ).entries()) {
    const id = fixtureUsers[index];
    if (!id) throw new Error("Missing fixture ID");
    const email = `bonus-${role}-${id}@example.com`;
    await seedUser(db, config, { id, email, name: role, ledgerId, role });
  }
  await db
    .insert(ledgerMembers)
    .values({ userId: ownerId, ledgerId: secondLedger, role: "owner" });
  await app.ready();
  ownerCookie = await signIn(`bonus-owner-${ownerId}@example.com`);
  viewerCookie = await signIn(`bonus-viewer-${fixtureUsers[2]}@example.com`);
});
const fixtureScope = inArray(transactions.ledgerId, fixtureLedgers);
beforeEach(async () => {
  // Clear only this suite's synthetic rows, retaining every unrelated ledger.
  await db.delete(transactions).where(fixtureScope);
  await db.delete(accounts).where(inArray(accounts.ledgerId, fixtureLedgers));
  await db
    .delete(categories)
    .where(inArray(categories.ledgerId, fixtureLedgers));
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
  await db.delete(accounts).where(inArray(accounts.ledgerId, fixtureLedgers));
  await db
    .delete(categories)
    .where(inArray(categories.ledgerId, fixtureLedgers));
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

const bonusInput = (extra: object = {}, amount = 1000) => ({
  ...input(amount),
  bonus: { amount: { amount: 25, currency: "USD" as const }, ...extra },
});
const bonusRows = (id: string) =>
  db
    .select()
    .from(transactions)
    .where(
      and(
        eq(transactions.ledgerId, ledgerId),
        eq(transactions.relatedTransferId, id),
      ),
    );
const patchAccount = (id: string, payload: unknown, ledger = ledgerId) =>
  app.inject({
    method: "PATCH",
    url: `/api/v1/ledgers/${ledger}/accounts/${id}`,
    headers: headers(),
    payload: JSON.stringify(payload),
  });

describe("Transfer bonus API", () => {
  it("saves the transfer and one linked income entry together, counted in the balance", async () => {
    const before = await balance(cashId);
    const response = await create(bonusInput({ categoryId: incomeCategoryId }));
    expect(response.statusCode).toBe(201);
    const row = transferSchema.parse(response.json());
    const [bonus] = await bonusRows(row.id);
    expect(bonus).toMatchObject({
      kind: "income",
      accountId: cashId,
      categoryId: incomeCategoryId,
      amount: 25,
      currency: "USD",
      baseAmount: 25,
      date: "2026-10-07",
      transferId: null,
      relatedTransferId: row.id,
    });
    expect(row.bonus).toEqual({
      transactionId: bonus?.id,
      amount: { amount: 25, currency: "USD" },
      categoryId: incomeCategoryId,
      deletedAt: null,
    });
    expect(await legs(row.id)).toHaveLength(2);
    expect(await balance(cashId)).toBe(before + 1000 + 25);
    const listed = await read(`/api/v1/ledgers/${ledgerId}/transactions`);
    expect(listed.statusCode).toBe(200);
    expect(
      listed.json().items.find((item: { id: string }) => item.id === bonus?.id),
    ).toMatchObject({ relatedTransferId: row.id });
  });

  it("uses the account's default category, and asks for one when there is none", async () => {
    const none = await create(bonusInput());
    expect(none.statusCode).toBe(409);
    expect(none.json().errors).toEqual([
      expect.objectContaining({ field: "bonus.categoryId" }),
    ]);
    expect(
      await db
        .select()
        .from(transactions)
        .where(eq(transactions.ledgerId, ledgerId)),
    ).toHaveLength(0);
    const set = await patchAccount(cashId, {
      expectedVersion: 1,
      inboundBonusBps: 250,
      bonusCategoryId: incomeCategoryId,
    });
    expect(set.statusCode).toBe(200);
    expect(set.json()).toMatchObject({
      inboundBonusBps: 250,
      bonusCategoryId: incomeCategoryId,
    });
    const row = transferSchema.parse((await create(bonusInput())).json());
    expect(row.bonus?.categoryId).toBe(incomeCategoryId);
  });

  it("never creates the bonus twice when a write is retried", async () => {
    const key = newId();
    const body = bonusInput({ categoryId: incomeCategoryId });
    const first = await create(body, ledgerId, ownerCookie, key);
    const second = await create(body, ledgerId, ownerCookie, key);
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    expect(second.json()).toEqual(first.json());
    expect(await bonusRows(first.json().id)).toHaveLength(1);
  });

  it("rejects an expense category, another ledger's category and a wrong currency without rows", async () => {
    const foreignCategory = newId();
    await db.insert(categories).values({
      id: foreignCategory,
      ledgerId: secondLedger,
      name: "Other",
      kind: "income",
    });
    for (const wrong of [categoryId, foreignCategory]) {
      const response = await create(bonusInput({ categoryId: wrong }));
      expect([404, 409]).toContain(response.statusCode);
    }
    const euro = await create({
      ...input(1000),
      bonus: {
        amount: { amount: 25, currency: "EUR" },
        categoryId: incomeCategoryId,
      },
    });
    expect(euro.statusCode).toBe(409);
    expect(
      await db
        .select()
        .from(transactions)
        .where(eq(transactions.ledgerId, ledgerId)),
    ).toHaveLength(0);
  });

  it("keeps another ledger's categories and accounts out of account bonus settings", async () => {
    const foreignCategory = newId();
    await db.insert(categories).values({
      id: foreignCategory,
      ledgerId: secondLedger,
      name: "Other",
      kind: "income",
    });
    const response = await patchAccount(cashId, {
      expectedVersion: 1,
      bonusCategoryId: foreignCategory,
    });
    expect(response.statusCode).toBe(404);
    const expense = await patchAccount(cashId, {
      expectedVersion: 1,
      bonusCategoryId: categoryId,
    });
    expect(expense.statusCode).toBe(409);
    const crossAccount = await patchAccount(
      foreignAccountId,
      { expectedVersion: 1, inboundBonusBps: 100 },
      ledgerId,
    );
    expect(crossAccount.statusCode).toBe(404);
    const range = await patchAccount(cashId, {
      expectedVersion: 1,
      inboundBonusBps: 10001,
    });
    expect(range.statusCode).toBe(400);
  });

  it("lets only people who can write add a bonus", async () => {
    const response = await create(
      bonusInput({ categoryId: incomeCategoryId }),
      ledgerId,
      viewerCookie,
    );
    expect(response.statusCode).toBe(403);
    expect(
      await db
        .select()
        .from(transactions)
        .where(eq(transactions.ledgerId, ledgerId)),
    ).toHaveLength(0);
  });

  it("leaves the bonus alone when the transfer is edited", async () => {
    const row = transferSchema.parse(
      (await create(bonusInput({ categoryId: incomeCategoryId }))).json(),
    );
    const edited = await edit(row.id, {
      ...input(2000),
      expectedVersion: 1,
    });
    expect(edited.statusCode).toBe(200);
    expect(transferSchema.parse(edited.json()).bonus?.amount.amount).toBe(25);
    expect((await bonusRows(row.id))[0]?.amount).toBe(25);
  });

  it("deletes the bonus with its transfer only when asked, and Undo brings it back", async () => {
    const row = transferSchema.parse(
      (await create(bonusInput({ categoryId: incomeCategoryId }))).json(),
    );
    const before = await balance(cashId);
    const del = await app.inject({
      method: "DELETE",
      url: `${base()}/${row.id}`,
      headers: headers(),
      payload: { expectedVersion: 1, deleteBonus: true },
    });
    expect(del.statusCode).toBe(204);
    expect((await bonusRows(row.id))[0]?.deletedAt).not.toBeNull();
    expect(await balance(cashId)).toBe(before - 1025);
    const back = await restore(row.id, 2);
    expect(back.statusCode).toBe(200);
    expect(transferSchema.parse(back.json()).bonus?.deletedAt).toBeNull();
    expect((await bonusRows(row.id))[0]?.deletedAt).toBeNull();
    expect(await balance(cashId)).toBe(before);
  });

  it("keeps the bonus when the transfer is deleted without asking, and never restores one deleted on its own", async () => {
    const row = transferSchema.parse(
      (await create(bonusInput({ categoryId: incomeCategoryId }))).json(),
    );
    expect((await remove(row.id)).statusCode).toBe(204);
    expect((await bonusRows(row.id))[0]?.deletedAt).toBeNull();
    // Delete the bonus entry itself, then restore the transfer: the bonus stays deleted.
    await db
      .update(transactions)
      .set({ deletedAt: new Date(Date.now() + 1000) })
      .where(eq(transactions.relatedTransferId, row.id));
    expect((await restore(row.id, 2)).statusCode).toBe(200);
    expect((await bonusRows(row.id))[0]?.deletedAt).not.toBeNull();
  });

  it("only allows one bonus per transfer and only on income entries", async () => {
    const row = transferSchema.parse(
      (await create(bonusInput({ categoryId: incomeCategoryId }))).json(),
    );
    await expect(
      db.insert(transactions).values({
        ledgerId,
        kind: "income",
        accountId: cashId,
        categoryId: incomeCategoryId,
        amount: 5,
        baseAmount: 5,
        date: "2026-10-07",
        relatedTransferId: row.id,
      }),
    ).rejects.toThrow();
    await expect(
      db.insert(transactions).values({
        ledgerId,
        kind: "expense",
        accountId: cashId,
        categoryId,
        amount: -5,
        baseAmount: -5,
        date: "2026-10-07",
        relatedTransferId: newId(),
      }),
    ).rejects.toThrow();
  });
});
