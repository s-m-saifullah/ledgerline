import {
  createImportResultSchema,
  importBatchListSchema,
  importPreviewSchema,
  newId,
  parseCsv,
  unguardText,
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
  importBatches,
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

const url = requireTestDatabase("Import tests");
const config = testConfig(url, "imports");
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
const post = (
  path: string,
  body: unknown,
  options: {
    ledger?: string;
    cookie?: string;
    key?: string;
    origin?: string;
  } = {},
) =>
  app.inject({
    url: base(options.ledger) + path,
    method: "POST",
    headers: {
      cookie: options.cookie ?? (cookies[0] as string),
      origin: options.origin ?? config.APP_URL,
      "idempotency-key": options.key ?? newId(),
      "content-type": "application/json",
    },
    payload: JSON.stringify(body),
  });
async function send(path: string, body: unknown, ledger = ledgerId) {
  const response = await post(path, body, { ledger });
  expect(response.statusCode, response.body).toBeLessThan(300);
  return response.body ? response.json() : undefined;
}

type Setup = {
  checking: string;
  savings: string;
  archived: string;
  euro: string;
  food: string;
  fun: string;
  salary: string;
  oldFood: string;
};
let s: Setup;
let line = 0;
const row = (categoryId: string, over: Record<string, unknown> = {}) => ({
  line: ++line,
  date: "2026-10-05",
  time: null,
  kind: "expense",
  amount: 1000,
  categoryId,
  payee: null,
  note: null,
  status: "cleared",
  sourceId: null,
  ...over,
});
async function seed(ledger = ledgerId): Promise<Setup> {
  const account = async (name: string, currency = "USD", archived = false) => {
    const id = newId();
    await db.insert(accounts).values({
      id,
      ledgerId: ledger,
      name,
      type: "bank",
      currency,
      openingBalance: 0,
      archivedAt: archived ? new Date() : null,
    });
    return id;
  };
  const category = async (
    name: string,
    kind: "expense" | "income",
    archived = false,
  ) => {
    const id = newId();
    await db.insert(categories).values({
      id,
      ledgerId: ledger,
      name,
      kind,
      archivedAt: archived ? new Date() : null,
    });
    return id;
  };
  return {
    checking: await account("Checking"),
    savings: await account("Savings"),
    archived: await account("Closed", "USD", true),
    euro: await account("Euro", "EUR"),
    food: await category("Food", "expense"),
    fun: await category("Fun", "expense"),
    salary: await category("Salary", "income"),
    oldFood: await category("Old food", "expense", true),
  };
}
async function clear() {
  await db.transaction(async (tx) => {
    await tx
      .delete(transactionSplits)
      .where(inArray(transactionSplits.ledgerId, ids));
    await tx.delete(transactions).where(inArray(transactions.ledgerId, ids));
  });
  await db.delete(importBatches).where(inArray(importBatches.ledgerId, ids));
  await db.delete(categories).where(inArray(categories.ledgerId, ids));
  await db.delete(accounts).where(inArray(accounts.ledgerId, ids));
  await db.delete(writeReceipts).where(inArray(writeReceipts.ledgerId, ids));
}
const preview = async (
  accountId: string,
  rows: unknown[],
  ledger = ledgerId,
) => {
  const response = await post(
    "/imports/preview",
    { accountId, rows },
    { ledger },
  );
  expect(response.statusCode, response.body).toBe(200);
  return importPreviewSchema.parse(response.json());
};
const entries = async (accountId: string) => {
  const response = await get(`/transactions?accountId=${accountId}&limit=100`);
  expect(response.statusCode, response.body).toBe(200);
  return response.json().items as {
    id: string;
    date: string;
    kind: string;
    status: string;
    payee: string | null;
    note: string | null;
    amount: { amount: number };
  }[];
};
const batches = async (ledger = ledgerId, cookie?: string) => {
  const response = await get("/imports", ledger, cookie);
  expect(response.statusCode, response.body).toBe(200);
  return importBatchListSchema.parse(response.json()).items;
};

beforeAll(async () => {
  await applyMigrations(url);
  await db
    .insert(ledgers)
    .values(ids.map((id) => ({ id, name: "Synthetic Import suite" })));
  const password = await hashPassword(config.OWNER_PASSWORD);
  for (const [i, role] of roles.entries()) {
    const id = users[i] as string;
    await db
      .insert(user)
      .values({ id, name: role, email: `imports-${role}-${id}@example.com` });
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
        `imports-${role}-${users[i]}@example.com`,
      ),
    );
});
beforeEach(async () => {
  await clear();
  s = await seed();
  line = 0;
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

describe("preview", () => {
  it("marks ready rows, problems and duplicates, and saves nothing", async () => {
    const coffee = await send("/transactions", {
      accountId: s.checking,
      categoryId: s.food,
      kind: "expense",
      date: "2026-10-02",
      amount: money(-450),
    });
    const rows = [
      row(s.food, { amount: 800 }),
      // Two rows alike, one existing entry: only the first is a duplicate.
      row(s.food, { date: "2026-10-02", amount: 450 }),
      row(s.food, { date: "2026-10-02", amount: 450 }),
      // An income row with an expense category, an archived category and an unknown one.
      row(s.food, { kind: "income", amount: 2000 }),
      row(s.oldFood),
      row(newId()),
      // A file exported earlier names its entries by id.
      row(s.fun, { amount: 777, sourceId: coffee.id }),
      row(s.salary, { kind: "income", amount: 250000 }),
    ];
    const result = await preview(s.checking, rows);
    expect(result.rows.map((r) => r.state)).toEqual([
      "ready",
      "duplicate",
      "ready",
      "problem",
      "problem",
      "problem",
      "duplicate",
      "ready",
    ]);
    expect(result.rows[1]?.reason).toContain("Same date and amount");
    expect(result.rows[6]?.reason).toContain("same entry id");
    expect(result.rows[3]?.reason).toBeTruthy();
    expect(result.counts).toEqual({ ready: 3, duplicate: 2, problem: 3 });
    expect((await entries(s.checking)).length).toBe(1);
    expect(await batches()).toEqual([]);
  });

  it("flags a row in a currency with no stored rate, and refuses a closed account", async () => {
    const result = await preview(s.euro, [row(s.food)]);
    expect(result.rows[0]?.state).toBe("problem");
    const closed = await post("/imports/preview", {
      accountId: s.archived,
      rows: [row(s.food)],
    });
    expect(closed.statusCode).toBe(409);
  });
});

describe("import", () => {
  it("saves the rows as entries of one batch and shows the batch", async () => {
    const rows = [
      row(s.food, {
        amount: 1250,
        payee: "Corner shop",
        note: "lunch",
        time: "12:30",
      }),
      row(s.salary, { kind: "income", amount: 250000, status: "pending" }),
      row(s.fun, { amount: 999, date: "2026-10-06" }),
    ];
    const response = await post("/imports", {
      accountId: s.checking,
      sourceName: "statement.csv",
      rows,
    });
    expect(response.statusCode, response.body).toBe(201);
    const result = createImportResultSchema.parse(response.json());
    expect(result.duplicatesIncluded).toBe(0);
    expect(result.batch).toMatchObject({
      accountId: s.checking,
      sourceName: "statement.csv",
      rowCount: 3,
      remaining: 3,
    });
    const saved = await entries(s.checking);
    expect(
      saved
        .map((e) => [e.date, e.kind, e.amount.amount, e.status, e.payee])
        .sort(),
    ).toEqual([
      ["2026-10-05", "expense", -1250, "cleared", "Corner shop"],
      ["2026-10-05", "income", 250000, "pending", null],
      ["2026-10-06", "expense", -999, "cleared", null],
    ]);
    expect(await batches()).toMatchObject([
      { id: result.batch.id, remaining: 3, rowCount: 3 },
    ]);
  });

  it("includes duplicates only because the caller sent them, and counts them", async () => {
    await send("/transactions", {
      accountId: s.checking,
      categoryId: s.food,
      kind: "expense",
      date: "2026-10-05",
      amount: money(-1000),
    });
    const response = await post("/imports", {
      accountId: s.checking,
      sourceName: null,
      rows: [row(s.food)],
    });
    expect(response.statusCode).toBe(201);
    expect(response.json().duplicatesIncluded).toBe(1);
    expect((await entries(s.checking)).length).toBe(2);
  });

  it("saves nothing when one row is wrong and says which line", async () => {
    const response = await post("/imports", {
      accountId: s.checking,
      sourceName: null,
      rows: [
        row(s.food),
        row(s.food, { line: 40, kind: "income" }),
        row(s.fun),
      ],
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().detail).toContain("Line 40");
    expect(await entries(s.checking)).toEqual([]);
    expect(await batches()).toEqual([]);
  });

  it("replays a retry with the same key and rejects a changed request", async () => {
    const body = {
      accountId: s.checking,
      sourceName: null,
      rows: [row(s.food)],
    };
    const key = newId();
    const first = await post("/imports", body, { key });
    const again = await post("/imports", body, { key });
    expect(first.statusCode).toBe(201);
    expect(again.statusCode).toBe(201);
    expect(again.headers["idempotency-replayed"]).toBe("true");
    expect(again.json().batch.id).toBe(first.json().batch.id);
    expect((await entries(s.checking)).length).toBe(1);
    const changed = await post(
      "/imports",
      { ...body, rows: [row(s.food, { amount: 5 })] },
      { key },
    );
    expect(changed.statusCode).toBe(409);
  });

  it("takes 5,000 rows in one go, more than the default body limit", async () => {
    const rows = Array.from({ length: 5000 }, (_, i) =>
      row(s.food, {
        amount: 100 + i,
        date: `2026-0${1 + (i % 9)}-1${i % 9}`,
        payee: `Merchant number ${i} with a fairly long descriptive name`,
        note: "Imported statement line with some extra text to make it larger",
      }),
    );
    const body = { accountId: s.checking, sourceName: "big.csv", rows };
    expect(JSON.stringify(body).length).toBeGreaterThan(1024 * 1024);
    const response = await post("/imports", body);
    expect(response.statusCode, response.body.slice(0, 200)).toBe(201);
    expect((await batches())[0]?.remaining).toBe(5000);
    expect(
      (await post("/imports", { ...body, rows: [...rows, row(s.food)] }))
        .statusCode,
    ).toBe(400);
  }, 90_000);

  it("rejects empty, oversized and malformed requests", async () => {
    const good = row(s.food);
    for (const body of [
      { accountId: s.checking, sourceName: null, rows: [] },
      {
        accountId: s.checking,
        sourceName: null,
        rows: [{ ...good, amount: 0 }],
      },
      {
        accountId: s.checking,
        sourceName: null,
        rows: [{ ...good, amount: 1.5 }],
      },
      {
        accountId: s.checking,
        sourceName: null,
        rows: [{ ...good, kind: "transfer" }],
      },
      {
        accountId: s.checking,
        sourceName: null,
        rows: [{ ...good, extra: 1 }],
      },
      {
        accountId: s.checking,
        sourceName: null,
        rows: [{ ...good, date: "2026-13-01" }],
      },
      { accountId: s.checking, sourceName: "", rows: [good] },
    ])
      expect((await post("/imports", body)).statusCode).toBe(400);
    expect(
      (
        await post("/imports", {
          accountId: s.archived,
          sourceName: null,
          rows: [good],
        })
      ).statusCode,
    ).toBe(409);
  });

  it("reads a file this app exported and imports it into another account", async () => {
    await send("/transactions", {
      accountId: s.checking,
      categoryId: s.food,
      kind: "expense",
      date: "2026-10-02",
      amount: money(-1050),
      payee: "=HYPERLINK",
      note: 'say "hi", twice',
    });
    await send("/transactions", {
      accountId: s.checking,
      categoryId: s.salary,
      kind: "income",
      date: "2026-10-03",
      amount: money(250000),
      payee: "Acme, Inc.",
    });
    const file = await get("/exports/transactions.csv");
    expect(file.statusCode).toBe(200);
    const [head, ...lines] = parseCsv(file.body);
    const col = (cells: string[], name: string) =>
      cells[(head as string[]).indexOf(name)] as string;
    const categoryIds: Record<string, string> = {
      Food: s.food,
      Salary: s.salary,
    };
    const rows = lines.map((cells, i) =>
      row(categoryIds[col(cells, "category")] as string, {
        line: i + 2,
        date: col(cells, "date"),
        kind: col(cells, "type"),
        amount: Math.round(Number(col(cells, "amount")) * 100),
        payee: unguardText(col(cells, "payee")) || null,
        note: unguardText(col(cells, "note")) || null,
        sourceId: col(cells, "id"),
      }),
    );
    // An id from this ledger is the same entry wherever it is imported; without ids, only
    // the account it came from has matching entries.
    expect((await preview(s.checking, rows)).counts).toEqual({
      ready: 0,
      duplicate: 2,
      problem: 0,
    });
    expect((await preview(s.savings, rows)).counts.duplicate).toBe(2);
    const plain = rows.map((r) => ({ ...r, sourceId: null }));
    expect((await preview(s.checking, plain)).counts.duplicate).toBe(2);
    expect((await preview(s.savings, plain)).counts.ready).toBe(2);
    expect(
      (
        await post("/imports", {
          accountId: s.savings,
          sourceName: null,
          rows: plain,
        })
      ).statusCode,
    ).toBe(201);
    const copied = await entries(s.savings);
    expect(
      copied.map((e) => [e.date, e.amount.amount, e.payee, e.note]).sort(),
    ).toEqual([
      ["2026-10-02", -1050, "=HYPERLINK", 'say "hi", twice'],
      ["2026-10-03", 250000, "Acme, Inc.", null],
    ]);
  });
});

describe("undo", () => {
  it("removes what is left of an import and retires the batch", async () => {
    const response = await post("/imports", {
      accountId: s.checking,
      sourceName: null,
      rows: [
        row(s.food),
        row(s.fun, { amount: 2 }),
        row(s.food, { amount: 3 }),
      ],
    });
    const batch = response.json().batch;
    // One entry was already deleted by hand.
    const [first] = await entries(s.checking);
    const gone = await app.inject({
      url: `${base()}/transactions/${first?.id}`,
      method: "GET",
      headers: { cookie: cookies[0] as string },
    });
    await app.inject({
      url: `${base()}/transactions/${first?.id}`,
      method: "DELETE",
      headers: {
        cookie: cookies[0] as string,
        origin: config.APP_URL,
        "idempotency-key": newId(),
        "content-type": "application/json",
      },
      payload: JSON.stringify({ expectedVersion: gone.json().version }),
    });
    expect((await batches())[0]?.remaining).toBe(2);
    {
      const stale = await post(`/imports/${batch.id}/undo`, {
        expectedVersion: batch.version + 1,
      });
      expect(stale.statusCode).toBe(409);
      expect((await entries(s.checking)).length).toBe(2);
    }
    const undone = await post(`/imports/${batch.id}/undo`, {
      expectedVersion: batch.version,
    });
    expect(undone.statusCode, undone.body).toBe(200);
    expect(undone.json()).toEqual({ removed: 2 });
    expect(await entries(s.checking)).toEqual([]);
    expect(await batches()).toEqual([]);
    const twice = await post(`/imports/${batch.id}/undo`, {
      expectedVersion: batch.version,
    });
    expect(twice.statusCode).toBe(404);
  });

  it("replays a retry with the same key", async () => {
    const batch = (
      await post("/imports", {
        accountId: s.checking,
        sourceName: null,
        rows: [row(s.food)],
      })
    ).json().batch;
    const key = newId();
    const first = await post(
      `/imports/${batch.id}/undo`,
      { expectedVersion: batch.version },
      { key },
    );
    const again = await post(
      `/imports/${batch.id}/undo`,
      { expectedVersion: batch.version },
      { key },
    );
    expect(first.statusCode).toBe(200);
    expect(again.statusCode).toBe(200);
    expect(again.headers["idempotency-replayed"]).toBe("true");
  });
});

describe("access", () => {
  it("keeps ledgers apart", async () => {
    const other = await seed(otherLedger);
    const made = await post(
      "/imports",
      {
        accountId: other.checking,
        sourceName: "other.csv",
        rows: [row(other.food)],
      },
      { ledger: otherLedger },
    );
    expect(made.statusCode, made.body).toBe(201);
    expect(await batches()).toEqual([]);
    expect((await batches(otherLedger)).length).toBeGreaterThan(0);
    // Another ledger's account or category cannot be used, and its batch cannot be undone from here.
    expect(
      (
        await post("/imports", {
          accountId: other.checking,
          sourceName: null,
          rows: [row(s.food)],
        })
      ).statusCode,
    ).toBe(404);
    const foreign = await post("/imports", {
      accountId: s.checking,
      sourceName: null,
      rows: [row(other.food)],
    });
    expect(foreign.statusCode).toBe(404);
    expect(
      (
        await post("/imports/preview", {
          accountId: s.checking,
          rows: [row(other.food)],
        })
      ).json().rows[0].state,
    ).toBe("problem");
    const batch = made.json().batch;
    expect(
      (await post(`/imports/${batch.id}/undo`, { expectedVersion: 1 }))
        .statusCode,
    ).toBe(404);
    expect((await batches(otherLedger))[0]?.remaining).toBe(1);
    // A signed-in person who is not a member sees nothing of it.
    expect((await get("/imports", otherLedger, cookies[1])).statusCode).toBe(
      404,
    );
    expect(
      (
        await post(
          "/imports/preview",
          { accountId: other.checking, rows: [row(other.food)] },
          { ledger: otherLedger, cookie: cookies[1] as string },
        )
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await post(
          "/imports",
          {
            accountId: other.checking,
            sourceName: null,
            rows: [row(other.food)],
          },
          { ledger: otherLedger, cookie: cookies[1] as string },
        )
      ).statusCode,
    ).toBe(404);
  });

  it("lets a viewer look but not write, and rejects anonymous and cross-site calls", async () => {
    const batch = (
      await post("/imports", {
        accountId: s.checking,
        sourceName: null,
        rows: [row(s.food)],
      })
    ).json().batch;
    const viewer = cookies[2] as string;
    expect((await get("/imports", ledgerId, viewer)).statusCode).toBe(200);
    expect(
      (
        await post(
          "/imports/preview",
          { accountId: s.checking, rows: [row(s.food)] },
          { cookie: viewer },
        )
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await post(
          "/imports",
          { accountId: s.checking, sourceName: null, rows: [row(s.food)] },
          { cookie: viewer },
        )
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await post(
          `/imports/${batch.id}/undo`,
          { expectedVersion: 1 },
          { cookie: viewer },
        )
      ).statusCode,
    ).toBe(403);
    expect((await app.inject({ url: `${base()}/imports` })).statusCode).toBe(
      401,
    );
    expect(
      (
        await post(
          "/imports",
          { accountId: s.checking, sourceName: null, rows: [row(s.food)] },
          { origin: "https://elsewhere.example.com" },
        )
      ).statusCode,
    ).toBe(403);
    expect((await entries(s.checking)).length).toBe(1);
  });
});
