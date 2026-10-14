import {
  type Contact,
  newId,
  type Receipt,
  type Receivable,
  type ReceivablePayment,
} from "@ledgerline/shared";
import { and, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../../app";
import { readConfig } from "../../config";
import { createDatabase } from "../../db/client";
import { applyMigrations } from "../../db/migrate";
import {
  accounts,
  categories,
  contacts,
  account as credentials,
  ledgerMembers,
  ledgers,
  receivableEvents,
  receivablePayments,
  receivables,
  session,
  transactions,
  user,
  writeReceipts,
} from "../../db/schema";
import { hashPassword } from "../auth/password";

const url = process.env.TEST_DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith("/ledgerline_test"))
  throw new Error("Tips tests require dedicated ledgerline_test.");
const config = readConfig({
  NODE_ENV: "test",
  DATABASE_URL: url,
  APP_URL: "http://localhost:5173",
  BETTER_AUTH_SECRET: "tips-test-secret-only-0000000-000000000000000000",
  OWNER_EMAIL: "tips@example.com",
  OWNER_PASSWORD: "Tips-test-password-0000000",
  OWNER_NAME: "Test owner",
});
const { db, pool } = createDatabase(url),
  app = await buildApp(db, config);
const ledgerId = newId(),
  other = newId(),
  foreign = newId(),
  ids = [ledgerId, other, foreign],
  users = [newId(), newId(), newId()];
let cookie = "",
  viewer = "",
  accountId = "",
  categoryId = "",
  person: Contact;
const base = (l = ledgerId) => `/api/v1/ledgers/${l}`;
const money = (amount: number) => ({ amount, currency: "USD" });
const headers = (actor = cookie, key = newId()) => ({
  cookie: actor,
  origin: config.APP_URL,
  "idempotency-key": key,
  "content-type": "application/json",
});
const read = (path: string, actor = cookie) =>
  app.inject({ url: base() + path, headers: { cookie: actor } });
const write = (
  path: string,
  body: unknown = {},
  method: "POST" | "PATCH" | "DELETE" = "POST",
  actor = cookie,
  key = newId(),
  ledger = ledgerId,
) =>
  app.inject({
    url: base(ledger) + path,
    method,
    headers: headers(actor, key),
    payload: JSON.stringify(body),
  });
function paymentBody(s: Receivable, amount = 4000) {
  return {
    amount: money(amount),
    accountId,
    categoryId,
    date: "2026-10-07",
    time: "14:32",
    note: "Received",
    expectedReceivableVersion: s.version,
  };
}
async function balance() {
  return (await read(`/accounts/${accountId}`)).json().balance.amount as number;
}
async function clear() {
  await db.transaction(async (tx) => {
    await tx
      .delete(receivableEvents)
      .where(inArray(receivableEvents.ledgerId, ids));
    await tx.delete(transactions).where(inArray(transactions.ledgerId, ids));
    await tx
      .delete(receivablePayments)
      .where(inArray(receivablePayments.ledgerId, ids));
    await tx.delete(receivables).where(inArray(receivables.ledgerId, ids));
    await tx.delete(contacts).where(inArray(contacts.ledgerId, ids));
  });
  await db.delete(categories).where(inArray(categories.ledgerId, ids));
  await db.delete(accounts).where(inArray(accounts.ledgerId, ids));
  await db.delete(writeReceipts).where(inArray(writeReceipts.ledgerId, ids));
}
beforeAll(async () => {
  await applyMigrations(url);
  await db
    .insert(ledgers)
    .values(ids.map((id) => ({ id, name: "Synthetic tips suite" })));
  const password = await hashPassword(config.OWNER_PASSWORD);
  for (const [i, role] of (["owner", "editor", "viewer"] as const).entries()) {
    const id = users[i] as string,
      email = `tip-${role}-${id}@example.com`;
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
    .values({ userId: users[0] as string, ledgerId: other, role: "owner" });
  await app.ready();
  const cookies = [];
  for (const [i, role] of ["owner", "editor", "viewer"].entries()) {
    const r = await app.inject({
      method: "POST",
      url: "/api/v1/auth/sign-in/email",
      headers: { origin: config.APP_URL },
      payload: {
        email: `tip-${role}-${users[i]}@example.com`,
        password: config.OWNER_PASSWORD,
      },
    });
    expect(r.statusCode).toBe(200);
    const c = r.headers["set-cookie"];
    cookies.push(
      (Array.isArray(c) ? c : [c ?? ""]).map((v) => v.split(";")[0]).join("; "),
    );
  }
  [cookie, , viewer] = cookies as [string, string, string];
});
beforeEach(async () => {
  await clear();
  await db
    .update(ledgerMembers)
    .set({ role: "owner", deletedAt: null })
    .where(
      and(
        eq(ledgerMembers.ledgerId, ledgerId),
        eq(ledgerMembers.userId, users[0] as string),
      ),
    );
  accountId = newId();
  categoryId = newId();
  await db.insert(accounts).values({
    id: accountId,
    ledgerId,
    name: "Receiving",
    type: "bank",
    openingBalance: 1000,
  });
  await db
    .insert(categories)
    .values({ id: categoryId, ledgerId, name: "Services", kind: "income" });
  const r = await write("/contacts", {
    name: "Sam",
    phone: "+1 555 0100",
    email: "sam@example.com",
    note: "Synthetic",
  });
  expect(r.statusCode).toBe(201);
  person = r.json();
});
afterAll(async () => {
  await app.close();
  await clear();
  await db.delete(ledgerMembers).where(inArray(ledgerMembers.ledgerId, ids));
  await db.delete(ledgers).where(inArray(ledgers.id, ids));
  await db.delete(session).where(inArray(session.userId, users));
  await db.delete(credentials).where(inArray(credentials.userId, users));
  await db.delete(user).where(inArray(user.id, users));
  await pool.end();
});
async function svc(date: string, amount: number, who = person) {
  const r = await write("/receivables", {
    contactId: who.id,
    description: `Work ${date}`,
    serviceDate: date,
    dueDate: null,
    amount: money(amount),
  });
  expect(r.statusCode, r.body).toBe(201);
  return r.json() as Receivable;
}
async function tipCategory(
  name = "Tips",
  kind: "income" | "expense" = "income",
) {
  const id = newId();
  await db.insert(categories).values({ id, ledgerId, name, kind });
  return id;
}
const tipBody = (amount: number, id: string) => ({
  amount: money(amount),
  categoryId: id,
});
const allIncome = () =>
  db.select().from(transactions).where(eq(transactions.ledgerId, ledgerId));
const tipRows = async () =>
  (await allIncome()).filter((row) => row.tipPaymentId !== null);
const paymentAction = (p: ReceivablePayment, bump = 0) => ({
  expectedVersion: p.version + bump,
  expectedReceivableVersion: p.receivable.version + bump,
});
async function payWithTip(
  s: Receivable,
  amount: number,
  tip: unknown,
  key = newId(),
) {
  return write(
    `/receivables/${s.id}/payments`,
    { ...paymentBody(s, amount), tip },
    "POST",
    cookie,
    key,
  );
}

describe("Tips on payments (ADR 0027)", () => {
  it("saves the extra as its own income entry linked to the payment", async () => {
    const tips = await tipCategory();
    const s = await svc("2026-10-01", 10000);
    const r = await payWithTip(s, 10000, tipBody(2000, tips));
    expect(r.statusCode, r.body).toBe(201);
    const payment = r.json() as ReceivablePayment;
    expect(payment.tip).toMatchObject({
      amount: money(2000),
      categoryId: tips,
      deletedAt: null,
    });
    expect(payment.receivable.status).toBe("paid");
    const rows = await allIncome();
    expect(rows).toHaveLength(2);
    const tip = rows.find((row) => row.tipPaymentId === payment.id);
    expect(tip).toMatchObject({
      kind: "income",
      amount: 2000,
      currency: "USD",
      baseAmount: 2000,
      categoryId: tips,
      accountId,
      date: "2026-10-07",
      time: "14:32",
      payee: "Sam",
      status: "cleared",
      receivablePaymentId: null,
    });
    // The payment settles exactly what was owed; the tip is extra money in the account.
    expect(await balance()).toBe(1000 + 10000 + 2000);
    expect((await people()).openBalances).toEqual([]);
  });

  it("never lets a payment itself exceed what is owed", async () => {
    const tips = await tipCategory();
    const s = await svc("2026-10-01", 10000);
    const r = await payWithTip(s, 10001, tipBody(500, tips));
    expect(r.statusCode).toBe(409);
    expect(await allIncome()).toHaveLength(0);
  });

  it("is atomic: a bad tip leaves no payment behind", async () => {
    const s = await svc("2026-10-01", 10000);
    const expense = await tipCategory("Costs", "expense");
    const archived = await tipCategory("Old tips");
    await db
      .update(categories)
      .set({ archivedAt: new Date() })
      .where(eq(categories.id, archived));
    for (const bad of [
      tipBody(500, expense),
      tipBody(500, archived),
      tipBody(500, newId()),
      { amount: { amount: 500, currency: "EUR" }, categoryId: categoryId },
    ]) {
      const r = await payWithTip(s, 10000, bad);
      expect(r.statusCode, JSON.stringify(bad)).toBeGreaterThanOrEqual(400);
      expect(await allIncome()).toHaveLength(0);
    }
    expect(
      (await payWithTip(s, 10000, tipBody(0, categoryId))).statusCode,
    ).toBe(400);
    const wrongCurrency = await payWithTip(s, 10000, {
      amount: { amount: 500, currency: "EUR" },
      categoryId,
    });
    expect(wrongCurrency.json().errors?.[0]?.field ?? "").toContain("tip");
  });

  it("replays the same request once and refuses a changed one under the same key", async () => {
    const tips = await tipCategory();
    const s = await svc("2026-10-01", 10000);
    const key = newId();
    const first = await payWithTip(s, 10000, tipBody(2000, tips), key);
    const again = await payWithTip(s, 10000, tipBody(2000, tips), key);
    expect(first.statusCode).toBe(201);
    expect(again.statusCode).toBe(201);
    expect(again.json().id).toBe(first.json().id);
    expect(await tipRows()).toHaveLength(1);
    const changed = await payWithTip(s, 10000, tipBody(2500, tips), key);
    expect(changed.statusCode).toBe(409);
    expect(await tipRows()).toHaveLength(1);
    expect(await balance()).toBe(1000 + 12000);
  });

  it("deletes the tip with its payment and restores only that tip", async () => {
    const tips = await tipCategory();
    const s = await svc("2026-10-01", 10000);
    const payment = (
      await payWithTip(s, 10000, tipBody(2000, tips))
    ).json() as ReceivablePayment;
    const path = `/receivables/${s.id}/payments/${payment.id}`;
    const gone = await write(path, paymentAction(payment), "DELETE");
    expect(gone.statusCode, gone.body).toBe(204);
    expect(await balance()).toBe(1000);
    expect((await tipRows())[0]?.deletedAt).not.toBeNull();
    const back = await write(`${path}/restore`, paymentAction(payment, 1));
    expect(back.statusCode, back.body).toBe(200);
    expect(back.json().tip).toMatchObject({ deletedAt: null });
    expect(await balance()).toBe(1000 + 12000);
    expect((await tipRows())[0]?.deletedAt).toBeNull();
  });

  it("does not bring back a tip that was deleted on its own", async () => {
    const tips = await tipCategory();
    const s = await svc("2026-10-01", 10000);
    const payment = (
      await payWithTip(s, 10000, tipBody(2000, tips))
    ).json() as ReceivablePayment;
    const tip = (await tipRows())[0];
    const lone = await write(
      `/transactions/${tip?.id}`,
      { expectedVersion: tip?.version },
      "DELETE",
    );
    expect(lone.statusCode, lone.body).toBe(204);
    expect(await balance()).toBe(1000 + 10000);
    const path = `/receivables/${s.id}/payments/${payment.id}`;
    expect(
      (await write(path, paymentAction(payment), "DELETE")).statusCode,
    ).toBe(204);
    expect(
      (await write(`${path}/restore`, paymentAction(payment, 1))).statusCode,
    ).toBe(200);
    expect((await tipRows())[0]?.deletedAt).not.toBeNull();
    expect(await balance()).toBe(1000 + 10000);
  });

  it("leaves the tip alone when the payment is edited, and keeps it an unsplit income entry", async () => {
    const tips = await tipCategory();
    const s = await svc("2026-10-01", 10000);
    const payment = (
      await payWithTip(s, 6000, tipBody(2000, tips))
    ).json() as ReceivablePayment;
    const edit = await write(
      `/receivables/${s.id}/payments/${payment.id}`,
      {
        amount: money(7000),
        accountId,
        categoryId,
        date: "2026-10-07",
        time: "14:32",
        note: "Received",
        ...paymentAction(payment),
      },
      "PATCH",
    );
    expect(edit.statusCode, edit.body).toBe(200);
    expect((await tipRows())[0]).toMatchObject({
      amount: 2000,
      deletedAt: null,
    });
    const tip = (await tipRows())[0];
    const asExpense = await write(
      `/transactions/${tip?.id}`,
      {
        accountId,
        categoryId: await tipCategory("Costs", "expense"),
        kind: "expense",
        date: "2026-10-07",
        amount: money(-2000),
        status: "cleared",
        expectedVersion: tip?.version,
      },
      "PATCH",
    );
    expect(asExpense.statusCode).toBe(409);
    const note = await write(
      `/transactions/${tip?.id}`,
      {
        accountId,
        categoryId: tips,
        kind: "income",
        date: "2026-10-07",
        amount: money(2500),
        status: "cleared",
        expectedVersion: tip?.version,
      },
      "PATCH",
    );
    expect(note.statusCode, note.body).toBe(200);
    expect((await tipRows())[0]?.amount).toBe(2500);
  });

  it("saves one tip for a whole receipt and moves it with the receipt", async () => {
    const tips = await tipCategory();
    await svc("2026-09-01", 20000);
    await svc("2026-09-15", 20000);
    const preview = (
      await app.inject({
        url: `${base()}/contacts/${person.id}/receipt-preview?amount=30000`,
        headers: { cookie },
      })
    ).json();
    const body = {
      amount: money(30000),
      accountId,
      categoryId,
      date: "2026-10-08",
      time: null,
      note: null,
      tip: tipBody(5000, tips),
      expectedAllocations: preview.allocations.map(
        (a: {
          receivableId: string;
          version: number;
          applied: { amount: number };
        }) => ({
          receivableId: a.receivableId,
          expectedVersion: a.version,
          applied: a.applied.amount,
        }),
      ),
    };
    const made = await write(`/contacts/${person.id}/receipts`, body);
    expect(made.statusCode, made.body).toBe(201);
    const receipt = made.json() as Receipt;
    expect(receipt.payments).toHaveLength(2);
    expect(receipt.payments.filter((p) => p.tip !== null)).toHaveLength(1);
    expect(await tipRows()).toHaveLength(1);
    expect(await balance()).toBe(1000 + 30000 + 5000);
    const expected = receipt.payments.map((p) => ({
      paymentId: p.id,
      expectedVersion: p.version,
      expectedReceivableVersion: p.receivable.version,
    }));
    const removed = await write(
      `/receipts/${receipt.id}`,
      { expectedPayments: expected },
      "DELETE",
    );
    expect(removed.statusCode, removed.body).toBe(204);
    expect(await balance()).toBe(1000);
    const restored = await write(`/receipts/${receipt.id}/restore`, {
      expectedPayments: expected.map((e) => ({
        ...e,
        expectedVersion: e.expectedVersion + 1,
        expectedReceivableVersion: e.expectedReceivableVersion + 1,
      })),
    });
    expect(restored.statusCode, restored.body).toBe(200);
    expect(await balance()).toBe(1000 + 30000 + 5000);
    expect((await tipRows())[0]?.deletedAt).toBeNull();
  });

  it("stays inside its own ledger and role", async () => {
    const tips = await tipCategory();
    const s = await svc("2026-10-01", 10000);
    // Another ledger cannot see this service, so nothing is written there.
    const crossLedger = await write(
      `/receivables/${s.id}/payments`,
      { ...paymentBody(s), tip: tipBody(100, tips) },
      "POST",
      cookie,
      newId(),
      other,
    );
    expect(crossLedger.statusCode).toBe(404);
    // A tip category from another ledger is refused and nothing is saved.
    const foreignCategory = newId();
    await db.insert(categories).values({
      id: foreignCategory,
      ledgerId: other,
      name: "Tips",
      kind: "income",
    });
    const wrongBook = await payWithTip(s, 10000, tipBody(100, foreignCategory));
    expect(wrongBook.statusCode).toBeGreaterThanOrEqual(400);
    expect(await allIncome()).toHaveLength(0);
    // A viewer cannot record payments or tips.
    const viewing = await app.inject({
      url: `${base()}/receivables/${s.id}/payments`,
      method: "POST",
      headers: headers(viewer),
      payload: JSON.stringify({ ...paymentBody(s), tip: tipBody(100, tips) }),
    });
    expect(viewing.statusCode).toBe(403);
    expect(await allIncome()).toHaveLength(0);
  });

  it("is enforced by the database: a tip needs a real payment and a plain income entry", async () => {
    const tips = await tipCategory();
    const s = await svc("2026-10-01", 10000);
    const payment = (
      await payWithTip(s, 10000, tipBody(100, tips))
    ).json() as ReceivablePayment;
    const base = {
      ledgerId,
      accountId,
      categoryId: tips,
      amount: 100,
      currency: "USD",
      baseAmount: 100,
      date: "2026-10-07",
      status: "cleared" as const,
    };
    await expect(
      db.insert(transactions).values({
        ...base,
        kind: "income",
        tipPaymentId: newId(),
      }),
    ).rejects.toThrow();
    await expect(
      db.insert(transactions).values({
        ...base,
        kind: "income",
        tipPaymentId: payment.id,
      }),
    ).rejects.toThrow(); // one tip per payment
    await expect(
      db.insert(transactions).values({
        ...base,
        kind: "expense",
        amount: -100,
        baseAmount: -100,
        tipPaymentId: payment.id,
      }),
    ).rejects.toThrow();
  });
});
const people = async () =>
  ((await read("/contacts")).json().items as Contact[]).find(
    (c) => c.id === person.id,
  ) as Contact;
