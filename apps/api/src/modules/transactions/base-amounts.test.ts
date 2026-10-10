import {
  allocateBaseAmounts,
  type BudgetMonthView,
  newId,
  transactionSchema,
} from "@ledgerline/shared";
import { inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../../app";
import { readConfig } from "../../config";
import { createDatabase, type Database } from "../../db/client";
import { applyMigrations } from "../../db/migrate";
import {
  accounts,
  budgets,
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
import { getBudgetMonth } from "../budgets/service";
import { getHomeSummary } from "../home/service";
import { postedCategoryTotals } from "./balance-service";
import { transactionRepository } from "./repo";

const url = process.env.TEST_DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith("/ledgerline_test"))
  throw new Error(
    "Base amount tests require the dedicated ledgerline_test database.",
  );
const config = readConfig({
  NODE_ENV: "test",
  DATABASE_URL: url,
  APP_URL: "http://localhost:5173",
  BETTER_AUTH_SECRET: "base-amounts-test-secret-only-00000000000000",
  OWNER_EMAIL: "base-owner@example.com",
  OWNER_PASSWORD: "Base-amounts-test-password-000",
  OWNER_NAME: "Base owner",
});
const { db, pool } = createDatabase(url);
const app = await buildApp(db, config);
const ledgerId = newId();
const ownerId = newId();
const accountId = newId();
const food = newId();
const rent = newId();
const salary = newId();
let cookie = "";
const month = "2026-10";

class Rollback extends Error {}
/** Run `work` in a transaction that is always rolled back, with the USD-only check removed. */
async function withForeignRows<T>(
  work: (tx: Database) => Promise<T>,
): Promise<T> {
  let result: T | undefined;
  try {
    await db.transaction(async (tx) => {
      await tx.execute(
        sql`ALTER TABLE transactions DROP CONSTRAINT transactions_usd_check`,
      );
      result = await work(tx as unknown as Database);
      throw new Rollback();
    });
  } catch (failure) {
    if (!(failure instanceof Rollback)) throw failure;
  }
  return result as T;
}
const base = {
  ledgerId,
  accountId,
  date: "2026-10-05",
  status: "cleared" as const,
};
async function signIn() {
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/auth/sign-in/email",
    headers: { origin: config.APP_URL },
    payload: {
      email: `base-owner-${ownerId}@example.com`,
      password: config.OWNER_PASSWORD,
    },
  });
  expect(response.statusCode).toBe(200);
  const header = response.headers["set-cookie"];
  return (Array.isArray(header) ? header : [header ?? ""])
    .map((value) => value.split(";")[0])
    .join("; ");
}
async function clearRows() {
  await db.transaction(async (tx) => {
    await tx
      .delete(transactionSplits)
      .where(inArray(transactionSplits.ledgerId, [ledgerId]));
    await tx
      .delete(transactions)
      .where(inArray(transactions.ledgerId, [ledgerId]));
  });
  await db.delete(budgets).where(inArray(budgets.ledgerId, [ledgerId]));
  await db
    .delete(writeReceipts)
    .where(inArray(writeReceipts.ledgerId, [ledgerId]));
}
beforeAll(async () => {
  await applyMigrations(url);
  await db
    .insert(ledgers)
    .values({ id: ledgerId, name: "Synthetic base ledger" });
  await db.insert(user).values({
    id: ownerId,
    name: "owner",
    email: `base-owner-${ownerId}@example.com`,
  });
  await db.insert(credentials).values({
    userId: ownerId,
    accountId: ownerId,
    providerId: "credential",
    password: await hashPassword(config.OWNER_PASSWORD),
  });
  await db
    .insert(ledgerMembers)
    .values({ userId: ownerId, ledgerId, role: "owner" });
  await db.insert(categories).values([
    { id: food, ledgerId, name: "Food", kind: "expense", sortOrder: 0 },
    { id: rent, ledgerId, name: "Rent", kind: "expense", sortOrder: 1 },
    { id: salary, ledgerId, name: "Salary", kind: "income", sortOrder: 0 },
  ]);
  await db.insert(accounts).values({
    id: accountId,
    ledgerId,
    name: "Cash",
    type: "cash",
    openingBalance: 0,
  });
  await app.ready();
  cookie = await signIn();
});
beforeEach(clearRows);
afterAll(async () => {
  await app.close();
  await clearRows();
  await db.delete(accounts).where(inArray(accounts.ledgerId, [ledgerId]));
  await db.delete(categories).where(inArray(categories.ledgerId, [ledgerId]));
  await db.delete(session).where(inArray(session.userId, [ownerId]));
  await db.delete(credentials).where(inArray(credentials.userId, [ownerId]));
  await db
    .delete(ledgerMembers)
    .where(inArray(ledgerMembers.ledgerId, [ledgerId]));
  await db.delete(ledgers).where(inArray(ledgers.id, [ledgerId]));
  await db.delete(user).where(inArray(user.id, [ownerId]));
  await pool.end();
});

describe("totals read the frozen base amount", () => {
  it("sums money in, money out, category totals and budget spending in the base currency", async () => {
    const seen = await withForeignRows(async (tx) => {
      // 100.00 EUR at 1.1217 = 112.17 USD; salary of 1000.00 EUR = 1121.70 USD.
      await tx.insert(transactions).values([
        {
          ...base,
          categoryId: food,
          kind: "expense",
          amount: -10000,
          currency: "EUR",
          fxRate: 1.1217,
          baseAmount: -11217,
        },
        {
          ...base,
          categoryId: salary,
          kind: "income",
          amount: 100000,
          currency: "EUR",
          fxRate: 1.1217,
          baseAmount: 112170,
        },
        {
          ...base,
          categoryId: rent,
          kind: "expense",
          amount: -5000,
          baseAmount: -5000,
        },
        // Pending entries never count.
        {
          ...base,
          categoryId: food,
          kind: "expense",
          status: "pending",
          amount: -9999,
          currency: "EUR",
          fxRate: 1.1217,
          baseAmount: -11200,
        },
      ]);
      await tx.insert(budgets).values({
        ledgerId,
        categoryId: food,
        month: "2026-10-01",
        amount: 50000,
      });
      // Home's money in and out come from this query; its "latest" list needs the wider
      // currency schema that step 2b-3 adds, so it is not exercised with foreign rows here.
      const flow = await transactionRepository(tx, ledgerId).monthFlow(
        "2026-10-01",
        "2026-10-31",
      );
      const view = await getBudgetMonth(tx, ownerId, ledgerId, month);
      const totals = await postedCategoryTotals(
        tx,
        ledgerId,
        "2026-10-01",
        "2026-10-31",
      );
      return { flow, view, totals };
    });
    const flowOf = (kind: string) =>
      BigInt(seen.flow.find((row) => row.kind === kind)?.total ?? "0");
    expect(flowOf("expense")).toBe(-BigInt(11217 + 5000));
    expect(flowOf("income")).toBe(112170n);
    const view: BudgetMonthView = seen.view;
    const foodLine = view.items.find((item) => item.categoryId === food);
    expect(foodLine?.spent.amount).toBe(11217);
    expect(foodLine?.left?.amount).toBe(50000 - 11217);
    expect(seen.totals.get(food)).toBe(-11217n);
    expect(seen.totals.get(salary)).toBe(112170n);
    expect(seen.totals.get(rent)).toBe(-5000n);
  });

  it("counts a split entry by its lines' base amounts, which add up to the parent's", async () => {
    const lines = [-3333, -3333, -3334];
    const bases = allocateBaseAmounts(-10000, -11217, lines);
    const seen = await withForeignRows(async (tx) => {
      const parentId = newId();
      await tx.insert(transactions).values({
        ...base,
        id: parentId,
        categoryId: null,
        kind: "expense",
        isSplit: true,
        amount: -10000,
        currency: "EUR",
        fxRate: 1.1217,
        baseAmount: -11217,
      });
      await tx.insert(transactionSplits).values(
        lines.map((amount, position) => ({
          ledgerId,
          transactionId: parentId,
          categoryId: position === 2 ? rent : food,
          kind: "expense" as const,
          amount,
          baseAmount: bases[position] as number,
          position,
        })),
      );
      await tx.execute(sql`SET CONSTRAINTS ALL IMMEDIATE`);
      const view = await getBudgetMonth(tx, ownerId, ledgerId, month);
      const flow = await transactionRepository(tx, ledgerId).monthFlow(
        "2026-10-01",
        "2026-10-31",
      );
      return { view, flow };
    });
    const spent = (id: string) =>
      seen.view.items.find((item) => item.categoryId === id)?.spent.amount;
    expect(spent(food)).toBe(-((bases[0] as number) + (bases[1] as number)));
    expect(spent(rent)).toBe(-(bases[2] as number));
    expect((spent(food) as number) + (spent(rent) as number)).toBe(11217);
    expect(
      BigInt(seen.flow.find((row) => row.kind === "expense")?.total ?? "0"),
    ).toBe(-11217n);
  });

  it("refuses a split whose base amounts do not add up to the parent's", async () => {
    await expect(
      withForeignRows(async (tx) => {
        const parentId = newId();
        await tx.insert(transactions).values({
          ...base,
          id: parentId,
          categoryId: null,
          kind: "expense",
          isSplit: true,
          amount: -10000,
          currency: "EUR",
          fxRate: 1.1217,
          baseAmount: -11217,
        });
        await tx.insert(transactionSplits).values(
          [-5000, -5000].map((amount, position) => ({
            ledgerId,
            transactionId: parentId,
            categoryId: food,
            kind: "expense" as const,
            amount,
            baseAmount: -5000,
            position,
          })),
        );
        await tx.execute(sql`SET CONSTRAINTS ALL IMMEDIATE`);
      }),
    ).rejects.toThrow();
  });
});

describe("USD results are unchanged", () => {
  it("writes each split line's base amount equal to its amount through the API", async () => {
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/ledgers/${ledgerId}/transactions`,
      headers: {
        "content-type": "application/json",
        cookie,
        origin: config.APP_URL,
        "idempotency-key": newId(),
      },
      payload: JSON.stringify({
        accountId,
        categoryId: null,
        kind: "expense",
        date: "2026-10-05",
        amount: { amount: -3000, currency: "USD" },
        splits: [
          {
            categoryId: food,
            amount: { amount: -1000, currency: "USD" },
            note: null,
          },
          {
            categoryId: rent,
            amount: { amount: -2000, currency: "USD" },
            note: null,
          },
        ],
      }),
    });
    expect(response.statusCode).toBe(201);
    const created = transactionSchema.parse(response.json());
    expect(created.fxRate).toBe(1);
    expect(created.baseAmount.amount).toBe(-3000);
    const lines = await db
      .select()
      .from(transactionSplits)
      .where(inArray(transactionSplits.transactionId, [created.id]));
    expect(lines.map((line) => [line.amount, line.baseAmount])).toEqual(
      expect.arrayContaining([
        [-1000, -1000],
        [-2000, -2000],
      ]),
    );
    const home = await getHomeSummary(db, ownerId, ledgerId, month);
    const view = await getBudgetMonth(db, ownerId, ledgerId, "2026-10");
    expect(home.moneyOut.amount).toBe(3000);
    expect(
      view.items.find((item) => item.categoryId === food)?.spent.amount,
    ).toBe(1000);
    expect(
      view.items.find((item) => item.categoryId === rent)?.spent.amount,
    ).toBe(2000);
  });
});
