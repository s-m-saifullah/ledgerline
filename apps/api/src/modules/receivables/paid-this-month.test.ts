import {
  type Contact,
  newId,
  type Receivable,
  type ReceivablePayment,
} from "@ledgerline/shared";
import { and, eq, inArray } from "drizzle-orm";
import {
  afterAll,
  afterEach,
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
import {
  requireTestDatabase,
  seedUser,
  signInCookie,
  testConfig,
} from "../../test-support/harness";
import { receivableRepository } from "./repo";

const url = requireTestDatabase("Paid this month tests");
const config = testConfig(url, "paidmonth");
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
    await tx.delete(transactions).where(inArray(transactions.ledgerId, ids));
    await tx
      .delete(receivablePayments)
      .where(inArray(receivablePayments.ledgerId, ids));
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
    .values(ids.map((id) => ({ id, name: "Synthetic paid this month suite" })));

  for (const [i, role] of (["owner", "editor", "viewer"] as const).entries()) {
    const id = users[i] as string,
      email = `paidmonth-${role}-${id}@example.com`;
    await seedUser(db, config, { id, email, name: role, ledgerId, role });
  }
  await db
    .insert(ledgerMembers)
    .values({ userId: users[0] as string, ledgerId: other, role: "owner" });
  await app.ready();
  const cookies = [];
  for (const [i, role] of ["owner", "editor", "viewer"].entries()) {
    cookies.push(
      await signInCookie(
        app,
        config,
        `paidmonth-${role}-${users[i]}@example.com`,
      ),
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
const SEPTEMBER = "2026-09";
const OCTOBER = "2026-10";
const paid = (c: Contact) => c.paidThisMonth;
const contact = async (id = client.id, month?: string) => {
  const r = await read(`/contacts/${id}${month ? `?month=${month}` : ""}`);
  expect(r.statusCode, r.body).toBe(200);
  return r.json() as Contact;
};
const listed = async (month?: string, id = client.id) => {
  const r = await read(`/contacts${month ? `?month=${month}` : ""}`);
  expect(r.statusCode, r.body).toBe(200);
  const found = (r.json().items as Contact[]).find((c) => c.id === id);
  expect(found).toBeDefined();
  return found as Contact;
};
const pay = async (
  s: Receivable,
  date: string,
  amount: number,
  account = accountId,
  extra: object = {},
) => {
  // Every payment raises the service's version, so take the current one.
  const current = (await read(`/receivables/${s.id}`)).json() as Receivable;
  const r = await write(
    `/receivables/${s.id}/payments`,
    payBody(
      current,
      { amount: { amount, currency: s.amount.currency }, date, ...extra },
      account,
    ),
  );
  expect(r.statusCode, r.body).toBe(201);
  return r.json() as ReceivablePayment;
};
const usd = (amount: number) => ({ amount, currency: "USD" });

describe("Paid this month on a client", () => {
  it("is zero with no amounts for a client who has paid nothing", async () => {
    await item(5000, "USD");
    const none = { base: usd(0), amounts: [] };
    expect(paid(await contact(client.id, OCTOBER))).toEqual(none);
    expect(paid(await listed(OCTOBER))).toEqual(none);
    expect(client.paidThisMonth).toEqual(none);
  });

  it("counts payments dated inside the month, first and last day included", async () => {
    const s = await item(1000000, "USD");
    await pay(s, "2026-09-30", 1000);
    await pay(s, "2026-10-01", 2000);
    await pay(s, "2026-10-31", 4000);
    await pay(s, "2026-11-01", 8000);
    const october = { base: usd(6000), amounts: [usd(6000)] };
    expect(paid(await contact(client.id, OCTOBER))).toEqual(october);
    expect(paid(await listed(OCTOBER))).toEqual(october);
    const september = { base: usd(1000), amounts: [usd(1000)] };
    expect(paid(await contact(client.id, SEPTEMBER))).toEqual(september);
    expect(paid(await listed(SEPTEMBER))).toEqual(september);
    expect(paid(await contact(client.id, "2026-12"))).toEqual({
      base: usd(0),
      amounts: [],
    });
  });

  it("adds each currency apart and values the total at the rate saved with each payment", async () => {
    await addCurrency("EUR", "0.8");
    await addCurrency("GBP", "1.25");
    const eur = await account("EUR");
    const gbp = await account("GBP");
    const euroItem = await item(100000, "EUR");
    await pay(euroItem, "2026-10-05", 100000, eur);
    const dollarItem = await item(50000, "USD");
    // Dollars owed, paid into a pound account: the 40000 pence that arrive are worth $500.
    const p = await pay(dollarItem, "2026-10-06", 50000, gbp, {
      receivedAmount: { amount: 40000, currency: "GBP" },
    });
    expect(p.amount).toEqual(usd(50000));
    // A later rate change must not move what was already received.
    await db.insert(exchangeRates).values({
      id: newId(),
      ledgerId,
      code: "EUR",
      date: "2026-10-20",
      rate: "0.5",
      source: "manual",
    });
    const expected = {
      base: usd(80000 + 50000),
      amounts: [{ amount: 100000, currency: "EUR" }, usd(50000)],
    };
    expect(paid(await contact(client.id, OCTOBER))).toEqual(expected);
    expect(paid(await listed(OCTOBER))).toEqual(expected);
  });

  it("leaves out deleted payments and follows a payment moved to another month", async () => {
    const s = await item(1000000, "USD");
    const gone = await pay(s, "2026-10-02", 1000);
    const moved = await pay(s, "2026-10-03", 2000);
    await pay(s, "2026-10-04", 4000);
    const stale = (await read(path(gone))).json() as ReceivablePayment;
    const removed = await write(path(stale), versions(stale), "DELETE");
    expect(removed.statusCode, removed.body).toBe(204);
    expect(paid(await contact(client.id, OCTOBER)).base).toEqual(usd(6000));
    const fresh = (await read(path(moved))).json() as ReceivablePayment;
    const edited = await write(
      path(fresh),
      {
        amount: usd(2000),
        accountId,
        categoryId,
        date: "2026-11-02",
        time: null,
        note: null,
        ...versions(fresh),
      },
      "PATCH",
    );
    expect(edited.statusCode, edited.body).toBe(200);
    expect(paid(await contact(client.id, OCTOBER))).toEqual({
      base: usd(4000),
      amounts: [usd(4000)],
    });
    expect(paid(await contact(client.id, "2026-11"))).toEqual({
      base: usd(2000),
      amounts: [usd(2000)],
    });
  });

  it("does not count a tip, only what the payment settles", async () => {
    const s = await item(10000, "USD");
    await pay(s, "2026-10-09", 10000, accountId, {
      tip: { amount: usd(2500), categoryId },
    });
    expect(paid(await contact(client.id, OCTOBER))).toEqual({
      base: usd(10000),
      amounts: [usd(10000)],
    });
  });

  it("keeps each client's figure apart", async () => {
    const s = await item(100000, "USD");
    await pay(s, "2026-10-09", 3000);
    const r = await write("/contacts", { name: "Alex" });
    const second = r.json() as Contact;
    expect(paid(await listed(OCTOBER, second.id)).base).toEqual(usd(0));
    expect(paid(await listed(OCTOBER, client.id)).base).toEqual(usd(3000));
  });

  it("never counts payments from another ledger", async () => {
    const foreignAccount = newId();
    const foreignCategory = newId();
    await db.insert(accounts).values({
      id: foreignAccount,
      ledgerId: other,
      name: "Other receiving",
      type: "bank",
      openingBalance: 0,
    });
    await db.insert(categories).values({
      id: foreignCategory,
      ledgerId: other,
      name: "Other services",
      kind: "income",
    });
    const c = (
      await write("/contacts", { name: "Pat" }, "POST", cookie, newId(), other)
    ).json() as Contact;
    const s = (
      await write(
        "/receivables",
        {
          contactId: c.id,
          description: "Other work",
          serviceDate: "2026-10-07",
          dueDate: null,
          amount: usd(900000),
        },
        "POST",
        cookie,
        newId(),
        other,
      )
    ).json() as Receivable;
    const made = await write(
      `/receivables/${s.id}/payments`,
      {
        ...payBody(
          s,
          { date: "2026-10-08", amount: usd(900000) },
          foreignAccount,
        ),
        categoryId: foreignCategory,
      },
      "POST",
      cookie,
      newId(),
      other,
    );
    expect(made.statusCode, made.body).toBe(201);
    const mine = await item(100000, "USD");
    await pay(mine, "2026-10-08", 1000);
    // This ledger sees only its own client and its own figure.
    expect(paid(await listed(OCTOBER)).base).toEqual(usd(1000));
    const here = (await read(`/contacts?month=${OCTOBER}`)).json()
      .items as Contact[];
    expect(here.map((x) => x.id)).not.toContain(c.id);
    expect((await read(`/contacts/${c.id}?month=${OCTOBER}`)).statusCode).toBe(
      404,
    );
    // The query itself is scoped, not only the clients it is matched to.
    const rows = (
      await receivableRepository(db, ledgerId).paidBetween(
        "2026-10-01",
        "2026-10-31",
      )
    ).rows;
    expect(rows.map((row) => row.contactId)).toEqual([client.id]);
    // The other ledger's own read shows its own figure.
    const there = await app.inject({
      url: `${base(other)}/contacts/${c.id}?month=${OCTOBER}`,
      headers: { cookie },
    });
    expect(paid(there.json())).toEqual({
      base: usd(900000),
      amounts: [usd(900000)],
    });
    // A ledger the caller does not belong to cannot be read at all.
    expect(
      (
        await app.inject({
          url: `${base(foreign)}/contacts?month=${OCTOBER}`,
          headers: { cookie },
        })
      ).statusCode,
    ).toBe(404);
  });

  it("refuses a month that is not YYYY-MM", async () => {
    for (const month of [
      "2026-13",
      "2026-1",
      "2026-10-01",
      "October",
      "0000-01",
    ]) {
      expect((await read(`/contacts?month=${month}`)).statusCode, month).toBe(
        400,
      );
      expect(
        (await read(`/contacts/${client.id}?month=${month}`)).statusCode,
        month,
      ).toBe(400);
    }
  });

  describe("without a month", () => {
    afterEach(() => {
      vi.useRealTimers();
    });
    // 23:30 UTC on 31 October is already 1 November at UTC+14.
    const edge = new Date("2026-10-31T23:30:00Z");
    const setZone = (timeZone: string | null) =>
      db.update(ledgers).set({ timeZone }).where(eq(ledgers.id, ledgerId));
    it("uses the current month in the ledger's time zone, UTC when it has none", async () => {
      const s = await item(1000000, "USD");
      await pay(s, "2026-10-15", 1000);
      await pay(s, "2026-11-01", 2000);
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(edge);
      await setZone(null);
      expect(paid(await contact()).base).toEqual(usd(1000));
      expect(paid(await listed()).base).toEqual(usd(1000));
      await setZone("Pacific/Kiritimati");
      expect(paid(await contact()).base).toEqual(usd(2000));
      expect(paid(await listed()).base).toEqual(usd(2000));
      await setZone("America/Chicago");
      expect(paid(await contact()).base).toEqual(usd(1000));
      await setZone(null);
    });
  });
});
