import { newId, tagListSchema, tagSchema } from "@ledgerline/shared";
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
  tags,
  transactionSplits,
  transactions,
  transactionTags,
  user,
  writeReceipts,
} from "../../db/schema";
import {
  requireTestDatabase,
  signInCookie,
  testConfig,
} from "../../test-support/harness";
import { hashPassword } from "../auth/password";

const url = requireTestDatabase("Tag tests");
const config = testConfig(url, "tags");
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
const call = (
  method: "POST" | "PATCH" | "DELETE",
  path: string,
  body: unknown,
  options: { ledger?: string; cookie?: string; key?: string } = {},
) =>
  app.inject({
    url: base(options.ledger) + path,
    method,
    headers: {
      cookie: options.cookie ?? (cookies[0] as string),
      origin: config.APP_URL,
      "idempotency-key": options.key ?? newId(),
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
  const response = await call(method, path, body, { ledger });
  expect(response.statusCode, response.body).toBeLessThan(300);
  return response.body ? response.json() : undefined;
}
type Tag = { id: string; version: number; name: string; usageCount: number };
type Ref = { id: string; name: string; archived: boolean };
const makeTag = (name: string, ledger = ledgerId): Promise<Tag> =>
  send("POST", "/tags", { name }, ledger);

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
type Entry = { id: string; version: number; tags: Ref[] };
const makeEntry = (over: Record<string, unknown> = {}): Promise<Entry> =>
  send("POST", "/transactions", entry(over));
const listEntries = async (query = "") => {
  const response = await get(`/transactions?limit=100${query}`);
  expect(response.statusCode, response.body).toBe(200);
  return response.json().items as (Entry & { kind: string })[];
};
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
  await db.delete(categories).where(inArray(categories.ledgerId, ids));
  await db.delete(accounts).where(inArray(accounts.ledgerId, ids));
  await db.delete(writeReceipts).where(inArray(writeReceipts.ledgerId, ids));
}
let foreign: Awaited<ReturnType<typeof seed>>;

beforeAll(async () => {
  await applyMigrations(url);
  await db
    .insert(ledgers)
    .values(ids.map((id) => ({ id, name: "Synthetic Tag suite" })));
  const password = await hashPassword(config.OWNER_PASSWORD);
  for (const [i, role] of roles.entries()) {
    const id = users[i] as string;
    await db
      .insert(user)
      .values({ id, name: role, email: `tags-${role}-${id}@example.com` });
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
      await signInCookie(app, config, `tags-${role}-${users[i]}@example.com`),
    );
});
beforeEach(async () => {
  await clear();
  ({ checking, savings, food, fun } = await seed());
  foreign = await seed(otherLedger);
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

describe("tag management", () => {
  it("creates, lists, renames, archives and deletes tags", async () => {
    const trip = await makeTag("Trip");
    expect(tagSchema.parse(trip)).toMatchObject({
      name: "Trip",
      archivedAt: null,
      usageCount: 0,
      version: 1,
    });
    await makeTag("Gift");
    const renamed = await send("PATCH", `/tags/${trip.id}`, {
      name: "Holiday",
      expectedVersion: 1,
    });
    expect(renamed).toMatchObject({ name: "Holiday", version: 2 });
    const archived = await send("POST", `/tags/${trip.id}/archive`, {
      expectedVersion: 2,
    });
    expect(archived.archivedAt).not.toBeNull();
    const all = tagListSchema.parse((await get("/tags")).json());
    expect(all.items.map((row) => row.name).sort()).toEqual([
      "Gift",
      "Holiday",
    ]);
    const active = tagListSchema.parse(
      (await get("/tags?status=active")).json(),
    );
    expect(active.items.map((row) => row.name)).toEqual(["Gift"]);
    const back = await send("POST", `/tags/${trip.id}/unarchive`, {
      expectedVersion: 3,
    });
    expect(back.archivedAt).toBeNull();
    await send("DELETE", `/tags/${trip.id}`, { expectedVersion: 4 });
    expect((await get(`/tags/${trip.id}`)).statusCode).toBe(404);
  });

  it("keeps names unique ignoring case, spaces and archives", async () => {
    const trip = await makeTag("Trip");
    for (const name of ["trip", "  TRIP  "]) {
      const response = await call("POST", "/tags", { name });
      expect(response.statusCode).toBe(409);
    }
    await send("POST", `/tags/${trip.id}/archive`, { expectedVersion: 1 });
    expect((await call("POST", "/tags", { name: "TRIP" })).statusCode).toBe(
      409,
    );
    const other = await makeTag("Gift");
    const clash = await call("PATCH", `/tags/${other.id}`, {
      name: "trip",
      expectedVersion: 1,
    });
    expect(clash.statusCode).toBe(409);
    // Renaming a tag to its own name in another case is allowed.
    expect(
      (
        await call("PATCH", `/tags/${other.id}`, {
          name: "GIFT",
          expectedVersion: 1,
        })
      ).statusCode,
    ).toBe(200);
  });

  it("rejects bad names", async () => {
    for (const name of ["", "   ", "a,b", "a;b", "x".repeat(41), "tab\there"])
      expect(
        (await call("POST", "/tags", { name })).statusCode,
        JSON.stringify(name),
      ).toBe(400);
    expect(
      (await call("POST", "/tags", { name: "x".repeat(40) })).statusCode,
    ).toBe(201);
  });

  it("replays a retried create and rejects stale versions", async () => {
    const key = newId();
    const first = await call("POST", "/tags", { name: "Once" }, { key });
    const second = await call("POST", "/tags", { name: "Once" }, { key });
    expect(second.statusCode).toBe(201);
    expect(second.json().id).toBe(first.json().id);
    const stale = await call("PATCH", `/tags/${first.json().id}`, {
      name: "Twice",
      expectedVersion: 5,
    });
    expect(stale.statusCode).toBe(409);
  });

  it("lets viewers read and blocks their writes", async () => {
    const trip = await makeTag("Trip");
    expect(
      (await get("/tags", ledgerId, cookies[2] as string)).statusCode,
    ).toBe(200);
    const viewer = { cookie: cookies[2] as string };
    expect(
      (await call("POST", "/tags", { name: "No" }, viewer)).statusCode,
    ).toBe(403);
    expect(
      (await call("DELETE", `/tags/${trip.id}`, { expectedVersion: 1 }, viewer))
        .statusCode,
    ).toBe(403);
    const editor = { cookie: cookies[1] as string };
    expect(
      (await call("POST", "/tags", { name: "Yes" }, editor)).statusCode,
    ).toBe(201);
  });

  it("never reads or writes another ledger's tags", async () => {
    const mine = await makeTag("Mine");
    const theirs = await makeTag("Theirs", otherLedger);
    const listed = tagListSchema.parse((await get("/tags")).json());
    expect(listed.items.map((row) => row.id)).toEqual([mine.id]);
    // The same name can exist in two ledgers.
    await makeTag("Mine", otherLedger);
    expect((await get(`/tags/${theirs.id}`)).statusCode).toBe(404);
    for (const [method, path, body] of [
      ["PATCH", `/tags/${theirs.id}`, { name: "Nope", expectedVersion: 1 }],
      ["POST", `/tags/${theirs.id}/archive`, { expectedVersion: 1 }],
      ["POST", `/tags/${theirs.id}/unarchive`, { expectedVersion: 1 }],
      ["DELETE", `/tags/${theirs.id}`, { expectedVersion: 1 }],
    ] as const)
      expect((await call(method, path, body)).statusCode, path).toBe(404);
    // Another ledger's tag cannot be put on this ledger's entry.
    const response = await call(
      "POST",
      "/transactions",
      entry({ tagIds: [theirs.id] }),
    );
    expect(response.statusCode).toBe(404);
    const own = await makeEntry();
    const patch = await call("PATCH", `/transactions/${own.id}`, {
      tagIds: [theirs.id],
      expectedVersion: own.version,
    });
    expect(patch.statusCode).toBe(404);
    expect(foreign.checking).toBeTruthy();
    // The other ledger still has its tag, untouched.
    expect((await get(`/tags/${theirs.id}`, otherLedger)).statusCode).toBe(200);
  });
});

describe("tags on entries", () => {
  it("saves tags with an entry, shows them and filters by them", async () => {
    const trip = await makeTag("Trip");
    const gift = await makeTag("Gift");
    const both = await makeEntry({ tagIds: [trip.id, gift.id] });
    const one = await makeEntry({ tagIds: [gift.id], date: "2026-10-06" });
    await makeEntry({ date: "2026-10-07" });
    expect(both.tags.map((tag) => tag.name).sort()).toEqual(["Gift", "Trip"]);
    expect(
      ((await get(`/transactions/${both.id}`)).json() as Entry).tags,
    ).toHaveLength(2);
    const filtered = await listEntries(`&tagId=${gift.id}`);
    expect(filtered.map((row) => row.id).sort()).toEqual(
      [both.id, one.id].sort(),
    );
    expect(await listEntries(`&tagId=${trip.id}`)).toHaveLength(1);
    expect(await listEntries()).toHaveLength(3);
    const usage = tagListSchema.parse((await get("/tags")).json()).items;
    expect(usage.find((row) => row.id === gift.id)?.usageCount).toBe(2);
    expect(usage.find((row) => row.id === trip.id)?.usageCount).toBe(1);
  });

  it("replaces, keeps and clears tags on edit", async () => {
    const trip = await makeTag("Trip");
    const gift = await makeTag("Gift");
    const made = await makeEntry({ tagIds: [trip.id] });
    const swapped = await send("PATCH", `/transactions/${made.id}`, {
      tagIds: [gift.id],
      expectedVersion: made.version,
    });
    expect(swapped.tags.map((tag: Ref) => tag.name)).toEqual(["Gift"]);
    expect(swapped.version).toBe(made.version + 1);
    const noted = await send("PATCH", `/transactions/${made.id}`, {
      note: "kept",
      expectedVersion: swapped.version,
    });
    expect(noted.tags.map((tag: Ref) => tag.name)).toEqual(["Gift"]);
    const cleared = await send("PATCH", `/transactions/${made.id}`, {
      tagIds: [],
      expectedVersion: noted.version,
    });
    expect(cleared.tags).toEqual([]);
    expect(await listEntries(`&tagId=${gift.id}`)).toHaveLength(0);
    // A tag can go back on after it came off.
    const again = await send("PATCH", `/transactions/${made.id}`, {
      tagIds: [gift.id, trip.id],
      expectedVersion: cleared.version,
    });
    expect(again.tags).toHaveLength(2);
  });

  it("limits and checks the tag list", async () => {
    const trip = await makeTag("Trip");
    const twice = await call(
      "POST",
      "/transactions",
      entry({ tagIds: [trip.id, trip.id] }),
    );
    expect(twice.statusCode).toBe(400);
    const many = await Promise.all(
      Array.from({ length: 11 }, (_, i) => makeTag(`T${i}`)),
    );
    const tooMany = await call(
      "POST",
      "/transactions",
      entry({ tagIds: many.map((tag) => tag.id) }),
    );
    expect(tooMany.statusCode).toBe(400);
    const ten = await call(
      "POST",
      "/transactions",
      entry({ tagIds: many.slice(0, 10).map((tag) => tag.id) }),
    );
    expect(ten.statusCode).toBe(201);
    const missing = await call(
      "POST",
      "/transactions",
      entry({ tagIds: [newId()] }),
    );
    expect(missing.statusCode).toBe(404);
  });

  it("keeps an archived tag on its entries and still allows it", async () => {
    const trip = await makeTag("Trip");
    const made = await makeEntry({ tagIds: [trip.id] });
    await send("POST", `/tags/${trip.id}/archive`, { expectedVersion: 1 });
    const read = (await get(`/transactions/${made.id}`)).json() as Entry;
    expect(read.tags).toEqual([{ id: trip.id, name: "Trip", archived: true }]);
    expect(await listEntries(`&tagId=${trip.id}`)).toHaveLength(1);
    const second = await makeEntry({ tagIds: [trip.id] });
    expect(second.tags[0]?.archived).toBe(true);
  });

  it("works with split entries", async () => {
    const trip = await makeTag("Trip");
    const split = await makeEntry({
      categoryId: null,
      amount: money(-3000),
      splits: [
        { categoryId: food, amount: money(-1000) },
        { categoryId: fun, amount: money(-2000) },
      ],
      tagIds: [trip.id],
    });
    expect(split.tags).toHaveLength(1);
    const found = await listEntries(`&tagId=${trip.id}`);
    expect(found).toHaveLength(1);
  });

  it("brings an entry's tags back with Undo", async () => {
    const trip = await makeTag("Trip");
    const made = await makeEntry({ tagIds: [trip.id] });
    await send("DELETE", `/transactions/${made.id}`, {
      expectedVersion: made.version,
    });
    const restored = await send("POST", `/transactions/${made.id}/restore`, {
      expectedVersion: made.version + 1,
    });
    expect(restored.tags.map((tag: Ref) => tag.name)).toEqual(["Trip"]);
  });

  it("deletes only tags no live entry uses", async () => {
    const trip = await makeTag("Trip");
    const made = await makeEntry({ tagIds: [trip.id] });
    const blocked = await call("DELETE", `/tags/${trip.id}`, {
      expectedVersion: 1,
    });
    expect(blocked.statusCode).toBe(409);
    // Once the entry is deleted the tag may go, and the entry comes back without it.
    await send("DELETE", `/transactions/${made.id}`, {
      expectedVersion: made.version,
    });
    await send("DELETE", `/tags/${trip.id}`, { expectedVersion: 1 });
    const restored = await send("POST", `/transactions/${made.id}/restore`, {
      expectedVersion: made.version + 1,
    });
    expect(restored.tags).toEqual([]);
    // The name is free again.
    await makeTag("Trip");
  });
});

describe("tags on transfers", () => {
  const transfer = (over: Record<string, unknown> = {}) => ({
    fromAccountId: checking,
    toAccountId: savings,
    amount: money(2500),
    date: "2026-10-05",
    ...over,
  });
  it("puts the same tags on both legs and counts the transfer once", async () => {
    const trip = await makeTag("Trip");
    const made = await send(
      "POST",
      "/transfers",
      transfer({ tagIds: [trip.id] }),
    );
    expect(made.tags.map((tag: Ref) => tag.name)).toEqual(["Trip"]);
    const legs = (await listEntries(`&tagId=${trip.id}`)).filter(
      (row) => row.kind === "transfer",
    );
    expect(legs).toHaveLength(2);
    expect(legs.every((leg) => leg.tags.length === 1)).toBe(true);
    const usage = tagListSchema.parse((await get("/tags")).json()).items;
    expect(usage[0]?.usageCount).toBe(1);
    const read = (await get(`/transfers/${made.id}`)).json();
    expect(read.tags).toHaveLength(1);
  });

  it("changes tags on edit and keeps them when omitted", async () => {
    const trip = await makeTag("Trip");
    const gift = await makeTag("Gift");
    const made = await send(
      "POST",
      "/transfers",
      transfer({ tagIds: [trip.id] }),
    );
    const kept = await send("PATCH", `/transfers/${made.id}`, {
      ...transfer({ time: null, note: "kept" }),
      expectedVersion: made.version,
    });
    expect(kept.tags).toHaveLength(1);
    const swapped = await send("PATCH", `/transfers/${made.id}`, {
      ...transfer({ time: null, note: null }),
      tagIds: [gift.id],
      expectedVersion: kept.version,
    });
    expect(swapped.tags.map((tag: Ref) => tag.name)).toEqual(["Gift"]);
    expect(await listEntries(`&tagId=${trip.id}`)).toHaveLength(0);
    expect(await listEntries(`&tagId=${gift.id}`)).toHaveLength(2);
    const cleared = await send("PATCH", `/transfers/${made.id}`, {
      ...transfer({ time: null, note: null }),
      tagIds: [],
      expectedVersion: swapped.version,
    });
    expect(cleared.tags).toEqual([]);
  });

  it("does not hand its tags to the fee or the bonus", async () => {
    const trip = await makeTag("Trip");
    const income = newId();
    await db
      .insert(categories)
      .values({ id: income, ledgerId, name: "Bonus", kind: "income" });
    const made = await send(
      "POST",
      "/transfers",
      transfer({
        tagIds: [trip.id],
        fee: { amount: money(100), categoryId: food },
        bonus: { amount: money(50), categoryId: income },
      }),
    );
    expect(made.fee).not.toBeNull();
    expect(made.bonus).not.toBeNull();
    const tagged = await listEntries(`&tagId=${trip.id}`);
    expect(tagged.map((row) => row.kind)).toEqual(["transfer", "transfer"]);
  });

  it("restores a deleted transfer with its tags", async () => {
    const trip = await makeTag("Trip");
    const made = await send(
      "POST",
      "/transfers",
      transfer({ tagIds: [trip.id] }),
    );
    await send("DELETE", `/transfers/${made.id}`, {
      expectedVersion: made.version,
    });
    const back = await send("POST", `/transfers/${made.id}/restore`, {
      expectedVersion: made.version + 1,
    });
    expect(back.tags).toHaveLength(1);
  });
});

describe("tags never change totals", () => {
  it("leaves balances, Home and reports exactly as they were", async () => {
    const trip = await makeTag("Trip");
    const gift = await makeTag("Gift");
    const a = await makeEntry({ amount: money(-1234) });
    const b = await makeEntry({ amount: money(-4321), categoryId: fun });
    await send("POST", "/transfers", {
      fromAccountId: checking,
      toAccountId: savings,
      amount: money(500),
      date: "2026-10-05",
    });
    const read = async () => ({
      accounts: (await get("/accounts")).json(),
      spending: (await get("/reports/spending?month=2026-10")).json(),
      flow: (await get("/reports/cash-flow?to=2026-10&months=3")).json(),
      home: (await get("/home")).json().totals,
    });
    const before = await read();
    await send("PATCH", `/transactions/${a.id}`, {
      tagIds: [trip.id, gift.id],
      expectedVersion: a.version,
    });
    await send("PATCH", `/transactions/${b.id}`, {
      tagIds: [gift.id],
      expectedVersion: b.version,
    });
    const strip = (value: unknown) =>
      JSON.parse(
        JSON.stringify(value, (key, v) =>
          key === "updatedAt" || key === "version" ? undefined : v,
        ),
      );
    expect(strip(await read())).toEqual(strip(before));
  });
});

describe("export filter", () => {
  it("applies the tag filter to the transactions export", async () => {
    const trip = await makeTag("Trip");
    await makeEntry({ tagIds: [trip.id], payee: "Tagged shop" });
    await makeEntry({ payee: "Plain shop" });
    const response = await get(`/exports/transactions.csv?tagId=${trip.id}`);
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain("Tagged shop");
    expect(response.body).not.toContain("Plain shop");
  });
});
