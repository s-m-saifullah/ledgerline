import {
  type Contact,
  type Money,
  newId,
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
  currencies,
  exchangeRates,
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
  throw new Error("Owed currency tests require dedicated ledgerline_test.");
const config = readConfig({
  NODE_ENV: "test",
  DATABASE_URL: url,
  APP_URL: "http://localhost:5173",
  BETTER_AUTH_SECRET: "owedfx-test-secret-only-0000000000000000",
  OWNER_EMAIL: "owedfx@example.com",
  OWNER_PASSWORD: "Receivables-test-password-000",
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
  accountId = "",
  categoryId = "",
  client: Contact;
const base = (l = ledgerId) => `/api/v1/ledgers/${l}`;
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
const path = (p: ReceivablePayment) =>
  `/receivables/${p.receivableId}/payments/${p.id}`;
const versions = (p: ReceivablePayment) => ({
  expectedVersion: p.version,
  expectedReceivableVersion: p.receivable.version,
});
async function clear() {
  await db.transaction(async (tx) => {
    await tx
      .delete(receivableEvents)
      .where(inArray(receivableEvents.ledgerId, ids));
    await tx
      .delete(receivablePayments)
      .where(inArray(receivablePayments.ledgerId, ids));
    await tx.delete(transactions).where(inArray(transactions.ledgerId, ids));
    await tx.delete(receivables).where(inArray(receivables.ledgerId, ids));
    await tx.delete(contacts).where(inArray(contacts.ledgerId, ids));
    await tx.delete(exchangeRates).where(inArray(exchangeRates.ledgerId, ids));
    await tx.delete(currencies).where(inArray(currencies.ledgerId, ids));
  });
  await db.delete(categories).where(inArray(categories.ledgerId, ids));
  await db.delete(accounts).where(inArray(accounts.ledgerId, ids));
  await db.delete(writeReceipts).where(inArray(writeReceipts.ledgerId, ids));
}
beforeAll(async () => {
  await applyMigrations(url);
  await db
    .insert(ledgers)
    .values(ids.map((id) => ({ id, name: "Synthetic owed currency suite" })));
  const password = await hashPassword(config.OWNER_PASSWORD);
  for (const [i, role] of (["owner", "editor", "viewer"] as const).entries()) {
    const id = users[i] as string,
      email = `owedfx-${role}-${id}@example.com`;
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
        email: `owedfx-${role}-${users[i]}@example.com`,
        password: config.OWNER_PASSWORD,
      },
    });
    expect(r.statusCode).toBe(200);
    const c = r.headers["set-cookie"];
    cookies.push(
      (Array.isArray(c) ? c : [c ?? ""]).map((v) => v.split(";")[0]).join("; "),
    );
  }
  [cookie] = cookies as [string];
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
  client = r.json();
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

async function addCurrency(code: string, rate?: string, ledger = ledgerId) {
  await db.insert(currencies).values({ id: newId(), ledgerId: ledger, code });
  if (rate)
    await db.insert(exchangeRates).values({
      id: newId(),
      ledgerId: ledger,
      code,
      date: "2026-01-01",
      rate,
      source: "manual",
    });
}
async function account(code: string, name = `${code} account`) {
  const id = newId();
  await db.insert(accounts).values({
    id,
    ledgerId: ledgerId,
    name,
    type: "bank",
    currency: code,
    openingBalance: 0,
  });
  return id;
}
const item = async (amount: number, currency: string) => {
  const r = await write("/receivables", {
    contactId: client.id,
    description: `Work in ${currency}`,
    serviceDate: "2026-10-07",
    dueDate: null,
    amount: { amount, currency },
  });
  expect(r.statusCode, r.body).toBe(201);
  return r.json() as Receivable;
};
const payBody = (s: Receivable, extra: object, account: string) => ({
  amount: { amount: 100000, currency: s.amount.currency },
  accountId: account,
  categoryId,
  date: "2026-10-07",
  time: null,
  note: null,
  expectedReceivableVersion: s.version,
  ...extra,
});
const entryOf = async (paymentId: string) =>
  (
    await db
      .select()
      .from(transactions)
      .where(eq(transactions.receivablePaymentId, paymentId))
  )[0];

describe("Money owed in other currencies", () => {
  it("creates an item in an added currency and refuses one the ledger has not added", async () => {
    await addCurrency("EUR", "0.8");
    const s = await item(125000, "EUR");
    expect(s.amount).toEqual({ amount: 125000, currency: "EUR" });
    expect(s.remaining).toEqual({ amount: 125000, currency: "EUR" });
    const refused = await write("/receivables", {
      contactId: client.id,
      description: "Work",
      serviceDate: "2026-10-07",
      dueDate: null,
      amount: { amount: 100, currency: "JPY" },
    });
    expect(refused.statusCode).toBe(409);
    expect(refused.json().errors[0].field).toBe("amount.currency");
    // A currency added in another ledger does not make it usable here.
    await addCurrency("CHF", "1.1", other);
    expect(
      (
        await write("/receivables", {
          contactId: client.id,
          description: "Work",
          serviceDate: "2026-10-07",
          dueDate: null,
          amount: { amount: 100, currency: "CHF" },
        })
      ).statusCode,
    ).toBe(409);
  });

  it("settles an item in its own currency into a same-currency account, priced at the stored rate", async () => {
    await addCurrency("EUR", "0.8");
    const eur = await account("EUR");
    const s = await item(100000, "EUR");
    const r = await write(`/receivables/${s.id}/payments`, payBody(s, {}, eur));
    expect(r.statusCode, r.body).toBe(201);
    const p = r.json() as ReceivablePayment;
    expect(p.amount).toEqual({ amount: 100000, currency: "EUR" });
    expect(p.receivable.status).toBe("paid");
    expect(await entryOf(p.id)).toMatchObject({
      kind: "income",
      currency: "EUR",
      amount: 100000,
      baseAmount: 80000,
      fxRate: "0.8000000000",
    });
    // Saying a different amount arrived makes no sense within one currency.
    const s2 = await item(100000, "EUR");
    const bad = await write(
      `/receivables/${s2.id}/payments`,
      payBody(s2, { receivedAmount: { amount: 90000, currency: "EUR" } }, eur),
    );
    expect(bad.statusCode).toBe(409);
    expect(bad.json().errors[0].field).toBe("receivedAmount");
  });

  it("asks for the amount received when the account uses another currency", async () => {
    await addCurrency("EUR", "0.8");
    const eur = await account("EUR");
    const s = await item(100000, "USD");
    const missing = await write(
      `/receivables/${s.id}/payments`,
      payBody(s, {}, eur),
    );
    expect(missing.statusCode).toBe(409);
    expect(missing.json().errors[0].field).toBe("receivedAmount");
    const wrong = await write(
      `/receivables/${s.id}/payments`,
      payBody(s, { receivedAmount: { amount: 80000, currency: "USD" } }, eur),
    );
    expect(wrong.statusCode).toBe(409);
    const rate = await write(
      `/receivables/${s.id}/payments`,
      payBody(
        s,
        {
          receivedAmount: { amount: 80000, currency: "EUR" },
          fxRate: "1.25",
        },
        eur,
      ),
    );
    expect(rate.statusCode).toBe(409);
    expect(rate.json().errors[0].field).toBe("fxRate");
    // USD item into a euro account: the settled dollars fix the entry's base value exactly.
    const ok = await write(
      `/receivables/${s.id}/payments`,
      payBody(s, { receivedAmount: { amount: 80000, currency: "EUR" } }, eur),
    );
    expect(ok.statusCode, ok.body).toBe(201);
    const p = ok.json() as ReceivablePayment;
    expect(p.amount).toEqual({ amount: 100000, currency: "USD" });
    expect(p.receivable.remaining.amount).toBe(0);
    expect(await entryOf(p.id)).toMatchObject({
      currency: "EUR",
      amount: 80000,
      baseAmount: 100000,
      fxRate: "1.2500000000",
    });
  });

  it("settles a euro item into a dollar account with the dollars received, and Undo and restore still balance", async () => {
    await addCurrency("EUR", "0.8");
    const usd = await account("USD");
    const s = await item(100000, "EUR");
    const r = await write(
      `/receivables/${s.id}/payments`,
      payBody(s, { receivedAmount: { amount: 130000, currency: "USD" } }, usd),
    );
    expect(r.statusCode, r.body).toBe(201);
    const p = r.json() as ReceivablePayment;
    expect(await entryOf(p.id)).toMatchObject({
      currency: "USD",
      amount: 130000,
      baseAmount: 130000,
    });
    const del = await write(path(p), { ...versions(p) }, "DELETE");
    expect(del.statusCode, del.body).toBe(204);
    const back = await write(`${path(p)}/restore`, {
      expectedVersion: p.version + 1,
      expectedReceivableVersion: p.receivable.version + 1,
    });
    expect(back.statusCode, back.body).toBe(200);
    expect((await entryOf(p.id))?.deletedAt).toBeNull();
    expect((await entryOf(p.id))?.amount).toBe(130000);
  });

  it("prices a payment between two non-base currencies at the stored rate, or one set by hand", async () => {
    await addCurrency("EUR", "0.8");
    await addCurrency("BDT", "0.008");
    const bdt = await account("BDT");
    const s = await item(100000, "EUR");
    const stored = await write(
      `/receivables/${s.id}/payments`,
      payBody(
        s,
        {
          amount: { amount: 50000, currency: "EUR" },
          receivedAmount: { amount: 5000000, currency: "BDT" },
        },
        bdt,
      ),
    );
    expect(stored.statusCode, stored.body).toBe(201);
    expect(await entryOf(stored.json().id)).toMatchObject({
      currency: "BDT",
      amount: 5000000,
      baseAmount: 40000,
      fxRate: "0.0080000000",
    });
    const s2 = stored.json().receivable as Receivable;
    const manual = await write(
      `/receivables/${s.id}/payments`,
      payBody(
        { ...s2 },
        {
          amount: { amount: 50000, currency: "EUR" },
          receivedAmount: { amount: 5000000, currency: "BDT" },
          fxRate: "0.01",
        },
        bdt,
      ),
    );
    expect(manual.statusCode, manual.body).toBe(201);
    expect(await entryOf(manual.json().id)).toMatchObject({
      baseAmount: 50000,
      fxRate: "0.0100000000",
    });
  });

  it("keeps an item's currency once a payment exists, and lets it change before", async () => {
    await addCurrency("EUR", "0.8");
    const s = await item(100000, "USD");
    const change = (version: number, currency: string) =>
      write(
        `/receivables/${s.id}`,
        {
          contactId: client.id,
          description: "Website work",
          serviceDate: "2026-10-07",
          dueDate: null,
          amount: { amount: 100000, currency },
          expectedVersion: version,
        },
        "PATCH",
      );
    const early = await change(s.version, "EUR");
    expect(early.statusCode, early.body).toBe(200);
    expect(early.json().amount.currency).toBe("EUR");
    const eur = await account("EUR");
    const paid = await write(
      `/receivables/${s.id}/payments`,
      payBody(early.json() as Receivable, {}, eur),
    );
    expect(paid.statusCode, paid.body).toBe(201);
    const late = await change(paid.json().receivable.version, "USD");
    expect(late.statusCode).toBe(409);
    expect(late.json().errors[0].field).toBe("amount.currency");
  });

  it("ties a payment's currency to its item in the database", async () => {
    await addCurrency("EUR", "0.8");
    const s = await item(100000, "EUR");
    const eur = await account("EUR");
    const p = (
      await write(
        `/receivables/${s.id}/payments`,
        payBody(s, { amount: { amount: 100, currency: "EUR" } }, eur),
      )
    ).json() as ReceivablePayment;
    await expect(
      db
        .update(receivablePayments)
        .set({ currency: "USD" })
        .where(eq(receivablePayments.id, p.id)),
    ).rejects.toThrow();
  });

  it("shows each client's balance per currency, valued at the newest rates, and names a missing rate", async () => {
    await addCurrency("EUR", "0.8");
    await addCurrency("BDT");
    await item(10000, "USD");
    await item(50000, "EUR");
    await item(900000, "BDT");
    const clients = (await read("/contacts")).json();
    const sam = clients.items.find((row: Contact) => row.id === client.id);
    expect(sam.openBalances).toEqual([
      { amount: 900000, currency: "BDT" },
      { amount: 50000, currency: "EUR" },
      { amount: 10000, currency: "USD" },
    ]);
    // $100.00 plus EUR 500.00 at 0.8; BDT has no rate and is named instead.
    expect(sam.openBalance).toEqual({ amount: 50000, currency: "USD" });
    expect(sam.unconvertedCurrencies).toEqual(["BDT"]);
    const home = (await read("/home?month=2026-10")).json();
    expect(home.owed).toMatchObject({
      total: { amount: 50000, currency: "USD" },
      personCount: 1,
      otherCurrencies: ["BDT", "EUR"],
      unconvertedCurrencies: ["BDT"],
    });
  });

  it("previews and saves a receipt in one currency, ignoring the client's items in other currencies", async () => {
    await addCurrency("EUR", "0.8");
    const eur = await account("EUR");
    const first = await item(60000, "EUR");
    await item(40000, "EUR");
    await item(99999, "USD");
    const preview = await read(
      `/contacts/${client.id}/receipt-preview?amount=70000&currency=EUR`,
    );
    expect(preview.statusCode, preview.body).toBe(200);
    const shown = preview.json();
    expect(shown.openTotal).toEqual({ amount: 100000, currency: "EUR" });
    expect(
      shown.allocations.map((a: { applied: object }) => a.applied),
    ).toEqual([
      { amount: 60000, currency: "EUR" },
      { amount: 10000, currency: "EUR" },
    ]);
    const saved = await write(`/contacts/${client.id}/receipts`, {
      amount: { amount: 70000, currency: "EUR" },
      accountId: eur,
      categoryId,
      date: "2026-10-07",
      expectedAllocations: shown.allocations.map(
        (a: { receivableId: string; version: number; applied: Money }) => ({
          receivableId: a.receivableId,
          expectedVersion: a.version,
          applied: a.applied.amount,
        }),
      ),
    });
    expect(saved.statusCode, saved.body).toBe(201);
    expect(saved.json().amount).toEqual({ amount: 70000, currency: "EUR" });
    expect((await read(`/receivables/${first.id}`)).json().status).toBe("paid");
  });

  it("shares the amount received exactly across a receipt's payments when the account uses another currency", async () => {
    await addCurrency("EUR", "0.8");
    const usd = await account("USD");
    await item(10000, "EUR");
    await item(10000, "EUR");
    await item(10000, "EUR");
    const shown = (
      await read(
        `/contacts/${client.id}/receipt-preview?amount=30000&currency=EUR`,
      )
    ).json();
    const body = (extra: object) => ({
      amount: { amount: 30000, currency: "EUR" },
      accountId: usd,
      categoryId,
      date: "2026-10-07",
      expectedAllocations: shown.allocations.map(
        (a: { receivableId: string; version: number; applied: Money }) => ({
          receivableId: a.receivableId,
          expectedVersion: a.version,
          applied: a.applied.amount,
        }),
      ),
      ...extra,
    });
    const missing = await write(`/contacts/${client.id}/receipts`, body({}));
    expect(missing.statusCode).toBe(409);
    expect(missing.json().errors[0].field).toBe("receivedAmount");
    // 100.00 USD across three equal payments cannot split evenly; the shares still add up.
    const saved = await write(
      `/contacts/${client.id}/receipts`,
      body({ receivedAmount: { amount: 10000, currency: "USD" } }),
    );
    expect(saved.statusCode, saved.body).toBe(201);
    const payments = saved.json().payments as ReceivablePayment[];
    const entries = await Promise.all(payments.map((p) => entryOf(p.id)));
    expect(entries.map((e) => e?.amount).sort()).toEqual([3333, 3333, 3334]);
    expect(entries.reduce((sum, e) => sum + (e?.baseAmount ?? 0), 0)).toBe(
      10000,
    );
    // Too little to give every payment something is refused with nothing saved.
    const tiny = await write(
      `/contacts/${client.id}/receipts`,
      body({ receivedAmount: { amount: 2, currency: "USD" } }),
    );
    expect([404, 409]).toContain(tiny.statusCode);
  });

  it("edits a receipt's account to another currency only with the amount received, shared exactly", async () => {
    await addCurrency("EUR", "0.8");
    const eur = await account("EUR");
    const usd = await account("USD");
    await item(10000, "EUR");
    await item(5000, "EUR");
    const shown = (
      await read(
        `/contacts/${client.id}/receipt-preview?amount=15000&currency=EUR`,
      )
    ).json();
    const saved = await write(`/contacts/${client.id}/receipts`, {
      amount: { amount: 15000, currency: "EUR" },
      accountId: eur,
      categoryId,
      date: "2026-10-07",
      expectedAllocations: shown.allocations.map(
        (a: { receivableId: string; version: number; applied: Money }) => ({
          receivableId: a.receivableId,
          expectedVersion: a.version,
          applied: a.applied.amount,
        }),
      ),
    });
    expect(saved.statusCode, saved.body).toBe(201);
    const receipt = saved.json();
    const expectedPayments = (r: { payments: ReceivablePayment[] }) =>
      r.payments.map((p) => ({
        paymentId: p.id,
        expectedVersion: p.version,
        expectedReceivableVersion: p.receivable.version,
      }));
    const edit = (extra: object, r = receipt) =>
      write(
        `/receipts/${r.id}`,
        {
          accountId: usd,
          categoryId,
          date: "2026-10-07",
          expectedPayments: expectedPayments(r),
          ...extra,
        },
        "PATCH",
      );
    const refused = await edit({});
    expect(refused.statusCode).toBe(409);
    expect(refused.json().errors[0].field).toBe("receivedAmount");
    const ok = await edit({
      receivedAmount: { amount: 18000, currency: "USD" },
    });
    expect(ok.statusCode, ok.body).toBe(200);
    const entries = await Promise.all(
      (ok.json().payments as ReceivablePayment[]).map((p) => entryOf(p.id)),
    );
    expect(entries.map((e) => [e?.currency, e?.amount]).sort()).toEqual([
      ["USD", 12000],
      ["USD", 6000],
    ]);
  });
});
