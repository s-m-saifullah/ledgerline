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
  exchangeRates,
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
const config = testConfig(url, "fee");
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
      name: "Synthetic fee test ledger",
    })),
  );

  for (const [index, role] of (
    ["owner", "editor", "viewer"] as const
  ).entries()) {
    const id = fixtureUsers[index];
    if (!id) throw new Error("Missing fixture ID");
    const email = `fee-${role}-${id}@example.com`;
    await seedUser(db, config, { id, email, name: role, ledgerId, role });
  }
  await db
    .insert(ledgerMembers)
    .values({ userId: ownerId, ledgerId: secondLedger, role: "owner" });
  await app.ready();
  ownerCookie = await signIn(`fee-owner-${ownerId}@example.com`);
  viewerCookie = await signIn(`fee-viewer-${fixtureUsers[2]}@example.com`);
});
const fixtureScope = inArray(transactions.ledgerId, fixtureLedgers);
beforeEach(async () => {
  // Clear only this suite's synthetic rows, retaining every unrelated ledger.
  await db.delete(transactions).where(fixtureScope);
  await db
    .delete(exchangeRates)
    .where(inArray(exchangeRates.ledgerId, fixtureLedgers));
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
  await db
    .delete(exchangeRates)
    .where(inArray(exchangeRates.ledgerId, fixtureLedgers));
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

const feeInput = (fee: object = {}, amount = 10000) => ({
  ...input(amount),
  fee: { amount: { amount: 200, currency: "USD" as const }, ...fee },
});
const feeRows = (id: string) =>
  db
    .select()
    .from(transactions)
    .where(
      and(
        eq(transactions.ledgerId, ledgerId),
        eq(transactions.feeTransferId, id),
      ),
    );
const patchAccount = (id: string, payload: unknown, ledger = ledgerId) =>
  app.inject({
    method: "PATCH",
    url: `/api/v1/ledgers/${ledger}/accounts/${id}`,
    headers: headers(),
    payload: JSON.stringify(payload),
  });
const countRows = async () =>
  (
    await db
      .select()
      .from(transactions)
      .where(eq(transactions.ledgerId, ledgerId))
  ).length;

describe("Transfer fee API", () => {
  it("debits the amount plus a fixed fee from the sender and leaves the received amount alone", async () => {
    const [before, cashBefore] = [await balance(), await balance(cashId)];
    const response = await create(feeInput({ categoryId }));
    expect(response.statusCode).toBe(201);
    const row = transferSchema.parse(response.json());
    const [fee] = await feeRows(row.id);
    expect(fee).toMatchObject({
      kind: "expense",
      accountId,
      categoryId,
      amount: -200,
      currency: "USD",
      baseAmount: -200,
      date: "2026-10-07",
      time: "09:05",
      transferId: null,
      relatedTransferId: null,
      feeTransferId: row.id,
    });
    expect(row.fee).toEqual({
      transactionId: fee?.id,
      amount: { amount: 200, currency: "USD" },
      categoryId,
      deletedAt: null,
    });
    expect(row.receivedAmount.amount).toBe(10000);
    expect(await balance()).toBe(before - 10200);
    expect(await balance(cashId)).toBe(cashBefore + 10000);
    const listed = await read(`/api/v1/ledgers/${ledgerId}/transactions`);
    expect(
      listed.json().items.find((item: { id: string }) => item.id === fee?.id),
    ).toMatchObject({ feeTransferId: row.id, kind: "expense" });
  });

  it("works a percentage out of the amount sent, rounding half away from zero", async () => {
    // 1.5% of 100.00 is 1.50.
    const first = transferSchema.parse(
      (
        await create(
          { ...input(10000), fee: { basisPoints: 150, categoryId } },
          ledgerId,
        )
      ).json(),
    );
    expect(first.fee?.amount.amount).toBe(150);
    // 1.5% of 3.33 is 4.995 cents, which rounds up to 5.
    const second = transferSchema.parse(
      (
        await create({
          ...input(333),
          fee: { basisPoints: 150, categoryId },
        })
      ).json(),
    );
    expect(second.fee?.amount.amount).toBe(5);
    // 100% is allowed, and the sender still ends with a valid balance.
    const full = transferSchema.parse(
      (
        await create({ ...input(100), fee: { basisPoints: 10000, categoryId } })
      ).json(),
    );
    expect(full.fee?.amount.amount).toBe(100);
  });

  it("refuses a fee that comes to less than one cent and out-of-range percentages, with no rows", async () => {
    const tiny = await create({
      ...input(10),
      fee: { basisPoints: 1, categoryId },
    });
    expect(tiny.statusCode).toBe(409);
    expect(tiny.json().errors).toEqual([
      expect.objectContaining({ field: "fee" }),
    ]);
    for (const fee of [
      { basisPoints: 10001, categoryId },
      { basisPoints: 0, categoryId },
      { basisPoints: 1.5, categoryId },
      { amount: { amount: 0, currency: "USD" }, categoryId },
      { amount: { amount: -5, currency: "USD" }, categoryId },
      {
        amount: { amount: 5, currency: "USD" },
        basisPoints: 100,
        categoryId,
      },
    ])
      expect((await create({ ...input(1000), fee })).statusCode).toBe(400);
    expect(await countRows()).toBe(0);
  });

  it("uses the sending account's default category, and asks for one when there is none", async () => {
    const none = await create(feeInput());
    expect(none.statusCode).toBe(409);
    expect(none.json().errors).toEqual([
      expect.objectContaining({ field: "fee.categoryId" }),
    ]);
    expect(await countRows()).toBe(0);
    const set = await patchAccount(accountId, {
      expectedVersion: 1,
      feeCategoryId: categoryId,
      defaultFee: { basisPoints: 150 },
    });
    expect(set.statusCode).toBe(200);
    expect(set.json()).toMatchObject({
      feeCategoryId: categoryId,
      defaultFee: { basisPoints: 150 },
    });
    const row = transferSchema.parse((await create(feeInput())).json());
    expect(row.fee?.categoryId).toBe(categoryId);
  });

  it("never creates the fee twice when a write is retried", async () => {
    const key = newId();
    const body = feeInput({ categoryId });
    const first = await create(body, ledgerId, ownerCookie, key);
    const second = await create(body, ledgerId, ownerCookie, key);
    expect(first.statusCode).toBe(201);
    expect(second.json()).toEqual(first.json());
    expect(await feeRows(first.json().id)).toHaveLength(1);
  });

  it("rejects an income category, another ledger's category and a wrong currency without rows", async () => {
    const foreignCategory = newId();
    await db.insert(categories).values({
      id: foreignCategory,
      ledgerId: secondLedger,
      name: "Other",
      kind: "expense",
    });
    for (const wrong of [incomeCategoryId, foreignCategory]) {
      const response = await create(feeInput({ categoryId: wrong }));
      expect([404, 409]).toContain(response.statusCode);
    }
    const euro = await create({
      ...input(1000),
      fee: { amount: { amount: 20, currency: "EUR" }, categoryId },
    });
    expect(euro.statusCode).toBe(409);
    expect(await countRows()).toBe(0);
  });

  it("fails whole when the amounts leave the exact money range", async () => {
    // A huge fixed fee on a huge transfer must fail whole, never leave a transfer without its fee.
    const response = await create({
      ...input(Number.MAX_SAFE_INTEGER - 5),
      fee: { amount: { amount: 20, currency: "USD" }, categoryId },
    });
    expect(response.statusCode).toBeGreaterThanOrEqual(400);
    expect(await countRows()).toBe(0);
  });

  it("lets only people who can write add a fee", async () => {
    const response = await create(
      feeInput({ categoryId }),
      ledgerId,
      viewerCookie,
    );
    expect(response.statusCode).toBe(403);
    expect(await countRows()).toBe(0);
  });

  it("keeps another ledger's data out: no fee on another ledger's transfer, no foreign account settings", async () => {
    const row = transferSchema.parse(
      (await create(feeInput({ categoryId }))).json(),
    );
    // The other ledger cannot read, edit or delete this transfer, so it cannot reach its fee.
    for (const response of [
      await read(`${base(secondLedger)}/${row.id}`),
      await edit(row.id, { ...input(), expectedVersion: 1 }, secondLedger),
      await remove(row.id, 1, secondLedger),
    ])
      expect(response.statusCode).toBe(404);
    expect((await feeRows(row.id))[0]?.deletedAt).toBeNull();
    const foreignCategory = newId();
    await db.insert(categories).values({
      id: foreignCategory,
      ledgerId: secondLedger,
      name: "Other",
      kind: "expense",
    });
    expect(
      (
        await patchAccount(accountId, {
          expectedVersion: 1,
          feeCategoryId: foreignCategory,
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await patchAccount(foreignAccountId, {
          expectedVersion: 1,
          defaultFee: { basisPoints: 100 },
        })
      ).statusCode,
    ).toBe(404);
    // A transfer into another ledger's account never carries a fee there.
    const cross = await create({
      ...feeInput({ categoryId }),
      toAccountId: foreignAccountId,
    });
    expect([404, 409]).toContain(cross.statusCode);
  });

  it("validates account fee settings", async () => {
    const income = await patchAccount(accountId, {
      expectedVersion: 1,
      feeCategoryId: incomeCategoryId,
    });
    expect(income.statusCode).toBe(409);
    const euro = await patchAccount(accountId, {
      expectedVersion: 1,
      defaultFee: { amount: { amount: 100, currency: "EUR" } },
    });
    expect(euro.statusCode).toBe(409);
    for (const defaultFee of [
      { basisPoints: 10001 },
      { amount: { amount: 0, currency: "USD" } },
      { basisPoints: 100, amount: { amount: 5, currency: "USD" } },
    ])
      expect(
        (await patchAccount(accountId, { expectedVersion: 1, defaultFee }))
          .statusCode,
      ).toBe(400);
    const fixed = await patchAccount(accountId, {
      expectedVersion: 1,
      defaultFee: { amount: { amount: 150, currency: "USD" } },
    });
    expect(fixed.json().defaultFee).toEqual({
      amount: { amount: 150, currency: "USD" },
    });
    const cleared = await patchAccount(accountId, {
      expectedVersion: 2,
      defaultFee: null,
      feeCategoryId: null,
    });
    expect(cleared.json()).toMatchObject({
      defaultFee: null,
      feeCategoryId: null,
    });
  });

  it("leaves the fee alone when the transfer is edited", async () => {
    const row = transferSchema.parse(
      (await create(feeInput({ categoryId }))).json(),
    );
    const edited = await edit(row.id, { ...input(20000), expectedVersion: 1 });
    expect(edited.statusCode).toBe(200);
    expect(transferSchema.parse(edited.json()).fee?.amount.amount).toBe(200);
    expect((await feeRows(row.id))[0]?.amount).toBe(-200);
  });

  it("deletes the fee with its transfer only when asked, and Undo brings it back", async () => {
    const row = transferSchema.parse(
      (await create(feeInput({ categoryId }))).json(),
    );
    const before = await balance();
    const del = await app.inject({
      method: "DELETE",
      url: `${base()}/${row.id}`,
      headers: headers(),
      payload: { expectedVersion: 1, deleteFee: true },
    });
    expect(del.statusCode).toBe(204);
    expect((await feeRows(row.id))[0]?.deletedAt).not.toBeNull();
    expect(await balance()).toBe(before + 10200);
    const back = await restore(row.id, 2);
    expect(back.statusCode).toBe(200);
    expect(transferSchema.parse(back.json()).fee?.deletedAt).toBeNull();
    expect(await balance()).toBe(before);
  });

  it("keeps the fee when the transfer is deleted without asking, and never restores one deleted on its own", async () => {
    const row = transferSchema.parse(
      (await create(feeInput({ categoryId }))).json(),
    );
    expect((await remove(row.id)).statusCode).toBe(204);
    expect((await feeRows(row.id))[0]?.deletedAt).toBeNull();
    await db
      .update(transactions)
      .set({ deletedAt: new Date(Date.now() + 1000) })
      .where(eq(transactions.feeTransferId, row.id));
    expect((await restore(row.id, 2)).statusCode).toBe(200);
    expect((await feeRows(row.id))[0]?.deletedAt).not.toBeNull();
  });

  it("lets a transfer carry both a fee and a bonus, each deleted and restored on its own terms", async () => {
    const body = {
      ...feeInput({ categoryId }),
      bonus: {
        amount: { amount: 25, currency: "USD" as const },
        categoryId: incomeCategoryId,
      },
    };
    const [sender, receiver] = [await balance(), await balance(cashId)];
    const row = transferSchema.parse((await create(body)).json());
    expect(row.fee?.amount.amount).toBe(200);
    expect(row.bonus?.amount.amount).toBe(25);
    expect(await balance()).toBe(sender - 10200);
    expect(await balance(cashId)).toBe(receiver + 10025);
    const del = await app.inject({
      method: "DELETE",
      url: `${base()}/${row.id}`,
      headers: headers(),
      payload: { expectedVersion: 1, deleteFee: true },
    });
    expect(del.statusCode).toBe(204);
    expect((await feeRows(row.id))[0]?.deletedAt).not.toBeNull();
    const [bonus] = await db
      .select()
      .from(transactions)
      .where(eq(transactions.relatedTransferId, row.id));
    expect(bonus?.deletedAt).toBeNull();
  });

  it("prices the fee in the sending currency at its own rate when the accounts differ", async () => {
    const euro = newId();
    await db.insert(accounts).values({
      id: euro,
      ledgerId,
      name: "Euros",
      type: "bank",
      currency: "EUR",
      openingBalance: 100000,
    });
    await db.insert(exchangeRates).values({
      ledgerId,
      code: "EUR",
      date: "2026-10-02",
      rate: "1.1217",
      source: "manual",
    });
    const response = await create({
      fromAccountId: euro,
      toAccountId: cashId,
      date: "2026-10-07",
      time: null,
      note: null,
      amount: { amount: 10000, currency: "EUR" },
      receivedAmount: { amount: 11200, currency: "USD" },
      fee: { amount: { amount: 300, currency: "EUR" }, categoryId },
    });
    expect(response.statusCode, response.body).toBe(201);
    const row = transferSchema.parse(response.json());
    const [fee] = await feeRows(row.id);
    // 3.00 EUR at 1.1217 is 3.3651, so 3.37 USD, frozen on the fee only.
    expect(fee).toMatchObject({
      amount: -300,
      currency: "EUR",
      baseAmount: -337,
    });
    expect(row.receivedAmount).toEqual({ amount: 11200, currency: "USD" });
    const stored = await legs(row.id);
    expect(stored.reduce((sum, leg) => sum + leg.baseAmount, 0)).toBe(0);
    // A fee in the receiving currency is refused: it is charged to the sender.
    const wrong = await create({
      fromAccountId: euro,
      toAccountId: cashId,
      date: "2026-10-07",
      time: null,
      note: null,
      amount: { amount: 10000, currency: "EUR" },
      receivedAmount: { amount: 11200, currency: "USD" },
      fee: { amount: { amount: 300, currency: "USD" }, categoryId },
    });
    expect(wrong.statusCode).toBe(409);
    // No rate means the save is blocked and nothing is left behind.
    await db.delete(exchangeRates).where(eq(exchangeRates.ledgerId, ledgerId));
    const before = await countRows();
    const blocked = await create({
      fromAccountId: euro,
      toAccountId: cashId,
      date: "2026-10-07",
      time: null,
      note: null,
      amount: { amount: 10000, currency: "EUR" },
      receivedAmount: { amount: 11200, currency: "USD" },
      fee: { amount: { amount: 300, currency: "EUR" }, categoryId },
    });
    expect(blocked.statusCode).toBe(409);
    expect(await countRows()).toBe(before);
  });

  it("only allows one fee per transfer and only on plain expense entries", async () => {
    const row = transferSchema.parse(
      (await create(feeInput({ categoryId }))).json(),
    );
    const entry = (extra: object) => ({
      ledgerId,
      kind: "expense" as const,
      accountId,
      categoryId,
      amount: -5,
      baseAmount: -5,
      date: "2026-10-07",
      ...extra,
    });
    await expect(
      db.insert(transactions).values(entry({ feeTransferId: row.id })),
    ).rejects.toThrow();
    await expect(
      db.insert(transactions).values({
        ...entry({ feeTransferId: newId() }),
        kind: "income",
        categoryId: incomeCategoryId,
        amount: 5,
        baseAmount: 5,
      }),
    ).rejects.toThrow();
    await expect(
      db
        .insert(transactions)
        .values(entry({ feeTransferId: newId(), relatedTransferId: newId() })),
    ).rejects.toThrow();
  });

  it("lets the fee be edited as an ordinary expense but not turned into income or split", async () => {
    const row = transferSchema.parse(
      (await create(feeInput({ categoryId }))).json(),
    );
    const id = row.fee?.transactionId ?? "";
    const patch = (payload: object) =>
      app.inject({
        method: "PATCH",
        url: `/api/v1/ledgers/${ledgerId}/transactions/${id}`,
        headers: headers(),
        payload: JSON.stringify(payload),
      });
    const edited = await patch({
      expectedVersion: 1,
      amount: { amount: -250, currency: "USD" },
    });
    expect(edited.statusCode, edited.body).toBe(200);
    expect(edited.json()).toMatchObject({ feeTransferId: row.id });
    const kind = await patch({
      expectedVersion: 2,
      kind: "income",
      categoryId: incomeCategoryId,
      amount: { amount: 250, currency: "USD" },
    });
    expect(kind.statusCode).toBe(409);
    const split = await patch({
      expectedVersion: 2,
      splits: [
        {
          categoryId,
          amount: { amount: -100, currency: "USD" },
          note: null,
        },
        {
          categoryId,
          amount: { amount: -150, currency: "USD" },
          note: null,
        },
      ],
    });
    expect(split.statusCode).toBe(409);
  });
});
