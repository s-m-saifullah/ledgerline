import {
  newId,
  type SyncResponse,
  syncResponseSchema,
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
  currencies,
  exchangeRates,
  ledgerMembers,
  ledgers,
  session,
  tags,
  transactionSplits,
  transactions,
  transactionTags,
  user,
  writeReceipts,
} from "../../db/schema";
import {
  requireTestDatabase,
  seedUser,
  signInCookie,
  testConfig,
} from "../../test-support/harness";

// ADR 0042, the pull side: every table's changes since a cursor, tombstones included, converging on the same
// rows as a fresh full pull, never missing a late commit and never crossing ledgers.
const url = requireTestDatabase("Sync pull tests");
const config = testConfig(url, "syncpull");
const { db, pool } = createDatabase(url);
const app = await buildApp(db, config);
const ledgerId = newId();
const otherLedger = newId();
const ids = [ledgerId, otherLedger];
const people = {
  owner: { id: newId(), email: "syncpull-person-owner@example.com" },
  viewer: { id: newId(), email: "syncpull-person-viewer@example.com" },
  outsider: { id: newId(), email: "syncpull-person-outsider@example.com" },
};
let cookies = { owner: "", viewer: "", outsider: "" };
const money = (amount: number) => ({ amount, currency: "USD" });
const base = (ledger = ledgerId) => `/api/v1/ledgers/${ledger}`;

const call = (
  method: "POST" | "PATCH" | "DELETE",
  path: string,
  body: unknown,
  ledger = ledgerId,
  cookie = cookies.owner,
) =>
  app.inject({
    url: base(ledger) + path,
    method,
    headers: {
      cookie,
      origin: config.APP_URL,
      "idempotency-key": newId(),
      "content-type": "application/json",
    },
    payload: JSON.stringify(body),
  });
async function send(
  method: "POST" | "PATCH" | "DELETE",
  path: string,
  body: unknown,
  ledger = ledgerId,
) {
  const response = await call(method, path, body, ledger);
  expect(response.statusCode, response.body).toBeLessThan(300);
  return response.body ? response.json() : undefined;
}
const pullOnce = async (
  query: string,
  ledger = ledgerId,
  cookie = cookies.owner,
) => app.inject({ url: `${base(ledger)}/sync${query}`, headers: { cookie } });
async function pull(cursor?: string, limit = 500, ledger = ledgerId) {
  const response = await pullOnce(
    `?limit=${limit}${cursor ? `&cursor=${cursor}` : ""}`,
    ledger,
  );
  expect(response.statusCode, response.body).toBe(200);
  return syncResponseSchema.parse(response.json());
}

type Tables = SyncResponse["changes"];
type Row = { id: string; version?: number; updatedAt: string };
/** What the phone does with a page: keep a row unless the copy it holds is as new or newer. */
function apply(mirror: Map<string, Map<string, Row>>, changes: Tables) {
  for (const [table, rows] of Object.entries(changes) as [string, Row[]][]) {
    const held = mirror.get(table) ?? new Map<string, Row>();
    mirror.set(table, held);
    for (const row of rows) {
      const mine = held.get(row.id);
      const newer = !mine
        ? true
        : row.version !== undefined && mine.version !== undefined
          ? row.version > mine.version
          : row.updatedAt > mine.updatedAt;
      if (newer) held.set(row.id, row);
    }
  }
}
/** A full pull from nothing, following hasMore, as a fresh phone would do. */
async function fullPull(limit = 500) {
  const mirror = new Map<string, Map<string, Row>>();
  let cursor: string | undefined;
  let pages = 0;
  for (;;) {
    const page = await pull(cursor, limit);
    apply(mirror, page.changes);
    cursor = page.cursor;
    pages += 1;
    if (!page.hasMore) return { mirror, cursor: cursor as string, pages };
    expect(pages).toBeLessThan(200);
  }
}
const snapshot = (mirror: Map<string, Map<string, Row>>) =>
  Object.fromEntries(
    [...mirror.entries()].map(([table, rows]) => [
      table,
      [...rows.values()]
        .map((row) => [row.id, row.version ?? row.updatedAt])
        .sort(),
    ]),
  );

let checking = "";
let savings = "";
let food = "";
let fun = "";
async function seed(ledger = ledgerId) {
  const account = async (name: string) => {
    const id = newId();
    await db.insert(accounts).values({
      id,
      ledgerId: ledger,
      name,
      type: "bank",
      currency: "USD",
      openingBalance: 100_000,
    });
    return id;
  };
  const category = async (name: string) => {
    const id = newId();
    await db
      .insert(categories)
      .values({ id, ledgerId: ledger, name, kind: "expense" });
    return id;
  };
  return {
    checking: await account(`Checking ${ledger}`),
    savings: await account(`Savings ${ledger}`),
    food: await category(`Food ${ledger}`),
    fun: await category(`Fun ${ledger}`),
  };
}
const entry = (over: Record<string, unknown> = {}) => ({
  accountId: checking,
  categoryId: food,
  kind: "expense",
  date: "2026-10-05",
  amount: money(-1000),
  ...over,
});
async function clear() {
  await db
    .delete(transactionTags)
    .where(inArray(transactionTags.ledgerId, ids));
  await db.transaction(async (tx) => {
    await tx
      .delete(transactionSplits)
      .where(inArray(transactionSplits.ledgerId, ids));
    await tx.delete(transactions).where(inArray(transactions.ledgerId, ids));
  });
  await db.delete(tags).where(inArray(tags.ledgerId, ids));
  await db.delete(exchangeRates).where(inArray(exchangeRates.ledgerId, ids));
  await db.delete(currencies).where(inArray(currencies.ledgerId, ids));
  await db.delete(categories).where(inArray(categories.ledgerId, ids));
  await db.delete(accounts).where(inArray(accounts.ledgerId, ids));
  await db.delete(writeReceipts).where(inArray(writeReceipts.ledgerId, ids));
}

beforeAll(async () => {
  await applyMigrations(url);
  await db
    .insert(ledgers)
    .values(ids.map((id) => ({ id, name: "Synthetic sync suite" })));
  await seedUser(db, config, { ...people.owner, ledgerId, role: "owner" });
  await seedUser(db, config, { ...people.viewer, ledgerId, role: "viewer" });
  await seedUser(db, config, {
    ...people.outsider,
    ledgerId: otherLedger,
    role: "owner",
  });
  await app.ready();
  cookies = {
    owner: await signInCookie(app, config, people.owner.email),
    viewer: await signInCookie(app, config, people.viewer.email),
    outsider: await signInCookie(app, config, people.outsider.email),
  };
});
beforeEach(async () => {
  await clear();
  ({ checking, savings, food, fun } = await seed());
  await seed(otherLedger);
});
afterAll(async () => {
  await clear();
  const userIds = Object.values(people).map((person) => person.id);
  await db.delete(ledgerMembers).where(inArray(ledgerMembers.ledgerId, ids));
  await db.delete(ledgers).where(inArray(ledgers.id, ids));
  await db.delete(session).where(inArray(session.userId, userIds));
  await db.delete(credentials).where(inArray(credentials.userId, userIds));
  await db.delete(user).where(inArray(user.id, userIds));
  await app.close();
  await pool.end();
});

describe("pull", () => {
  it("sends every table's rows in the sync wire shape and nothing from another ledger", async () => {
    const trip = await send("POST", "/tags", { name: "Trip" });
    const made = await send(
      "POST",
      "/transactions",
      entry({ tagIds: [trip.id], payee: "Cafe" }),
    );
    await send(
      "POST",
      "/transactions",
      entry({
        amount: money(-3000),
        categoryId: null,
        splits: [
          { categoryId: food, amount: money(-1000) },
          { categoryId: fun, amount: money(-2000) },
        ],
      }),
    );
    await send("POST", "/transfers", {
      fromAccountId: checking,
      toAccountId: savings,
      amount: money(2500),
      date: "2026-10-05",
    });
    await db.insert(currencies).values({ ledgerId, code: "EUR" });
    await db.insert(exchangeRates).values({
      ledgerId,
      code: "EUR",
      date: "2026-10-01",
      rate: "1.1",
      source: "manual",
    });

    const { mirror } = await fullPull();
    const count = (table: string) => mirror.get(table)?.size ?? 0;
    expect(count("accounts")).toBe(2);
    expect(count("categories")).toBe(2);
    expect(count("tags")).toBe(1);
    expect(count("currencies")).toBe(1);
    expect(count("exchangeRates")).toBe(1);
    expect(count("transactions")).toBe(4); // an entry, a split entry and a transfer's two legs
    expect(count("transactionSplits")).toBe(2);
    expect(count("transactionTags")).toBe(1);

    const row = mirror.get("transactions")?.get(made.id) as unknown as {
      amount: { amount: number; currency: string };
      baseAmount: { currency: string };
      payee: string;
      fxRate: string;
      deletedAt: string | null;
    };
    expect(row).toMatchObject({
      amount: { amount: -1000, currency: "USD" },
      baseAmount: { currency: "USD" },
      payee: "Cafe",
      deletedAt: null,
    });
    const split = [
      ...(mirror.get("transactionSplits")?.values() ?? []),
    ][0] as unknown as {
      amount: { currency: string };
    };
    expect(split.amount.currency).toBe("USD");
    const legs = [
      ...(mirror.get("transactions")?.values() ?? []),
    ] as unknown as {
      kind: string;
      transferId: string | null;
    }[];
    const transferLegs = legs.filter((leg) => leg.kind === "transfer");
    expect(transferLegs).toHaveLength(2);
    expect(transferLegs[0]?.transferId).toBe(transferLegs[1]?.transferId);

    // Nothing of the other ledger leaks in.
    const other = await pull(undefined, 500, otherLedger).catch(() => null);
    expect(other).toBeNull();
    const foreign = await pullOnce("", otherLedger);
    expect(foreign.statusCode).toBe(404);
  });

  it("sends only what changed after the cursor, including tombstones, and converges with a fresh pull", async () => {
    const trip = await send("POST", "/tags", { name: "Trip" });
    const gift = await send("POST", "/tags", { name: "Gift" });
    const kept = await send(
      "POST",
      "/transactions",
      entry({ tagIds: [trip.id] }),
    );
    const doomed = await send(
      "POST",
      "/transactions",
      entry({ amount: money(-500), tagIds: [gift.id] }),
    );
    // Rows older than the cursor's two-minute overlap are not sent again: age everything past the window.
    for (const table of [
      "accounts",
      "categories",
      "tags",
      "transactions",
      "transaction_tags",
    ])
      await pool.query(
        `update ${table} set updated_at = now() - interval '10 minutes' where ledger_id = $1`,
        [ledgerId],
      );
    const phone = await fullPull();
    const start = await pull(phone.cursor);
    expect(
      Object.values(start.changes).every((rows) => rows.length === 0),
    ).toBe(true);

    await send("PATCH", `/tags/${trip.id}`, {
      name: "Holiday",
      expectedVersion: trip.version,
    });
    await send("PATCH", `/transactions/${kept.id}`, {
      note: "edited",
      tagIds: [gift.id],
      expectedVersion: kept.version,
    });
    await send("DELETE", `/transactions/${doomed.id}`, {
      expectedVersion: doomed.version,
    });
    await send("POST", `/accounts/${savings}/archive`, { expectedVersion: 1 });
    await send("POST", `/categories/${food}/archive`, { expectedVersion: 1 });
    await send("POST", "/transfers", {
      fromAccountId: checking,
      toAccountId: savings,
      amount: money(100),
      date: "2026-10-06",
    }).catch(() => undefined);

    const changed = await pull(start.cursor);
    const touched = (table: keyof Tables) =>
      (changed.changes[table] as Row[]).map((row) => row.id);
    expect(touched("tags")).toContain(trip.id);
    expect(touched("transactions")).toEqual(
      expect.arrayContaining([kept.id, doomed.id]),
    );
    expect(touched("accounts")).toContain(savings);
    expect(touched("categories")).toContain(food);
    const tombstone = (
      changed.changes.transactions as unknown as {
        id: string;
        deletedAt: string | null;
      }[]
    ).find((row) => row.id === doomed.id);
    expect(tombstone?.deletedAt).not.toBeNull();
    // The kept entry's tags moved: the old link is a tombstone and the new one is live.
    const links = changed.changes.transactionTags as unknown as {
      transactionId: string;
      tagId: string;
      deletedAt: string | null;
    }[];
    // A deleted entry keeps its tag links live, so Undo can bring its tags back; its own tombstone is enough.
    expect(
      links.find((link) => link.transactionId === doomed.id)?.deletedAt ?? null,
    ).toBeNull();
    expect(
      links.find(
        (link) => link.transactionId === kept.id && link.tagId === trip.id,
      )?.deletedAt,
    ).not.toBeNull();
    expect(
      links.find(
        (link) => link.transactionId === kept.id && link.tagId === gift.id,
      )?.deletedAt,
    ).toBeNull();

    apply(phone.mirror, changed.changes);
    const fresh = await fullPull();
    expect(snapshot(phone.mirror)).toEqual(snapshot(fresh.mirror));
  });

  it("pages through a table without gaps and ends", async () => {
    const made: string[] = [];
    for (let i = 0; i < 7; i++)
      made.push(
        (
          await send(
            "POST",
            "/transactions",
            entry({ amount: money(-100 - i) }),
          )
        ).id,
      );
    const { mirror, pages } = await fullPull(3);
    expect(pages).toBeGreaterThan(1);
    const got = new Set(mirror.get("transactions")?.keys());
    for (const id of made) expect(got.has(id)).toBe(true);
    expect(got.size).toBe(7);
    // Every page stays within the limit.
    const page = await pull(undefined, 3);
    expect(page.changes.transactions.length).toBeLessThanOrEqual(3);
    expect(page.hasMore).toBe(true);
  });

  it("sends a row again that committed late, after the cursor had passed its time", async () => {
    await send("POST", "/tags", { name: "Early" });
    const first = await pull();
    const lateId = newId();
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query(
        "insert into tags (id, ledger_id, name) values ($1, $2, 'Late')",
        [lateId, ledgerId],
      );
      // Other work commits meanwhile and a pull runs: it cannot see the open transaction.
      await send("POST", "/tags", { name: "Meanwhile" });
      const during = await pull(first.cursor);
      expect(during.changes.tags.map((tag) => tag.id)).not.toContain(lateId);
      await client.query("commit");
    } finally {
      client.release();
    }
    const after = await pull(during());
    expect(after.changes.tags.map((tag) => tag.name)).toContain("Late");
    function during() {
      return first.cursor;
    }
  });

  it("returns an empty page for a ledger with nothing in it, and the cursor works", async () => {
    await clear();
    const page = await pull();
    expect(Object.values(page.changes).every((rows) => rows.length === 0)).toBe(
      true,
    );
    expect(page.hasMore).toBe(false);
    expect((await pull(page.cursor)).hasMore).toBe(false);
  });
});

describe("pull access and input", () => {
  it("lets a viewer read, hides other ledgers, and needs a session", async () => {
    expect((await pullOnce("", ledgerId, cookies.viewer)).statusCode).toBe(200);
    expect((await pullOnce("", ledgerId, cookies.outsider)).statusCode).toBe(
      404,
    );
    const anonymous = await app.inject({ url: `${base()}/sync` });
    expect(anonymous.statusCode).toBe(401);
  });

  it("works with the Android app's bearer token", async () => {
    const signedIn = await app.inject({
      method: "POST",
      url: "/api/v1/auth/sign-in/email",
      headers: {
        origin: config.APP_URL,
        "x-ledgerline-client": "android",
        "x-forwarded-for": "10.40.0.1",
      },
      payload: { email: people.owner.email, password: config.OWNER_PASSWORD },
    });
    const token = signedIn.headers["set-auth-token"] as string;
    expect(token).toBeTruthy();
    const response = await app.inject({
      url: `${base()}/sync`,
      headers: { authorization: `Bearer ${token}`, origin: config.APP_URL },
    });
    expect(response.statusCode, response.body).toBe(200);
  });

  it("rejects a cursor the server did not make and a bad limit", async () => {
    for (const query of [
      "?cursor=nonsense",
      `?cursor=${Buffer.from("{}").toString("base64url")}`,
      `?cursor=${Buffer.from(JSON.stringify({ v: 1, p: { accounts: { at: "x", id: "y" } } })).toString("base64url")}`,
      "?limit=0",
      "?limit=1001",
      "?limit=x",
      "?extra=1",
    ])
      expect((await pullOnce(query)).statusCode, query).toBe(400);
  });
});
