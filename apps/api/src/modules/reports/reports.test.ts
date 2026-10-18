import {
  cashFlowReportSchema,
  homeSummarySchema,
  newId,
  spendingReportSchema,
} from "@ledgerline/shared";
import { inArray } from "drizzle-orm";
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
  transactionSplits,
  transactions,
  user,
  writeReceipts,
} from "../../db/schema";
import {
  requireTestDatabase,
  signInCookie,
  testConfig,
} from "../../test-support/harness";
import { hashPassword } from "../auth/password";

const url = requireTestDatabase("Reports tests");
const config = testConfig(url, "reports");
const { db, pool } = createDatabase(url);
const app = await buildApp(db, config);
const ledgerId = newId();
const otherLedger = newId();
const ids = [ledgerId, otherLedger];
const users = [newId(), newId(), newId()];
const roles = ["owner", "editor", "viewer"] as const;
let cookies: string[] = [];
const money = (amount: number) => ({ amount, currency: "USD" });
const base = (ledger = ledgerId) => `/api/v1/ledgers/${ledger}`;
const get = (path: string, ledger = ledgerId, cookie = cookies[0] as string) =>
  app.inject({ url: base(ledger) + path, headers: { cookie } });
async function send(
  path: string,
  body: unknown,
  method: "POST" | "DELETE" = "POST",
  ledger = ledgerId,
) {
  const response = await app.inject({
    url: base(ledger) + path,
    method,
    headers: {
      cookie: cookies[0] as string,
      origin: config.APP_URL,
      "idempotency-key": newId(),
      "content-type": "application/json",
    },
    payload: JSON.stringify(body),
  });
  expect(response.statusCode, response.body).toBeLessThan(300);
  return response.body ? response.json() : undefined;
}
const spending = async (month = "2026-10", ledger = ledgerId) => {
  const response = await get(`/reports/spending?month=${month}`, ledger);
  expect(response.statusCode, response.body).toBe(200);
  return spendingReportSchema.parse(response.json());
};
const cashFlow = async (query: string, ledger = ledgerId) => {
  const response = await get(`/reports/cash-flow?${query}`, ledger);
  expect(response.statusCode, response.body).toBe(200);
  return cashFlowReportSchema.parse(response.json());
};

async function clear() {
  await db.transaction(async (tx) => {
    await tx
      .delete(transactionSplits)
      .where(inArray(transactionSplits.ledgerId, ids));
    await tx.delete(transactions).where(inArray(transactions.ledgerId, ids));
  });
  await db.delete(categories).where(inArray(categories.ledgerId, ids));
  await db.delete(accounts).where(inArray(accounts.ledgerId, ids));
  await db.delete(writeReceipts).where(inArray(writeReceipts.ledgerId, ids));
}

type Setup = {
  checking: string;
  savings: string;
  food: string;
  groceries: string;
  fun: string;
  salary: string;
};
async function seed(ledger = ledgerId): Promise<Setup> {
  const account = async (name: string, openingBalance: number) => {
    const id = newId();
    await db.insert(accounts).values({
      id,
      ledgerId: ledger,
      name,
      type: "bank",
      openingBalance,
    });
    return id;
  };
  const category = async (
    name: string,
    kind: "expense" | "income",
    parentId: string | null = null,
  ) => {
    const id = newId();
    await db
      .insert(categories)
      .values({ id, ledgerId: ledger, name, kind, parentId });
    return id;
  };
  const food = await category("Food", "expense");
  return {
    checking: await account("Checking", 100000),
    savings: await account("Savings", 0),
    food,
    groceries: await category("Groceries", "expense", food),
    fun: await category("Fun", "expense"),
    salary: await category("Salary", "income"),
  };
}
const entry = (
  ledger: string,
  setup: Setup,
  categoryId: string,
  amount: number,
  date: string,
  extra: Record<string, unknown> = {},
) =>
  send(
    "/transactions",
    {
      accountId: setup.checking,
      categoryId,
      kind: amount < 0 ? "expense" : "income",
      date,
      amount: money(amount),
      ...extra,
    },
    "POST",
    ledger,
  );
/** Hand-checked October 2026: Food 1000 + Groceries 3000 + a split of 6000 Groceries and 3000 Fun, plus Fun 2500. */
async function fixture() {
  const s = await seed();
  await entry(ledgerId, s, s.salary, 250000, "2026-10-01");
  await entry(ledgerId, s, s.food, -1000, "2026-10-02");
  await entry(ledgerId, s, s.groceries, -3000, "2026-10-03");
  await entry(ledgerId, s, s.fun, -2500, "2026-10-04");
  await send("/transactions", {
    accountId: s.checking,
    categoryId: null,
    kind: "expense",
    date: "2026-10-05",
    amount: money(-9000),
    splits: [
      { categoryId: s.groceries, amount: money(-6000), note: null },
      { categoryId: s.fun, amount: money(-3000), note: null },
    ],
  });
  await send("/transfers", {
    fromAccountId: s.checking,
    toAccountId: s.savings,
    amount: money(5000),
    date: "2026-10-06",
  });
  await entry(ledgerId, s, s.fun, -2000, "2026-10-07", { status: "pending" });
  await entry(ledgerId, s, s.fun, -700, "2026-09-30");
  await entry(ledgerId, s, s.fun, -800, "2026-11-01");
  const gone = await entry(ledgerId, s, s.fun, -99999, "2026-10-08");
  await send(
    `/transactions/${gone.id}`,
    { expectedVersion: gone.version },
    "DELETE",
  );
  return s;
}

beforeAll(async () => {
  await applyMigrations(url);
  await db
    .insert(ledgers)
    .values(ids.map((id) => ({ id, name: "Synthetic Reports suite" })));
  const password = await hashPassword(config.OWNER_PASSWORD);
  for (const [i, role] of roles.entries()) {
    const id = users[i] as string;
    await db
      .insert(user)
      .values({ id, name: role, email: `reports-${role}-${id}@example.com` });
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
        `reports-${role}-${users[i]}@example.com`,
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

describe("spending report", () => {
  it("groups cleared spending by category with subcategories rolled up", async () => {
    const s = await fixture();
    const report = await spending();
    expect(report).toMatchObject({
      month: "2026-10",
      monthStart: "2026-10-01",
      monthEnd: "2026-10-31",
      total: money(15500),
    });
    // Food 1000 + Groceries (3000 + split 6000); Fun 2500 + split 3000. Pending, deleted, other-month and transfer rows stay out.
    expect(
      report.categories.map((row) => [row.categoryId, row.amount.amount]),
    ).toEqual([
      [s.food, 10000],
      [s.fun, 5500],
    ]);
    expect(report.categories.map((row) => row.shareBps)).toEqual([6452, 3548]);
    expect(report.categories[0]?.children).toMatchObject([
      { categoryId: s.groceries, name: "Groceries", shareBps: 5806 },
    ]);
    expect(report.categories[0]?.children[0]?.amount).toEqual(money(9000));
    expect(report.categories[1]?.children).toEqual([]);
  });

  it("matches Home's spending for the same month", async () => {
    await fixture();
    const report = await spending();
    const homeResponse = await get("/home?month=2026-10");
    const home = homeSummarySchema.parse(homeResponse.json());
    expect(report.total).toEqual(home.moneyOut);
  });

  it("is empty for a month with no spending", async () => {
    await fixture();
    expect(await spending("2026-01")).toMatchObject({
      total: money(0),
      categories: [],
    });
  });

  it("keeps an archived category's past spending", async () => {
    const s = await fixture();
    await db
      .update(categories)
      .set({ archivedAt: new Date() })
      .where(inArray(categories.id, [s.fun]));
    const report = await spending();
    expect(
      report.categories.find((row) => row.categoryId === s.fun),
    ).toMatchObject({
      archived: true,
      amount: money(5500),
    });
  });

  it("never includes another ledger's rows and hides that ledger", async () => {
    await fixture();
    const other = await seed(otherLedger);
    await entry(otherLedger, other, other.fun, -123456, "2026-10-09");
    expect((await spending()).total).toEqual(money(15500));
    expect((await spending("2026-10", otherLedger)).total).toEqual(
      money(123456),
    );
    const denied = await get(
      "/reports/spending?month=2026-10",
      otherLedger,
      cookies[1],
    );
    expect(denied.statusCode).toBe(404);
  });

  it("allows a viewer, rejects anonymous and invalid months", async () => {
    await fixture();
    const viewer = await get(
      "/reports/spending?month=2026-10",
      ledgerId,
      cookies[2],
    );
    expect(viewer.statusCode).toBe(200);
    const anonymous = await app.inject({
      url: `${base()}/reports/spending?month=2026-10`,
    });
    expect(anonymous.statusCode).toBe(401);
    for (const query of ["", "?month=2026-13", "?month=10-2026"])
      expect((await get(`/reports/spending${query}`)).statusCode).toBe(400);
  });
});

describe("cash flow report", () => {
  it("lists each month oldest first with empty months as zeros", async () => {
    await fixture();
    const report = await cashFlow("to=2026-10&months=3");
    expect(report.from).toBe("2026-08");
    expect(report.to).toBe("2026-10");
    expect(report.months).toEqual([
      { month: "2026-08", income: money(0), spending: money(0), net: money(0) },
      {
        month: "2026-09",
        income: money(0),
        spending: money(700),
        net: money(-700),
      },
      {
        month: "2026-10",
        income: money(250000),
        spending: money(15500),
        net: money(234500),
      },
    ]);
  });

  it("matches Home's money in and out, and crosses a year boundary", async () => {
    await fixture();
    const home = homeSummarySchema.parse(
      (await get("/home?month=2026-10")).json(),
    );
    const october = (await cashFlow("to=2026-10&months=1")).months[0];
    expect(october?.income).toEqual(home.moneyIn);
    expect(october?.spending).toEqual(home.moneyOut);
    const span = await cashFlow("to=2027-02&months=5");
    expect(span.months.map((row) => row.month)).toEqual([
      "2026-10",
      "2026-11",
      "2026-12",
      "2027-01",
      "2027-02",
    ]);
    expect(span.months[1]?.spending).toEqual(money(800));
  });

  it("defaults to twelve months and limits the range", async () => {
    await fixture();
    expect((await cashFlow("to=2026-10")).months).toHaveLength(12);
    for (const query of [
      "to=2026-10&months=0",
      "to=2026-10&months=25",
      "months=3",
    ])
      expect((await get(`/reports/cash-flow?${query}`)).statusCode).toBe(400);
  });

  it("never includes another ledger's rows and hides that ledger", async () => {
    await fixture();
    const other = await seed(otherLedger);
    await entry(otherLedger, other, other.fun, -123456, "2026-10-09");
    expect((await cashFlow("to=2026-10&months=1")).months[0]?.spending).toEqual(
      money(15500),
    );
    const denied = await get(
      "/reports/cash-flow?to=2026-10&months=1",
      otherLedger,
      cookies[1],
    );
    expect(denied.statusCode).toBe(404);
    const anonymous = await app.inject({
      url: `${base()}/reports/cash-flow?to=2026-10`,
    });
    expect(anonymous.statusCode).toBe(401);
  });
});
