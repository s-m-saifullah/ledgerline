import {
  homeSummarySchema,
  netWorthReportSchema,
  newId,
} from "@ledgerline/shared";
import { inArray } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
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
  session,
  transactions,
  user,
} from "../../db/schema";
import {
  requireTestDatabase,
  signInCookie,
  testConfig,
} from "../../test-support/harness";
import { hashPassword } from "../auth/password";

const url = requireTestDatabase("Net worth report tests");
const config = testConfig(url, "networth");
const { db, pool } = createDatabase(url);
const app = await buildApp(db, config);
const ledgerId = newId();
const otherLedger = newId();
const ids = [ledgerId, otherLedger];
const users = [newId(), newId(), newId()];
const roles = ["owner", "editor", "viewer"] as const;
let cookies: string[] = [];
const get = (path: string, ledger = ledgerId, cookie = cookies[0] as string) =>
  app.inject({
    url: `/api/v1/ledgers/${ledger}${path}`,
    headers: { cookie },
  });
const report = async (query: string, ledger = ledgerId) => {
  const response = await get(`/reports/net-worth?${query}`, ledger);
  expect(response.statusCode, response.body).toBe(200);
  return netWorthReportSchema.parse(response.json());
};
const points = (data: Awaited<ReturnType<typeof report>>) =>
  data.months.map((point) => [
    point.month,
    point.netWorth.amount,
    point.unconvertedCurrencies,
  ]);

const categoryIds = new Map<string, string>();
/** Ordinary entries need a category of their own kind; one per ledger and kind is enough here. */
async function categoryOf(ledger: string, kind: "expense" | "income") {
  const key = `${ledger}:${kind}`;
  const found = categoryIds.get(key);
  if (found) return found;
  const id = newId();
  await db
    .insert(categories)
    .values({ id, ledgerId: ledger, name: `Misc ${kind}`, kind });
  categoryIds.set(key, id);
  return id;
}
async function clear() {
  categoryIds.clear();
  await db.delete(transactions).where(inArray(transactions.ledgerId, ids));
  await db.delete(categories).where(inArray(categories.ledgerId, ids));
  await db.delete(accounts).where(inArray(accounts.ledgerId, ids));
  await db.delete(contacts).where(inArray(contacts.ledgerId, ids));
  await db.delete(exchangeRates).where(inArray(exchangeRates.ledgerId, ids));
  await db.delete(currencies).where(inArray(currencies.ledgerId, ids));
}

type Extra = Partial<typeof accounts.$inferInsert>;
async function account(
  name: string,
  currency: string,
  openingBalance: number,
  extra: Extra = {},
  ledger = ledgerId,
) {
  const id = newId();
  await db.insert(accounts).values({
    id,
    ledgerId: ledger,
    name,
    type: "bank",
    currency,
    openingBalance,
    // Long-standing by default, so the hand-checked months are all inside the account's history.
    createdAt: new Date("2020-01-01T00:00:00Z"),
    ...extra,
  });
  return id;
}
async function entry(
  accountId: string,
  amount: number,
  date: string,
  extra: Partial<typeof transactions.$inferInsert> = {},
  currency = "USD",
  ledger = ledgerId,
) {
  await db.insert(transactions).values({
    id: newId(),
    ledgerId: ledger,
    accountId,
    kind: amount < 0 ? "expense" : "income",
    categoryId: extra.transferId
      ? null
      : await categoryOf(ledger, amount < 0 ? "expense" : "income"),
    date,
    amount,
    currency,
    baseAmount: amount,
    ...extra,
  });
}
const rate = (code: string, date: string, value: string, ledger = ledgerId) =>
  db
    .insert(exchangeRates)
    .values({ ledgerId: ledger, code, date, rate: value, source: "api" });

/**
 * Hand-checked history (cents), month ends Feb to May 2026:
 * Checking 100000 opening: +20000 on 02-10, -5000 on 03-05, -1000 on 03-31, +3000 on 04-01,
 *   a 10000 transfer to Savings on 04-15; a pending -777 and a deleted -999 never count.
 * Savings 50000. Old (archived) 7000. A person's loan balance -2000, +500 on 04-02.
 * EUR 10000 opening, +2500 on 03-20; EUR rates 1.10 from 03-10, 1.20 from 04-10.
 * BDT 1000000 opening; its only rates are 0.0083 from 04-20 and 0.0090 from 05-10.
 * A JPY account with nothing in it and no rate, and a deleted account, add nothing.
 */
async function history(ledger = ledgerId) {
  for (const code of ["EUR", "BDT", "JPY"])
    await db.insert(currencies).values({ ledgerId: ledger, code });
  const checking = await account("Checking", "USD", 100000, {}, ledger);
  const savings = await account("Savings", "USD", 50000, {}, ledger);
  await account("Old", "USD", 7000, { archivedAt: new Date() }, ledger);
  await account("Gone", "USD", 99999, { deletedAt: new Date() }, ledger);
  const eur = await account("Euros", "EUR", 10000, {}, ledger);
  await account("Taka", "BDT", 1000000, {}, ledger);
  await account("Yen", "JPY", 0, {}, ledger);
  const person = newId();
  await db
    .insert(contacts)
    .values({ id: person, ledgerId: ledger, name: "Sam", origin: "loan" });
  const loan = await account(
    "Sam loan",
    "USD",
    -2000,
    { type: "loan", contactId: person },
    ledger,
  );
  const add = (id: string, amount: number, date: string, x = {}, c = "USD") =>
    entry(id, amount, date, x, c, ledger);
  await add(checking, 20000, "2026-02-10");
  await add(checking, -5000, "2026-03-05");
  await add(checking, -1000, "2026-03-31");
  await add(checking, 3000, "2026-04-01");
  await add(checking, -777, "2026-03-10", { status: "pending" });
  await add(checking, -999, "2026-03-11", { deletedAt: new Date() });
  const transfer = newId();
  const leg = (accountId: string, amount: number) => ({
    id: newId(),
    ledgerId: ledger,
    accountId,
    kind: "transfer" as const,
    transferId: transfer,
    date: "2026-04-15",
    amount,
    baseAmount: amount,
  });
  await db
    .insert(transactions)
    .values([leg(checking, -10000), leg(savings, 10000)]);
  await add(loan, 500, "2026-04-02");
  await add(eur, 2500, "2026-03-20", { baseAmount: 2750 }, "EUR");
  await rate("EUR", "2026-03-10", "1.10", ledger);
  await rate("EUR", "2026-04-10", "1.20", ledger);
  await rate("BDT", "2026-04-20", "0.0083", ledger);
  await rate("BDT", "2026-05-10", "0.0090", ledger);
  return { checking, savings, eur };
}

beforeAll(async () => {
  await applyMigrations(url);
  await db
    .insert(ledgers)
    .values(ids.map((id) => ({ id, name: "Synthetic net worth suite" })));
  const password = await hashPassword(config.OWNER_PASSWORD);
  for (const [i, role] of roles.entries()) {
    const id = users[i] as string;
    await db
      .insert(user)
      .values({ id, name: role, email: `networth-${role}-${id}@example.com` });
    await db.insert(credentials).values({
      userId: id,
      accountId: id,
      providerId: "credential",
      password,
    });
    await db.insert(ledgerMembers).values({ userId: id, ledgerId, role });
  }
  await db.insert(ledgerMembers).values({
    userId: users[0] as string,
    ledgerId: otherLedger,
    role: "owner",
  });
  await app.ready();
  cookies = [];
  for (const [i, role] of roles.entries())
    cookies.push(
      await signInCookie(
        app,
        config,
        `networth-${role}-${users[i]}@example.com`,
      ),
    );
});
beforeEach(clear);
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

describe("net worth report", () => {
  it("values each month end at the rates stored by then", async () => {
    await history();
    // Another ledger's rows (a big balance and a rate) never reach this one.
    await history(otherLedger);
    await account("Other", "USD", 5000000, {}, otherLedger);
    const data = await report("to=2026-05&months=4");
    expect(data).toMatchObject({ from: "2026-02", to: "2026-05" });
    expect(data.months.map((point) => point.asOf)).toEqual([
      "2026-02-28",
      "2026-03-31",
      "2026-04-30",
      "2026-05-31",
    ]);
    // USD side: 175000, 169000, 172500, 172500. EUR from 03-10 at 1.10 (13750) and from 04-10 at 1.20 (15000);
    // BDT from 04-20 at 0.0083 (8300) and from 05-10 at 0.0090 (9000).
    expect(points(data)).toEqual([
      ["2026-02", 175000, ["BDT", "EUR"]],
      ["2026-03", 182750, ["BDT"]],
      ["2026-04", 195800, []],
      ["2026-05", 196500, []],
    ]);
    expect(data.months[0]?.netWorth.currency).toBe("USD");
  });

  it("counts everything dated before the window and skips a month with no rate", async () => {
    await history();
    const march = await report("to=2026-03&months=1");
    expect(points(march)).toEqual([["2026-03", 182750, ["BDT"]]]);
    // January is before the first EUR rate and before every BDT rate: those accounts are left out.
    const january = await report("to=2026-01&months=1");
    expect(points(january)).toEqual([["2026-01", 155000, ["BDT", "EUR"]]]);
  });

  it("never borrows a later rate and ignores a rate dated after the point", async () => {
    await account("Euros", "EUR", 10000);
    await db.insert(currencies).values({ ledgerId, code: "EUR" });
    await rate("EUR", "2026-06-15", "1.50");
    expect(points(await report("to=2026-06&months=2"))).toEqual([
      ["2026-05", 0, ["EUR"]],
      ["2026-06", 15000, []],
    ]);
  });

  it("uses the stored rate of an earlier day for a month end", async () => {
    await account("Euros", "EUR", 10000);
    await db.insert(currencies).values({ ledgerId, code: "EUR" });
    await rate("EUR", "2026-05-30", "1.25");
    await rate("EUR", "2026-05-31", "1.30");
    await rate("EUR", "2026-04-30", "1.10");
    expect(points(await report("to=2026-05&months=2"))).toEqual([
      ["2026-04", 11000, []],
      ["2026-05", 13000, []],
    ]);
  });

  it("is as of today for the current month and repeats it for later months", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    const checking = await account("Checking", "USD", 1000);
    await entry(checking, 200, today);
    await entry(checking, 5000, tomorrow);
    const month = today.slice(0, 7);
    const [y, m] = [Number(month.slice(0, 4)), Number(month.slice(5, 7))];
    const later = new Date(Date.UTC(y, m + 1, 1)).toISOString().slice(0, 7);
    const data = await report(`to=${later}&months=3`);
    expect(data.months.map((point) => point.netWorth.amount)).toEqual([
      1200, 1200, 1200,
    ]);
    expect(data.months.at(-1)?.asOf).toBe(today);
    expect(data.months[0]?.asOf).toBe(today);
  });

  it("makes the latest point equal Home's net worth", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const month = today.slice(0, 7);
    const s = await history();
    await entry(s.checking, -1234, today);
    await entry(s.savings, 4321, today, { status: "pending" });
    const data = await report(`to=${month}&months=3`);
    const home = homeSummarySchema.parse(
      (await get(`/home?month=${month}`)).json(),
    );
    const latest = data.months.at(-1);
    expect(latest?.netWorth).toEqual(home.netWorth);
    expect(latest?.unconvertedCurrencies).toEqual(
      home.unconvertedCurrencies.filter((code) => code !== "JPY"),
    );
    // Archived and client loan accounts are in it; 107000-1234+60000+7000-1500 + 15000 + 9000 = the sum.
    expect(home.netWorth.amount).toBe(
      107000 - 1234 + 60000 + 7000 - 1500 + 15000 + 9000,
    );
  });

  it("limits the months and rejects bad queries", async () => {
    await account("Old", "USD", 100);
    expect((await report("to=2026-05")).months).toHaveLength(12);
    const full = await report("to=2026-05&months=24");
    expect(full.months).toHaveLength(24);
    expect(full.from).toBe("2024-06");
    for (const query of [
      "to=2026-05&months=0",
      "to=2026-05&months=25",
      "to=2026-05&months=x",
      "to=2026-13",
      "months=3",
      "to=2026-05&extra=1",
    ])
      expect((await get(`/reports/net-worth?${query}`)).statusCode, query).toBe(
        400,
      );
  });

  describe("history start", () => {
    const monthsAgo = (count: number) => {
      const now = new Date();
      const index = now.getUTCFullYear() * 12 + now.getUTCMonth() - count;
      return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
    };

    it("leaves out months before the first account when there are no older entries", async () => {
      await account("New", "USD", 5000, { createdAt: new Date() });
      const data = await report(`to=${monthsAgo(0)}&months=12`);
      expect(data.historyStart).toBe(monthsAgo(0));
      expect(data.months.map((point) => point.month)).toEqual([monthsAgo(0)]);
      expect(data.months[0]?.netWorth.amount).toBe(5000);
    });

    it("starts at an older entry, so imported history shows its months", async () => {
      const id = await account("New", "USD", 5000, { createdAt: new Date() });
      await entry(id, -1000, `${monthsAgo(3)}-10`);
      const data = await report(`to=${monthsAgo(0)}&months=12`);
      expect(data.historyStart).toBe(monthsAgo(3));
      expect(data.months.map((point) => point.month)).toEqual([
        monthsAgo(3),
        monthsAgo(2),
        monthsAgo(1),
        monthsAgo(0),
      ]);
      expect(data.months.map((point) => point.netWorth.amount)).toEqual([
        4000, 4000, 4000, 4000,
      ]);
    });

    it("returns no months for a window that ends before the history starts", async () => {
      await account("New", "USD", 5000, { createdAt: new Date() });
      const data = await report(`to=${monthsAgo(6)}&months=3`);
      expect(data.historyStart).toBe(monthsAgo(0));
      expect(data.months).toEqual([]);
    });

    it("shows only the last month for a ledger with no accounts or entries", async () => {
      const data = await report(`to=${monthsAgo(0)}&months=12`);
      expect(data.historyStart).toBeNull();
      expect(data.months.map((point) => point.month)).toEqual([monthsAgo(0)]);
      expect(data.months[0]?.netWorth.amount).toBe(0);
    });
  });

  it("returns 409 when the total leaves the exact integer range", async () => {
    await account("A", "USD", Number.MAX_SAFE_INTEGER);
    await account("B", "USD", Number.MAX_SAFE_INTEGER);
    const response = await get("/reports/net-worth?to=2026-05&months=1");
    expect(response.statusCode).toBe(409);
  });

  it("allows a viewer, hides another ledger and rejects anonymous calls", async () => {
    await account("Checking", "USD", 1000);
    const viewer = await get(
      "/reports/net-worth?to=2026-05&months=1",
      ledgerId,
      cookies[2],
    );
    expect(viewer.statusCode).toBe(200);
    // The viewer and editor belong only to the first ledger.
    for (const cookie of [cookies[1], cookies[2]])
      expect(
        (
          await get(
            "/reports/net-worth?to=2026-05&months=1",
            otherLedger,
            cookie,
          )
        ).statusCode,
      ).toBe(404);
    const anonymous = await app.inject({
      url: `/api/v1/ledgers/${ledgerId}/reports/net-worth?to=2026-05`,
    });
    expect(anonymous.statusCode).toBe(401);
  });
});
