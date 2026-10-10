import {
  type Budget,
  type BudgetMonthView,
  budgetMonthSchemaView,
  budgetSchema,
  newId,
} from "@ledgerline/shared";
import { inArray } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../../app";
import { readConfig } from "../../config";
import { createDatabase } from "../../db/client";
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

const url = process.env.TEST_DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith("/ledgerline_test"))
  throw new Error(
    "Budget tests require the dedicated ledgerline_test database.",
  );
const config = readConfig({
  NODE_ENV: "test",
  DATABASE_URL: url,
  APP_URL: "http://localhost:5173",
  BETTER_AUTH_SECRET: "budgets-test-secret-only-0000000000000000000",
  OWNER_EMAIL: "budgets-owner@example.com",
  OWNER_PASSWORD: "Budgets-test-password-000",
  OWNER_NAME: "Budgets owner",
});
const { db, pool } = createDatabase(url);
const app = await buildApp(db, config);
const ledgerId = newId();
const foreignLedger = newId();
const fixtureLedgers = [ledgerId, foreignLedger];
const fixtureUsers = [newId(), newId(), newId()];
let ownerCookie = "";
let editorCookie = "";
let viewerCookie = "";
const accountId = newId();
const foreignAccountId = newId();
const food = newId();
const groceries = newId();
const rent = newId();
const salary = newId();
const foreignFood = newId();
const baseUrl = (ledger = ledgerId) => `/api/v1/ledgers/${ledger}/budgets`;
const headers = (cookie = ownerCookie, key = newId()) => ({
  "content-type": "application/json",
  cookie,
  origin: config.APP_URL,
  "idempotency-key": key,
});
const usd = (amount: number) => ({ amount, currency: "USD" });
const put = (
  payload: unknown,
  ledger = ledgerId,
  cookie = ownerCookie,
  key = newId(),
) =>
  app.inject({
    method: "PUT",
    url: baseUrl(ledger),
    headers: headers(cookie, key),
    payload: JSON.stringify(payload),
  });
const setBudget = (
  categoryId: string,
  month: string,
  amount: number,
  rollover = false,
  expectedVersion?: number,
) =>
  put({
    categoryId,
    month,
    amount: usd(amount),
    rollover,
    ...(expectedVersion === undefined ? {} : { expectedVersion }),
  });
const monthView = async (
  month: string,
  ledger = ledgerId,
  cookie = ownerCookie,
) => {
  const response = await app.inject({
    url: `${baseUrl(ledger)}?month=${month}`,
    headers: { cookie },
  });
  expect(response.statusCode).toBe(200);
  return budgetMonthSchemaView.parse(response.json());
};
const line = (view: BudgetMonthView, categoryId: string) => {
  const found = view.items.find((item) => item.categoryId === categoryId);
  if (!found) throw new Error("Missing budget line");
  return found;
};
async function spend(
  amount: number,
  date: string,
  categoryId: string,
  extra: Partial<typeof transactions.$inferInsert> = {},
) {
  const id = newId();
  await db.insert(transactions).values({
    id,
    ledgerId,
    accountId,
    categoryId,
    kind: "expense",
    date,
    amount: -amount,
    baseAmount: -amount,
    ...extra,
  });
  return id;
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
async function clearRows() {
  // The split integrity check is deferred, so lines and parents go in one transaction.
  await db.transaction(async (tx) => {
    await tx
      .delete(transactionSplits)
      .where(inArray(transactionSplits.ledgerId, fixtureLedgers));
    await tx
      .delete(transactions)
      .where(inArray(transactions.ledgerId, fixtureLedgers));
  });
  await db.delete(budgets).where(inArray(budgets.ledgerId, fixtureLedgers));
  await db
    .delete(writeReceipts)
    .where(inArray(writeReceipts.ledgerId, fixtureLedgers));
}
beforeAll(async () => {
  await applyMigrations(url);
  await db
    .insert(ledgers)
    .values(
      fixtureLedgers.map((id) => ({ id, name: "Synthetic budgets ledger" })),
    );
  const password = await hashPassword(config.OWNER_PASSWORD);
  for (const [index, role] of (
    ["owner", "editor", "viewer"] as const
  ).entries()) {
    const id = fixtureUsers[index] ?? "";
    await db
      .insert(user)
      .values({ id, name: role, email: `budgets-${role}-${id}@example.com` });
    await db.insert(credentials).values({
      userId: id,
      accountId: id,
      providerId: "credential",
      password,
    });
    await db.insert(ledgerMembers).values({ userId: id, ledgerId, role });
  }
  await db.insert(categories).values([
    { id: food, ledgerId, name: "Food", kind: "expense", sortOrder: 0 },
    {
      id: groceries,
      ledgerId,
      parentId: food,
      name: "Groceries",
      kind: "expense",
      sortOrder: 0,
    },
    { id: rent, ledgerId, name: "Rent", kind: "expense", sortOrder: 1 },
    { id: salary, ledgerId, name: "Salary", kind: "income", sortOrder: 0 },
    {
      id: foreignFood,
      ledgerId: foreignLedger,
      name: "Foreign food",
      kind: "expense",
      sortOrder: 0,
    },
  ]);
  await db.insert(accounts).values([
    { id: accountId, ledgerId, name: "Cash", type: "cash", openingBalance: 0 },
    {
      id: foreignAccountId,
      ledgerId: foreignLedger,
      name: "Foreign cash",
      type: "cash",
      openingBalance: 0,
    },
  ]);
  await app.ready();
  ownerCookie = await signIn(`budgets-owner-${fixtureUsers[0]}@example.com`);
  editorCookie = await signIn(`budgets-editor-${fixtureUsers[1]}@example.com`);
  viewerCookie = await signIn(`budgets-viewer-${fixtureUsers[2]}@example.com`);
});
beforeEach(clearRows);
afterAll(async () => {
  await app.close();
  await clearRows();
  await db.delete(accounts).where(inArray(accounts.ledgerId, fixtureLedgers));
  await db
    .delete(categories)
    .where(inArray(categories.ledgerId, fixtureLedgers));
  await db.delete(session).where(inArray(session.userId, fixtureUsers));
  await db.delete(credentials).where(inArray(credentials.userId, fixtureUsers));
  await db
    .delete(ledgerMembers)
    .where(inArray(ledgerMembers.ledgerId, fixtureLedgers));
  await db.delete(ledgers).where(inArray(ledgers.id, fixtureLedgers));
  await db.delete(user).where(inArray(user.id, fixtureUsers));
  await pool.end();
});

describe("budget month view", () => {
  it("lists top-level expense categories with nothing budgeted", async () => {
    const view = await monthView("2026-10");
    expect(view.items.map((item) => item.name)).toEqual(["Food", "Rent"]);
    expect(line(view, food).budget).toBeNull();
    expect(line(view, food).left).toBeNull();
    expect(view.totals.budgeted.amount).toBe(0);
  });

  it("counts cleared expenses, subcategories and split lines, and nothing else", async () => {
    expect((await setBudget(food, "2026-10", 50000)).statusCode).toBe(201);
    await spend(1200, "2026-10-03", food);
    await spend(800, "2026-10-04", groceries);
    await spend(9999, "2026-10-05", food, { status: "pending" });
    await spend(7777, "2026-09-30", food);
    await spend(6666, "2026-11-01", food);
    await spend(5555, "2026-10-06", rent);
    await db.insert(transactions).values({
      ledgerId,
      accountId,
      categoryId: salary,
      kind: "income",
      date: "2026-10-07",
      amount: 300000,
      baseAmount: 300000,
    });
    const splitId = newId();
    await db.transaction(async (tx) => {
      await tx.insert(transactions).values({
        id: splitId,
        ledgerId,
        accountId,
        categoryId: null,
        kind: "expense",
        isSplit: true,
        date: "2026-10-08",
        amount: -1500,
        baseAmount: -1500,
      });
      await tx.insert(transactionSplits).values([
        {
          ledgerId,
          transactionId: splitId,
          categoryId: groceries,
          kind: "expense",
          amount: -1000,
          position: 0,
        },
        {
          ledgerId,
          transactionId: splitId,
          categoryId: rent,
          kind: "expense",
          amount: -500,
          position: 1,
        },
      ]);
    });
    const view = await monthView("2026-10");
    expect(line(view, food).spent.amount).toBe(1200 + 800 + 1000);
    expect(line(view, food).left?.amount).toBe(50000 - 3000);
    expect(line(view, rent).spent.amount).toBe(5555 + 500);
    expect(line(view, rent).budget).toBeNull();
    expect(view.totals.spent.amount).toBe(3000);
    expect(view.totals.unbudgetedSpent.amount).toBe(6055);
  });

  it("carries leftovers and overspending forward only with rollover", async () => {
    await setBudget(food, "2026-08", 10000, true);
    await setBudget(food, "2026-09", 10000, true);
    await setBudget(food, "2026-10", 10000, true);
    await setBudget(rent, "2026-09", 10000, false);
    await setBudget(rent, "2026-10", 10000, false);
    await spend(4000, "2026-08-10", food);
    await spend(16000, "2026-09-10", food);
    await spend(1000, "2026-10-10", food);
    await spend(2000, "2026-09-10", rent);
    const view = await monthView("2026-10");
    // August leaves 6000; September has 10000 + 6000 - 16000 = 0; October carries 0.
    expect(line(view, food).carriedIn.amount).toBe(0);
    expect(line(view, food).left?.amount).toBe(9000);
    expect(line(await monthView("2026-09"), food).carriedIn.amount).toBe(6000);
    expect(line(view, rent).carriedIn.amount).toBe(0);
    await spend(25000, "2026-08-11", food);
    const overspent = await monthView("2026-10");
    // August is now 29000 over (-19000); September 10000 - 19000 - 16000 = -25000.
    expect(line(overspent, food).carriedIn.amount).toBe(-25000);
    expect(line(overspent, food).left?.amount).toBe(-16000);
  });

  it("recomputes later months when an earlier budget is removed", async () => {
    const august = budgetSchema.parse(
      (await setBudget(food, "2026-08", 10000, true)).json(),
    );
    await setBudget(food, "2026-09", 10000, true);
    expect(line(await monthView("2026-09"), food).carriedIn.amount).toBe(10000);
    const removed = await app.inject({
      method: "DELETE",
      url: `${baseUrl()}/${august.id}`,
      headers: headers(),
      payload: { expectedVersion: august.version },
    });
    expect(removed.statusCode).toBe(204);
    expect(line(await monthView("2026-09"), food).carriedIn.amount).toBe(0);
    expect(line(await monthView("2026-08"), food).budget).toBeNull();
  });
});

describe("setting budgets", () => {
  it("creates, edits with the version, and rejects stale edits and duplicates", async () => {
    const created = await setBudget(food, "2026-10", 20000, false);
    expect(created.statusCode).toBe(201);
    const budget: Budget = budgetSchema.parse(created.json());
    expect(budget.month).toBe("2026-10");
    expect(budget.amount).toEqual(usd(20000));
    expect((await setBudget(food, "2026-10", 1, false)).statusCode).toBe(409);
    const edited = await setBudget(food, "2026-10", 25000, true, 1);
    expect(edited.statusCode).toBe(200);
    expect(budgetSchema.parse(edited.json()).version).toBe(2);
    expect((await setBudget(food, "2026-10", 1, true, 1)).statusCode).toBe(409);
    expect((await setBudget(food, "2026-11", 1, true, 1)).statusCode).toBe(404);
  });

  it("replays the same key and rejects a changed request under it", async () => {
    const key = newId();
    const body = {
      categoryId: food,
      month: "2026-10",
      amount: usd(100),
      rollover: false,
    };
    const first = await put(body, ledgerId, ownerCookie, key);
    const again = await put(body, ledgerId, ownerCookie, key);
    expect(first.statusCode).toBe(201);
    expect(again.statusCode).toBe(201);
    expect(again.headers["idempotency-replayed"]).toBe("true");
    expect(again.json()).toEqual(first.json());
    const changed = await put(
      { ...body, amount: usd(200) },
      ledgerId,
      ownerCookie,
      key,
    );
    expect(changed.statusCode).toBe(409);
  });

  it("only budgets active top-level expense categories", async () => {
    expect((await setBudget(groceries, "2026-10", 100)).statusCode).toBe(409);
    expect((await setBudget(salary, "2026-10", 100)).statusCode).toBe(404);
    expect((await setBudget(newId(), "2026-10", 100)).statusCode).toBe(404);
    await db
      .update(categories)
      .set({ archivedAt: new Date() })
      .where(inArray(categories.id, [rent]));
    expect((await setBudget(rent, "2026-10", 100)).statusCode).toBe(409);
    await db
      .update(categories)
      .set({ archivedAt: null })
      .where(inArray(categories.id, [rent]));
  });

  it("validates amounts, months and unknown fields", async () => {
    const body = {
      categoryId: food,
      month: "2026-10",
      amount: usd(100),
      rollover: false,
    };
    for (const bad of [
      { ...body, amount: usd(-1) },
      { ...body, amount: { amount: 1.5, currency: "USD" } },
      { ...body, amount: { amount: 100, currency: "EUR" } },
      { ...body, month: "2026-13" },
      { ...body, extra: true },
    ])
      expect((await put(bad)).statusCode).toBe(400);
  });
});

describe("copying budgets", () => {
  it("copies into a month, skipping categories that already have a budget", async () => {
    await setBudget(food, "2026-09", 30000, true);
    await setBudget(rent, "2026-09", 90000, false);
    await setBudget(rent, "2026-10", 95000, false);
    const copied = await app.inject({
      method: "POST",
      url: `${baseUrl()}/copy`,
      headers: headers(),
      payload: { fromMonth: "2026-09", toMonth: "2026-10" },
    });
    expect(copied.statusCode).toBe(201);
    const items = (copied.json() as { items: Budget[] }).items;
    expect(items).toHaveLength(1);
    expect(items[0]?.categoryId).toBe(food);
    expect(items[0]?.rollover).toBe(true);
    const view = await monthView("2026-10");
    expect(line(view, rent).budget?.amount.amount).toBe(95000);
    expect(line(view, food).budget?.amount.amount).toBe(30000);
  });
});

describe("access", () => {
  it("lets viewers read but not write, and editors write", async () => {
    await setBudget(food, "2026-10", 100);
    expect(
      (await monthView("2026-10", ledgerId, viewerCookie)).items,
    ).toHaveLength(2);
    const denied = await put(
      { categoryId: rent, month: "2026-10", amount: usd(1), rollover: false },
      ledgerId,
      viewerCookie,
    );
    expect(denied.statusCode).toBe(403);
    const allowed = await put(
      { categoryId: rent, month: "2026-10", amount: usd(1), rollover: false },
      ledgerId,
      editorCookie,
    );
    expect(allowed.statusCode).toBe(201);
  });

  it("requires a session, a trusted origin and an idempotency key", async () => {
    const body = JSON.stringify({
      categoryId: food,
      month: "2026-10",
      amount: usd(1),
      rollover: false,
    });
    const anonymous = await app.inject({
      url: `${baseUrl()}?month=2026-10`,
    });
    expect(anonymous.statusCode).toBe(401);
    const noOrigin = await app.inject({
      method: "PUT",
      url: baseUrl(),
      headers: { ...headers(), origin: "https://elsewhere.example.com" },
      payload: body,
    });
    expect(noOrigin.statusCode).toBe(403);
    const noKey = await app.inject({
      method: "PUT",
      url: baseUrl(),
      headers: { ...headers(), "idempotency-key": "" },
      payload: body,
    });
    expect(noKey.statusCode).toBe(400);
  });
});

describe("ledger isolation", () => {
  it("cannot read another ledger's budgets or spending", async () => {
    await db.insert(budgets).values({
      ledgerId: foreignLedger,
      categoryId: foreignFood,
      month: "2026-10-01",
      amount: 5000,
    });
    await db.insert(transactions).values({
      ledgerId: foreignLedger,
      accountId: foreignAccountId,
      categoryId: foreignFood,
      kind: "expense",
      date: "2026-10-02",
      amount: -4000,
      baseAmount: -4000,
    });
    const foreign = await app.inject({
      url: `${baseUrl(foreignLedger)}?month=2026-10`,
      headers: { cookie: ownerCookie },
    });
    expect(foreign.statusCode).toBe(404);
    const own = await monthView("2026-10");
    expect(own.items.map((item) => item.categoryId)).not.toContain(foreignFood);
    expect(own.totals.budgeted.amount).toBe(0);
    expect(own.totals.unbudgetedSpent.amount).toBe(0);
  });

  it("cannot write to another ledger or use its categories and budgets", async () => {
    const [foreignBudget] = await db
      .insert(budgets)
      .values({
        ledgerId: foreignLedger,
        categoryId: foreignFood,
        month: "2026-10-01",
        amount: 5000,
      })
      .returning();
    const write = await put(
      {
        categoryId: foreignFood,
        month: "2026-10",
        amount: usd(1),
        rollover: false,
      },
      foreignLedger,
    );
    expect(write.statusCode).toBe(404);
    // A category from another ledger is not found in this one.
    expect((await setBudget(foreignFood, "2026-10", 1)).statusCode).toBe(404);
    // A budget ID from another ledger cannot be deleted through this one.
    const removed = await app.inject({
      method: "DELETE",
      url: `${baseUrl()}/${foreignBudget?.id}`,
      headers: headers(),
      payload: { expectedVersion: 1 },
    });
    expect(removed.statusCode).toBe(404);
    const copy = await app.inject({
      method: "POST",
      url: `${baseUrl(foreignLedger)}/copy`,
      headers: headers(),
      payload: { fromMonth: "2026-10", toMonth: "2026-11" },
    });
    expect(copy.statusCode).toBe(404);
    const stillThere = await db
      .select()
      .from(budgets)
      .where(inArray(budgets.ledgerId, [foreignLedger]));
    expect(stillThere).toHaveLength(1);
    expect(stillThere[0]?.deletedAt).toBeNull();
  });
});
