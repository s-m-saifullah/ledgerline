import { newId } from "@ledgerline/shared";
import { inArray, sql } from "drizzle-orm";
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

const url = requireTestDatabase("Export tests");
const config = testConfig(url, "exports");
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

/** Splits CSV text into rows of cells (RFC 4180 quoting). */
function parseCsv(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i] as string;
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\r" && text[i + 1] === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      i++;
    } else cell += char;
  }
  if (cell || row.length)
    throw new Error("File does not end with a line break");
  return rows;
}
async function csv(path: string, ledger = ledgerId, cookie?: string) {
  const response = await get(path, ledger, cookie);
  expect(response.statusCode, response.body).toBe(200);
  expect(response.body.startsWith("﻿")).toBe(true);
  return parseCsv(response.body.slice(1));
}
const header = [
  "id",
  "date",
  "time",
  "type",
  "amount",
  "currency",
  "account",
  "to_account",
  "received_amount",
  "category",
  "subcategory",
  "payee",
  "note",
  "status",
  "line",
  "fx_rate",
  "base_amount",
];
/** Rows without their ids, which change on every run. */
const body = (rows: string[][]) => rows.slice(1).map((row) => row.slice(1));

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
  yen: string;
  euro: string;
  food: string;
  groceries: string;
  fun: string;
  salary: string;
};
async function seed(ledger = ledgerId): Promise<Setup> {
  const account = async (
    name: string,
    openingBalance: number,
    currency = "USD",
    archived = false,
  ) => {
    const id = newId();
    await db.insert(accounts).values({
      id,
      ledgerId: ledger,
      name,
      type: "bank",
      currency,
      openingBalance,
      archivedAt: archived ? new Date() : null,
    });
    return id;
  };
  const category = async (
    name: string,
    kind: "expense" | "income",
    parentId: string | null = null,
    color: string | null = null,
  ) => {
    const id = newId();
    await db
      .insert(categories)
      .values({ id, ledgerId: ledger, name, kind, parentId, color });
    return id;
  };
  const food = await category("Food", "expense", null, "#aabbcc");
  return {
    checking: await account("Checking", 100000),
    savings: await account("Savings, old", 0),
    yen: await account("Yen", 0, "JPY"),
    euro: await account("Euro", 0, "EUR"),
    food,
    groceries: await category("Groceries", "expense", food),
    fun: await category("Fun", "expense"),
    salary: await category("Salary", "income"),
  };
}
const entry = (
  ledger: string,
  s: Setup,
  categoryId: string,
  amount: number,
  date: string,
  extra: Record<string, unknown> = {},
) =>
  send(
    "/transactions",
    {
      accountId: s.checking,
      categoryId,
      kind: amount < 0 ? "expense" : "income",
      date,
      amount: money(amount),
      ...extra,
    },
    "POST",
    ledger,
  );
async function fixture() {
  const s = await seed();
  await entry(ledgerId, s, s.salary, 250000, "2026-10-01", {
    payee: "Acme, Inc.",
    note: 'He said "hi"',
  });
  await entry(ledgerId, s, s.food, -1000, "2026-10-02", {
    payee: "=HYPERLINK",
  });
  await entry(ledgerId, s, s.groceries, -9000, "2026-10-03", {
    time: "12:30",
  });
  await entry(ledgerId, s, s.fun, -2500, "2026-10-04", { status: "pending" });
  await send("/transactions", {
    accountId: s.checking,
    categoryId: null,
    kind: "expense",
    date: "2026-10-05",
    amount: money(-9000),
    note: "Weekend",
    splits: [
      { categoryId: s.groceries, amount: money(-6000), note: null },
      { categoryId: s.fun, amount: money(-3000), note: "Tickets" },
    ],
  });
  await send("/transfers", {
    fromAccountId: s.checking,
    toAccountId: s.savings,
    amount: money(5000),
    date: "2026-10-06",
  });
  await db
    .update(accounts)
    .set({ archivedAt: new Date() })
    .where(inArray(accounts.id, [s.savings]));
  const gone = await entry(ledgerId, s, s.fun, -99999, "2026-10-09");
  await send(
    `/transactions/${gone.id}`,
    { expectedVersion: gone.version },
    "DELETE",
  );
  // Foreign currencies are written straight to the tables: a yen entry and a USD to euro transfer.
  const row = (
    account: string,
    amount: number,
    rate: string,
    baseAmount: number,
  ) => ({
    ledgerId,
    accountId: account,
    amount,
    fxRate: rate,
    baseAmount,
    date: "2026-10-07",
    status: "cleared" as const,
  });
  await db.insert(transactions).values({
    ...row(s.yen, -1200, "0.0067000000", -8),
    kind: "expense",
    currency: "JPY",
    categoryId: s.fun,
  });
  const transferId = newId();
  await db.transaction(async (tx) => {
    await tx.insert(transactions).values([
      {
        ...row(s.checking, -10000, "1", -10000),
        date: "2026-10-08",
        kind: "transfer",
        transferId,
      },
      {
        ...row(s.euro, 9000, "1.1111111111", 10000),
        date: "2026-10-08",
        kind: "transfer",
        currency: "EUR",
        transferId,
      },
    ]);
  });
  return s;
}

beforeAll(async () => {
  await applyMigrations(url);
  await db
    .insert(ledgers)
    .values(ids.map((id) => ({ id, name: "Synthetic Export suite" })));
  const password = await hashPassword(config.OWNER_PASSWORD);
  for (const [i, role] of roles.entries()) {
    const id = users[i] as string;
    await db
      .insert(user)
      .values({ id, name: role, email: `exports-${role}-${id}@example.com` });
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
        `exports-${role}-${users[i]}@example.com`,
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

describe("transactions export", () => {
  it("writes the hand-checked file", async () => {
    await fixture();
    const rows = await csv("/exports/transactions.csv");
    expect(rows[0]).toEqual(header);
    expect(body(rows)).toEqual([
      [
        "2026-10-01",
        "",
        "income",
        "2500.00",
        "USD",
        "Checking",
        "",
        "",
        "Salary",
        "",
        "Acme, Inc.",
        'He said "hi"',
        "cleared",
        "",
        "1",
        "2500.00",
      ],
      [
        "2026-10-02",
        "",
        "expense",
        "10.00",
        "USD",
        "Checking",
        "",
        "",
        "Food",
        "",
        "'=HYPERLINK",
        "",
        "cleared",
        "",
        "1",
        "10.00",
      ],
      [
        "2026-10-03",
        "12:30",
        "expense",
        "90.00",
        "USD",
        "Checking",
        "",
        "",
        "Food",
        "Groceries",
        "",
        "",
        "cleared",
        "",
        "1",
        "90.00",
      ],
      [
        "2026-10-04",
        "",
        "expense",
        "25.00",
        "USD",
        "Checking",
        "",
        "",
        "Fun",
        "",
        "",
        "",
        "pending",
        "",
        "1",
        "25.00",
      ],
      [
        "2026-10-05",
        "",
        "expense",
        "60.00",
        "USD",
        "Checking",
        "",
        "",
        "Food",
        "Groceries",
        "",
        "Weekend",
        "cleared",
        "1",
        "1",
        "60.00",
      ],
      [
        "2026-10-05",
        "",
        "expense",
        "30.00",
        "USD",
        "Checking",
        "",
        "",
        "Fun",
        "",
        "",
        "Tickets",
        "cleared",
        "2",
        "1",
        "30.00",
      ],
      [
        "2026-10-06",
        "",
        "transfer",
        "50.00",
        "USD",
        "Checking",
        "Savings, old",
        "",
        "",
        "",
        "",
        "",
        "cleared",
        "",
        "1",
        "50.00",
      ],
      [
        "2026-10-07",
        "",
        "expense",
        "1200",
        "JPY",
        "Yen",
        "",
        "",
        "Fun",
        "",
        "",
        "",
        "cleared",
        "",
        "0.0067",
        "0.08",
      ],
      [
        "2026-10-08",
        "",
        "transfer",
        "100.00",
        "USD",
        "Checking",
        "Euro",
        "90.00",
        "",
        "",
        "",
        "",
        "cleared",
        "",
        "1",
        "100.00",
      ],
    ]);
    // Split lines share their entry's id; every other row has its own.
    const idsOf = rows.slice(1).map((row) => row[0]);
    expect(idsOf[4]).toBe(idsOf[5]);
    expect(new Set(idsOf).size).toBe(8);
  });

  it("sends a download that is never cached", async () => {
    await fixture();
    const response = await get("/exports/transactions.csv");
    expect(response.headers["content-type"]).toBe("text/csv; charset=utf-8");
    expect(response.headers["content-disposition"]).toMatch(
      /^attachment; filename="ledgerline-transactions-\d{4}-\d{2}-\d{2}\.csv"$/,
    );
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.body.includes("\r\n")).toBe(true);
    expect(response.body.endsWith("\r\n")).toBe(true);
  });

  it("applies the list filters", async () => {
    const s = await fixture();
    const only = async (query: string) =>
      body(await csv(`/exports/transactions.csv?${query}`)).map(
        (row) => `${row[0]} ${row[2]} ${row[3]}`,
      );
    expect(await only("from=2026-10-07&to=2026-10-08")).toEqual([
      "2026-10-07 expense 1200",
      "2026-10-08 transfer 100.00",
    ]);
    expect(await only("status=pending")).toEqual(["2026-10-04 expense 25.00"]);
    expect(await only("kind=transfer")).toEqual([
      "2026-10-06 transfer 50.00",
      "2026-10-08 transfer 100.00",
    ]);
    // A transfer shows under the account it arrives in as well as the one it leaves.
    expect(await only(`accountId=${s.savings}`)).toEqual([
      "2026-10-06 transfer 50.00",
    ]);
    expect(await only(`accountId=${s.yen}`)).toEqual([
      "2026-10-07 expense 1200",
    ]);
    // A category filter keeps whole entries, so a split entry keeps all its lines.
    expect(await only(`categoryId=${s.groceries}`)).toEqual([
      "2026-10-03 expense 90.00",
      "2026-10-05 expense 60.00",
      "2026-10-05 expense 30.00",
    ]);
    expect(await only("text=acme")).toEqual(["2026-10-01 income 2500.00"]);
    expect(await only("text=%25")).toEqual([]);
  });

  it("pages through more entries than one batch without repeats or gaps", async () => {
    const s = await seed();
    await db.execute(sql`
      insert into transactions (id, ledger_id, account_id, category_id, kind, date, amount, currency, fx_rate, base_amount, status)
      select gen_random_uuid(), ${ledgerId}, ${s.checking}, ${s.fun}, 'expense', date '2026-01-01' + (n % 3), -100 - n, 'USD', 1, -100 - n, 'cleared'
      from generate_series(1, 2350) n`);
    const rows = await csv("/exports/transactions.csv");
    expect(rows).toHaveLength(2351);
    expect(new Set(rows.slice(1).map((row) => row[0])).size).toBe(2350);
    const keys = rows.slice(1).map((row) => `${row[1]} ${row[0]}`);
    expect([...keys].sort()).toEqual(keys);
    const total = rows
      .slice(1)
      .reduce((sum, row) => sum + Math.round(Number(row[4]) * 100), 0);
    // 100 + n over n = 1..2350: 235000 + 2350*2351/2.
    expect(total).toBe(235000 + (2350 * 2351) / 2);
  });

  it("never includes another ledger's rows and hides that ledger", async () => {
    await fixture();
    const other = await seed(otherLedger);
    await entry(otherLedger, other, other.fun, -123456, "2026-10-09");
    expect(body(await csv("/exports/transactions.csv"))).toHaveLength(9);
    expect(body(await csv("/exports/transactions.csv", otherLedger))).toEqual([
      [
        "2026-10-09",
        "",
        "expense",
        "1234.56",
        "USD",
        "Checking",
        "",
        "",
        "Fun",
        "",
        "",
        "",
        "cleared",
        "",
        "1",
        "1234.56",
      ],
    ]);
    const denied = await get(
      "/exports/transactions.csv",
      otherLedger,
      cookies[1],
    );
    expect(denied.statusCode).toBe(404);
    expect(denied.headers["content-type"]).toContain(
      "application/problem+json",
    );
  });

  it("allows a viewer, rejects anonymous callers and bad filters", async () => {
    await fixture();
    expect(
      (await get("/exports/transactions.csv", ledgerId, cookies[2])).statusCode,
    ).toBe(200);
    expect(
      (await app.inject({ url: `${base()}/exports/transactions.csv` }))
        .statusCode,
    ).toBe(401);
    for (const query of [
      "from=2026-10-09&to=2026-10-01",
      "status=other",
      "kind=x",
    ])
      expect((await get(`/exports/transactions.csv?${query}`)).statusCode).toBe(
        400,
      );
  });
});

describe("accounts and categories export", () => {
  it("lists accounts with opening balances and archived ones", async () => {
    await fixture();
    const rows = await csv("/exports/accounts.csv");
    expect(rows[0]).toEqual([
      "id",
      "name",
      "type",
      "currency",
      "opening_balance",
      "archived",
    ]);
    expect(
      body(rows).sort((a, b) => (a[0] as string).localeCompare(b[0] as string)),
    ).toEqual([
      ["Checking", "bank", "USD", "1000.00", "false"],
      ["Euro", "bank", "EUR", "0.00", "false"],
      ["Savings, old", "bank", "USD", "0.00", "true"],
      ["Yen", "bank", "JPY", "0", "false"],
    ]);
  });

  it("lists categories with their parent", async () => {
    await fixture();
    const rows = await csv("/exports/categories.csv");
    expect(rows[0]).toEqual([
      "id",
      "name",
      "parent",
      "kind",
      "color",
      "archived",
    ]);
    expect(
      body(rows).sort((a, b) => (a[0] as string).localeCompare(b[0] as string)),
    ).toEqual([
      ["Food", "", "expense", "#aabbcc", "false"],
      ["Fun", "", "expense", "", "false"],
      ["Groceries", "Food", "expense", "", "false"],
      ["Salary", "", "income", "", "false"],
    ]);
  });

  it("keeps ledgers apart and requires access", async () => {
    await fixture();
    await seed(otherLedger);
    expect(body(await csv("/exports/accounts.csv"))).toHaveLength(4);
    for (const path of ["/exports/accounts.csv", "/exports/categories.csv"]) {
      expect((await get(path, otherLedger, cookies[1])).statusCode).toBe(404);
      expect((await get(path, ledgerId, cookies[2])).statusCode).toBe(200);
      expect((await app.inject({ url: base() + path })).statusCode).toBe(401);
    }
  });
});
