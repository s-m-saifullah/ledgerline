import { homeSummarySchema, monthRange, newId } from "@ledgerline/shared";
import { inArray } from "drizzle-orm";
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
  transactionSplits,
  transactions,
  user,
  writeReceipts,
} from "../../db/schema";
import { hashPassword } from "../auth/password";

const url = process.env.TEST_DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith("/ledgerline_test"))
  throw new Error("Home tests require dedicated ledgerline_test.");
const config = readConfig({
  NODE_ENV: "test",
  DATABASE_URL: url,
  APP_URL: "http://localhost:5173",
  BETTER_AUTH_SECRET: "home-test-secret-only-0000000000000000000",
  OWNER_EMAIL: "home@example.com",
  OWNER_PASSWORD: "Home-test-password-00000",
  OWNER_NAME: "Test owner",
});
const { db, pool } = createDatabase(url);
const app = await buildApp(db, config);
const ledgerId = newId();
const otherLedger = newId();
const emptyLedger = newId();
const ids = [ledgerId, otherLedger, emptyLedger];
const users = [newId(), newId(), newId()];
const roles = ["owner", "editor", "viewer"] as const;
let cookies: string[] = [];
const money = (amount: number) => ({ amount, currency: "USD" });
const headers = (key = newId(), cookie = cookies[0] as string) => ({
  cookie,
  origin: config.APP_URL,
  "idempotency-key": key,
  "content-type": "application/json",
});
const base = (ledger = ledgerId) => `/api/v1/ledgers/${ledger}`;
const get = (path: string, ledger = ledgerId, cookie = cookies[0] as string) =>
  app.inject({ url: base(ledger) + path, headers: { cookie } });
async function send(
  path: string,
  body: unknown,
  method: "POST" | "PATCH" | "DELETE" = "POST",
  ledger = ledgerId,
) {
  const response = await app.inject({
    url: base(ledger) + path,
    method,
    headers: headers(),
    payload: JSON.stringify(body),
  });
  expect(response.statusCode, response.body).toBeLessThan(300);
  return response.body ? response.json() : undefined;
}
async function home(month = "2026-10", ledger = ledgerId) {
  const response = await get(`/home?month=${month}`, ledger);
  expect(response.statusCode, response.body).toBe(200);
  return homeSummarySchema.parse(response.json());
}
let checking = "";
let cash = "";
let card = "";
let food = "";
let services = "";
const entry = (
  accountId: string,
  amount: number,
  date: string,
  extra: Record<string, unknown> = {},
) =>
  send("/transactions", {
    accountId,
    categoryId: amount < 0 ? food : services,
    kind: amount < 0 ? "expense" : "income",
    date,
    amount: money(amount),
    ...extra,
  });
async function clear() {
  await db.transaction(async (tx) => {
    await tx
      .delete(receivableEvents)
      .where(inArray(receivableEvents.ledgerId, ids));
    await tx
      .delete(receivablePayments)
      .where(inArray(receivablePayments.ledgerId, ids));
    await tx
      .delete(transactionSplits)
      .where(inArray(transactionSplits.ledgerId, ids));
    await tx.delete(transactions).where(inArray(transactions.ledgerId, ids));
    await tx.delete(receivables).where(inArray(receivables.ledgerId, ids));
    await tx.delete(contacts).where(inArray(contacts.ledgerId, ids));
  });
  await db.delete(categories).where(inArray(categories.ledgerId, ids));
  await db.delete(accounts).where(inArray(accounts.ledgerId, ids));
  await db.delete(writeReceipts).where(inArray(writeReceipts.ledgerId, ids));
}
async function seedAccounts(ledger = ledgerId) {
  const make = (
    name: string,
    type: "bank" | "cash" | "card" | "savings",
    openingBalance: number,
    extra: { archivedAt?: Date; deletedAt?: Date } = {},
  ) => {
    const id = newId();
    return db
      .insert(accounts)
      .values({ id, ledgerId: ledger, name, type, openingBalance, ...extra })
      .then(() => id);
  };
  return {
    checking: await make("Checking", "bank", 100000),
    cash: await make("Cash", "cash", 20000),
    card: await make("Card", "card", -30000),
    savings: await make("Savings", "savings", 50000, {
      archivedAt: new Date(),
    }),
    deleted: await make("Gone", "bank", 99999, { deletedAt: new Date() }),
  };
}
async function seedCategories(ledger = ledgerId) {
  const make = (name: string, kind: "expense" | "income") => {
    const id = newId();
    return db
      .insert(categories)
      .values({ id, ledgerId: ledger, name, kind })
      .then(() => id);
  };
  return {
    food: await make("Food", "expense"),
    fun: await make("Fun", "expense"),
    services: await make("Services", "income"),
  };
}
let fun = "";
/** The hand-checked fixture from docs/HOME_PLAN.md (month 2026-10). */
async function fixture() {
  const a = await seedAccounts();
  const c = await seedCategories();
  [checking, cash, card, food, fun, services] = [
    a.checking,
    a.cash,
    a.card,
    c.food,
    c.fun,
    c.services,
  ] as [string, string, string, string, string, string];
  await entry(checking, 250000, "2026-10-01");
  await entry(checking, -4500, "2026-10-02");
  await entry(cash, -1275, "2026-10-03");
  await send("/transactions", {
    accountId: card,
    categoryId: null,
    kind: "expense",
    date: "2026-10-04",
    amount: money(-9000),
    splits: [
      { categoryId: food, amount: money(-6000), note: null },
      { categoryId: fun, amount: money(-3000), note: null },
    ],
  });
  await send("/transfers", {
    fromAccountId: checking,
    toAccountId: cash,
    amount: money(5000),
    date: "2026-10-05",
  });
  await entry(checking, -2000, "2026-10-06", { status: "pending" });
  await entry(checking, -700, "2026-09-30");
  await entry(checking, -800, "2026-11-01");
  const gone = await entry(checking, -99999, "2026-10-07");
  await send(
    `/transactions/${gone.id}`,
    { expectedVersion: gone.version },
    "DELETE",
  );
  const person = await send("/contacts", { name: "Sam" });
  const service = async (contactId: string, amount: number) =>
    send("/receivables", {
      contactId,
      description: "Work",
      serviceDate: "2026-10-01",
      dueDate: null,
      amount: money(amount),
    });
  const main = await service(person.id, 40000);
  await send(`/receivables/${main.id}/payments`, {
    amount: money(15000),
    accountId: checking,
    categoryId: services,
    date: "2026-10-07",
    time: null,
    note: null,
    expectedReceivableVersion: main.version,
  });
  const waived = await service(person.id, 10000);
  await send(`/receivables/${waived.id}/write-off`, {
    expectedVersion: waived.version,
    reason: null,
  });
  const removed = await service(person.id, 7000);
  await send(
    `/receivables/${removed.id}`,
    { expectedVersion: removed.version },
    "DELETE",
  );
  const archived = await send("/contacts", { name: "Archived" });
  await service(archived.id, 3000);
  await send(`/contacts/${archived.id}/archive`, {
    expectedVersion: archived.version,
  });
}
beforeAll(async () => {
  await applyMigrations(url);
  await db
    .insert(ledgers)
    .values(ids.map((id) => ({ id, name: "Synthetic Home suite" })));
  const password = await hashPassword(config.OWNER_PASSWORD);
  for (const [i, role] of roles.entries()) {
    const id = users[i] as string;
    await db
      .insert(user)
      .values({ id, name: role, email: `home-${role}-${id}@example.com` });
    await db.insert(credentials).values({
      userId: id,
      accountId: id,
      providerId: "credential",
      password,
    });
    await db.insert(ledgerMembers).values({ userId: id, ledgerId, role });
  }
  await db.insert(ledgerMembers).values([
    { userId: users[0] as string, ledgerId: otherLedger, role: "owner" },
    { userId: users[0] as string, ledgerId: emptyLedger, role: "owner" },
  ]);
  await app.ready();
  cookies = [];
  for (const [i, role] of roles.entries()) {
    const r = await app.inject({
      method: "POST",
      url: "/api/v1/auth/sign-in/email",
      headers: { origin: config.APP_URL },
      payload: {
        email: `home-${role}-${users[i]}@example.com`,
        password: config.OWNER_PASSWORD,
      },
    });
    expect(r.statusCode).toBe(200);
    const c = r.headers["set-cookie"];
    cookies.push(
      (Array.isArray(c) ? c : [c ?? ""]).map((v) => v.split(";")[0]).join("; "),
    );
  }
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

describe("month ranges", () => {
  it("uses calendar math for month ends, leap years and the supported year bounds", () => {
    expect(monthRange("2026-10")).toEqual({
      start: "2026-10-01",
      end: "2026-10-31",
    });
    expect(monthRange("2026-04").end).toBe("2026-04-30");
    expect(monthRange("2024-02").end).toBe("2024-02-29");
    expect(monthRange("2026-02").end).toBe("2026-02-28");
    expect(monthRange("1900-02").end).toBe("1900-02-28");
    expect(monthRange("2000-02").end).toBe("2000-02-29");
    expect(monthRange("0001-01").start).toBe("0001-01-01");
    expect(monthRange("9999-12").end).toBe("9999-12-31");
    expect(() => monthRange("0000-05")).toThrow();
    expect(() => monthRange("2026-13")).toThrow();
  });
});

describe("Home summary", () => {
  it("matches the hand-checked fixture", async () => {
    await fixture();
    const summary = await home();
    expect(summary.netWorth.amount).toBe(388725);
    // In hand: Checking + Cash only. The card (a debt) and the archived savings are not in it.
    expect(summary.inHand).toEqual(money(354000 + 23725));
    expect(summary.liabilitiesOwed).toEqual(money(39000));
    expect(summary.moneyIn.amount).toBe(265000);
    expect(summary.moneyOut.amount).toBe(14775);
    expect(summary.owed).toEqual({ total: money(28000), personCount: 2 });
    expect(summary.pendingCount).toBe(1);
    expect(summary.monthStart).toBe("2026-10-01");
    expect(summary.monthEnd).toBe("2026-10-31");
    expect(
      summary.accounts.map((row) => [row.name, row.balance.amount]),
    ).toEqual([
      ["Checking", 354000],
      ["Cash", 23725],
    ]);
    expect(summary.otherActive).toEqual({ count: 0, balance: money(0) });
    expect(summary.archived).toEqual({ count: 1, balance: money(50000) });
    expect(summary.latest.map((row) => row.transaction.amount.amount)).toEqual([
      -800, 15000, -2000, -5000, -9000,
    ]);
    const [, , pending, transfer, split] = summary.latest;
    expect(pending?.transaction.status).toBe("pending");
    expect(transfer).toMatchObject({
      accountName: "Checking",
      counterpartAccountName: "Cash",
      categoryLabel: null,
    });
    expect(transfer?.transaction.kind).toBe("transfer");
    expect(split?.transaction.isSplit).toBe(true);
    expect(split?.transaction.splits).toHaveLength(2);
    expect(summary.latest[0]?.categoryLabel).toBe("Food");
    expect(summary.setup).toEqual({
      hasActiveAccount: true,
      hasCategory: true,
    });
  });

  it("excludes the boundary days either side of the month and includes first and last days", async () => {
    const a = await seedAccounts();
    const c = await seedCategories();
    [checking, food, services] = [a.checking, c.food, c.services];
    for (const date of ["2026-09-30", "2026-10-01", "2026-10-31", "2026-11-01"])
      await entry(checking, -100, date);
    await entry(checking, 500, "2026-10-31");
    await entry(checking, 900, "2026-11-01");
    const summary = await home();
    expect(summary.moneyOut.amount).toBe(200);
    expect(summary.moneyIn.amount).toBe(500);
    // Balances ignore the month: 100000 - 400 + 1400 + 50000 archived + 20000 - 30000.
    expect(summary.netWorth.amount).toBe(
      100000 - 400 + 1400 + 50000 + 20000 - 30000,
    );
    expect((await home("2026-11")).moneyIn.amount).toBe(900);
  });

  it("changes after edits, deletes and Undo, and agrees with the lists", async () => {
    await fixture();
    const list = async (query: string) => {
      const items = [];
      let cursor = "";
      do {
        const r = await get(`/transactions?limit=100${query}${cursor}`);
        const page = r.json();
        items.push(...page.items);
        cursor = page.nextCursor ? `&cursor=${page.nextCursor}` : "";
      } while (cursor);
      return items as { amount: { amount: number } }[];
    };
    const check = async () => {
      const summary = await home();
      const range = "&from=2026-10-01&to=2026-10-31&status=cleared";
      const sum = (rows: { amount: { amount: number } }[]) =>
        rows.reduce((total, row) => total + row.amount.amount, 0);
      expect(summary.moneyIn.amount).toBe(
        sum(await list(`${range}&kind=income`)),
      );
      expect(summary.moneyOut.amount).toBe(
        -sum(await list(`${range}&kind=expense`)),
      );
      const accountList = (await get("/accounts")).json().items as {
        balance: { amount: number };
      }[];
      expect(summary.netWorth.amount).toBe(
        accountList.reduce((total, row) => total + row.balance.amount, 0),
      );
      const people = (await get("/contacts?status=all")).json().items as {
        openBalance: { amount: number };
      }[];
      expect(summary.owed.total.amount).toBe(
        people.reduce((total, row) => total + row.openBalance.amount, 0),
      );
      expect(summary.latest.map((row) => row.transaction.id)).toEqual(
        (await get("/transactions?limit=100"))
          .json()
          .items.filter(
            (row: { kind: string; amount: { amount: number } }) =>
              !(row.kind === "transfer" && row.amount.amount > 0),
          )
          .slice(0, 5)
          .map((row: { id: string }) => row.id),
      );
    };
    await check();
    const created = await entry(cash, -3300, "2026-10-20");
    await check();
    expect((await home()).moneyOut.amount).toBe(14775 + 3300);
    const edited = await send(
      `/transactions/${created.id}`,
      { amount: money(-1000), expectedVersion: created.version },
      "PATCH",
    );
    await check();
    expect((await home()).moneyOut.amount).toBe(14775 + 1000);
    const deleted = await app.inject({
      url: `${base()}/transactions/${created.id}`,
      method: "DELETE",
      headers: headers(),
      payload: JSON.stringify({ expectedVersion: edited.version }),
    });
    expect(deleted.statusCode).toBe(204);
    await check();
    expect((await home()).moneyOut.amount).toBe(14775);
    const restored = await send(`/transactions/${created.id}/restore`, {
      expectedVersion: edited.version + 1,
    });
    expect(restored.id).toBe(created.id);
    await check();
    // Clearing the pending entry moves it into balances and spending.
    const pending = (await get("/transactions?status=pending")).json().items[0];
    await send(
      `/transactions/${pending.id}`,
      { status: "cleared", expectedVersion: pending.version },
      "PATCH",
    );
    await check();
    const after = await home();
    expect(after.pendingCount).toBe(0);
    expect(after.moneyOut.amount).toBe(14775 + 1000 + 2000);
  });

  it("matches an independent reference calculation over a seeded random sequence", async () => {
    const a = await seedAccounts();
    const c = await seedCategories();
    [checking, cash, food, services] = [a.checking, a.cash, c.food, c.services];
    let seed = 20261008;
    const next = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % n;
    };
    const model: {
      id: string;
      version: number;
      account: string;
      amount: number;
      date: string;
      pending: boolean;
      deleted: boolean;
    }[] = [];
    for (let i = 0; i < 40; i++) {
      const action = next(4);
      if (action < 2 || model.length === 0) {
        const amount = (next(2) ? 1 : -1) * (1 + next(50000));
        const day = String(1 + next(31)).padStart(2, "0");
        const month = ["2026-09", "2026-10", "2026-11"][next(3)] as string;
        const date =
          `${month}-${month === "2026-09" ? Math.min(30, Number(day)) : day}`.replace(
            /-(\d)$/,
            "-0$1",
          );
        const account = next(2) ? checking : cash;
        const pending = next(5) === 0;
        const row = await entry(account, amount, date, {
          status: pending ? "pending" : "cleared",
        });
        model.push({
          id: row.id,
          version: row.version,
          account,
          amount,
          date,
          pending,
          deleted: false,
        });
      } else {
        const row = model[next(model.length)] as (typeof model)[number];
        if (row.deleted) continue;
        if (action === 2) {
          const r = await send(
            `/transactions/${row.id}`,
            { status: "cleared", expectedVersion: row.version },
            "PATCH",
          );
          row.version = r.version;
          row.pending = false;
        } else {
          const r = await app.inject({
            url: `${base()}/transactions/${row.id}`,
            method: "DELETE",
            headers: headers(),
            payload: JSON.stringify({ expectedVersion: row.version }),
          });
          expect(r.statusCode).toBe(204);
          row.deleted = true;
        }
      }
    }
    const live = model.filter((row) => !row.deleted);
    const cleared = live.filter((row) => !row.pending);
    const sum = (rows: typeof live) =>
      rows.reduce((total, row) => total + row.amount, 0);
    const inMonth = cleared.filter(
      (row) => row.date >= "2026-10-01" && row.date <= "2026-10-31",
    );
    const summary = await home();
    expect(summary.netWorth.amount).toBe(
      100000 + 20000 - 30000 + 50000 + sum(cleared),
    );
    expect(summary.moneyIn.amount).toBe(
      sum(inMonth.filter((r) => r.amount > 0)),
    );
    expect(summary.moneyOut.amount).toBe(
      -sum(inMonth.filter((r) => r.amount < 0)),
    );
    expect(summary.pendingCount).toBe(live.filter((r) => r.pending).length);
  });

  it("itemizes the first eight active accounts and rolls up the rest", async () => {
    await seedCategories();
    const made: string[] = [];
    for (let i = 0; i < 10; i++) {
      const id = newId();
      made.push(id);
      await db.insert(accounts).values({
        id,
        ledgerId,
        name: `Account ${i}`,
        type: "bank",
        openingBalance: 100 * (i + 1),
      });
    }
    const summary = await home();
    expect(summary.accounts).toHaveLength(8);
    expect(summary.otherActive).toEqual({
      count: 2,
      balance: money(900 + 1000),
    });
    expect(summary.netWorth.amount).toBe(5500);
    expect(
      summary.accounts.reduce((t, r) => t + r.balance.amount, 0) +
        summary.otherActive.balance.amount +
        summary.archived.balance.amount,
    ).toBe(summary.netWorth.amount);
  });

  it("counts only positive balances of active bank, cash, wallet and savings accounts as in hand", async () => {
    const add = (
      name: string,
      type: "bank" | "cash" | "card" | "wallet" | "loan" | "savings",
      openingBalance: number,
      extra: { archivedAt?: Date } = {},
    ) =>
      db.insert(accounts).values({
        id: newId(),
        ledgerId,
        name,
        type,
        openingBalance,
        ...extra,
      });
    await add("Checking", "bank", 100000);
    await add("Overdrawn", "bank", -2500);
    await add("Cash", "cash", 4000);
    await add("Wallet", "wallet", 1500);
    await add("Rainy day", "savings", 20000);
    await add("Old savings", "savings", 7000, { archivedAt: new Date() });
    await add("Visa", "card", -30000);
    await add("Card in credit", "card", 500);
    await add("Store instalment loan", "loan", -12000);
    await add("Friend loan", "loan", 6000);
    const summary = await home();
    // 100000 + 4000 + 1500 + 20000; overdrawn, archived, cards and loans are excluded.
    expect(summary.inHand).toEqual(money(125500));
    expect(summary.accounts.map((row) => row.name).sort()).toEqual([
      "Cash",
      "Checking",
      "Overdrawn",
      "Rainy day",
      "Wallet",
    ]);
    expect(
      summary.accounts.every((row) => !["card", "loan"].includes(row.type)),
    ).toBe(true);
    expect(summary.archived).toEqual({ count: 1, balance: money(7000) });
    // Net worth is unchanged by this feature: every account, signed, archived included.
    expect(summary.netWorth.amount).toBe(
      100000 - 2500 + 4000 + 1500 + 20000 + 7000 - 30000 + 500 - 12000 + 6000,
    );
    // Only negative card and loan balances count as owed.
    expect(summary.liabilitiesOwed).toEqual(money(30000 + 12000));
  });

  it("reports setup state and zero totals for an empty ledger", async () => {
    const summary = await home("2026-10", emptyLedger);
    expect(summary).toMatchObject({
      inHand: money(0),
      netWorth: money(0),
      liabilitiesOwed: money(0),
      moneyIn: money(0),
      moneyOut: money(0),
      owed: { total: money(0), personCount: 0 },
      latest: [],
      accounts: [],
      pendingCount: 0,
      setup: { hasActiveAccount: false, hasCategory: false },
    });
  });

  it("returns a conflict instead of an inexact total", async () => {
    for (let i = 0; i < 2; i++)
      await db.insert(accounts).values({
        id: newId(),
        ledgerId,
        name: `Big ${i}`,
        type: "bank",
        openingBalance: Number.MAX_SAFE_INTEGER - 10,
      });
    const response = await get("/home?month=2026-10");
    expect(response.statusCode).toBe(409);
    expect(response.headers["content-type"]).toContain("problem+json");
  });

  it("validates the month and enforces authentication, membership and isolation", async () => {
    for (const month of ["", "2026-13", "2026-1", "0000-01", "abc"]) {
      const r = await get(`/home?month=${month}`);
      expect(r.statusCode, month).toBe(400);
    }
    expect((await get("/home")).statusCode).toBe(400);
    expect(
      (await app.inject({ url: `${base()}/home?month=2026-10` })).statusCode,
    ).toBe(401);
    for (const index of [0, 1, 2])
      expect(
        (await get("/home?month=2026-10", ledgerId, cookies[index])).statusCode,
      ).toBe(200);
    expect((await get("/home?month=2026-10", newId())).statusCode).toBe(404);
    // Another ledger's data never appears.
    await fixture();
    const other = await seedAccounts(otherLedger);
    expect(other.checking).toBeTruthy();
    const otherSummary = await home("2026-10", otherLedger);
    expect(otherSummary.netWorth.amount).toBe(140000);
    // The other ledger's own In hand: Checking 100000 + Cash 20000 (card and archived savings excluded).
    expect(otherSummary.inHand.amount).toBe(120000);
    expect(otherSummary.liabilitiesOwed.amount).toBe(30000);
    expect(otherSummary.moneyIn.amount).toBe(0);
    expect(otherSummary.latest).toEqual([]);
    expect(otherSummary.owed.total.amount).toBe(0);
    const viewerView = await get("/home?month=2026-10", ledgerId, cookies[2]);
    expect(viewerView.json().netWorth.amount).toBe(388725);
    expect(viewerView.json().inHand.amount).toBe(377725);
  });

  it("documents the endpoint in OpenAPI", async () => {
    const doc = (await app.inject({ url: "/api/v1/openapi.json" })).json();
    expect(doc.paths["/api/v1/ledgers/{ledgerId}/home"].get).toBeTruthy();
  });
});
