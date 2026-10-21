import {
  newId,
  type SyncMutation,
  type SyncResult,
  syncPushResponseSchema,
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

// ADR 0042, the push side: the phone's offline changes apply once, in order, with last write wins per row.
const url = requireTestDatabase("Sync push tests");
const config = testConfig(url, "syncpush");
const { db, pool } = createDatabase(url);
const app = await buildApp(db, config);
const ledgerId = newId();
const otherLedger = newId();
const ids = [ledgerId, otherLedger];
const people = {
  owner: { id: newId(), email: "syncpush-person-owner@example.com" },
  viewer: { id: newId(), email: "syncpush-person-viewer@example.com" },
  outsider: { id: newId(), email: "syncpush-person-outsider@example.com" },
};
let cookies = { owner: "", viewer: "", outsider: "" };
const money = (amount: number) => ({ amount, currency: "USD" });
const base = (ledger = ledgerId) => `/api/v1/ledgers/${ledger}`;

type Row = {
  id: string;
  version: number;
  updatedAt: string;
  deletedAt: string | null;
  note: string | null;
  amount: { amount: number; currency: string };
  transferId: string | null;
};
type Body = Record<string, unknown>;

const rest = (
  method: "POST" | "PATCH" | "DELETE",
  path: string,
  body: unknown,
  ledger = ledgerId,
) =>
  app.inject({
    url: base(ledger) + path,
    method,
    headers: {
      cookie: cookies.owner,
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
) {
  const response = await rest(method, path, body);
  expect(response.statusCode, response.body).toBeLessThan(300);
  return response.body ? response.json() : undefined;
}
const pushRaw = (
  payload: unknown,
  options: { ledger?: string; cookie?: string; origin?: string | null } = {},
) =>
  app.inject({
    method: "POST",
    url: `${base(options.ledger)}/sync`,
    headers: {
      cookie: options.cookie ?? cookies.owner,
      ...(options.origin === null
        ? {}
        : { origin: options.origin ?? config.APP_URL }),
      "content-type": "application/json",
    },
    payload: JSON.stringify(payload),
  });
async function push(mutations: SyncMutation[], ledger = ledgerId) {
  const response = await pushRaw({ mutations }, { ledger });
  expect(response.statusCode, response.body).toBe(200);
  return syncPushResponseSchema.parse(response.json()).results;
}
const now = () => new Date().toISOString();
const mutation = (
  type: SyncMutation["type"],
  over: Partial<SyncMutation> = {},
): SyncMutation => ({
  id: newId(),
  type,
  editedAt: now(),
  body: {},
  ...over,
});
async function fullPull() {
  const response = await app.inject({
    url: `${base()}/sync?limit=1000`,
    headers: { cookie: cookies.owner },
  });
  expect(response.statusCode, response.body).toBe(200);
  return syncResponseSchema.parse(response.json()).changes;
}
const entryRow = async (id: string) =>
  (await fullPull()).transactions.find(
    (row) => row.id === id,
  ) as unknown as Row;
const dbRows = async () =>
  (
    await db
      .select()
      .from(transactions)
      .where(inArray(transactions.ledgerId, ids))
  ).length;

let checking = "";
let savings = "";
let food = "";
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
  };
}
const entryBody = (over: Body = {}): Body => ({
  accountId: checking,
  categoryId: food,
  kind: "expense",
  date: "2026-10-05",
  amount: money(-1000),
  ...over,
});
const transferBody = (over: Body = {}): Body => ({
  fromAccountId: checking,
  toAccountId: savings,
  amount: money(2500),
  date: "2026-10-05",
  ...over,
});
const createEntry = async (over: Body = {}) => {
  const id = newId();
  const [result] = await push([
    mutation("transaction.create", { id, body: entryBody(over) }),
  ]);
  expect(result?.status).toBe("applied");
  return id;
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

beforeAll(async () => {
  await applyMigrations(url);
  await db
    .insert(ledgers)
    .values(ids.map((id) => ({ id, name: "Synthetic push suite" })));
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
  ({ checking, savings, food } = await seed());
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

describe("creates", () => {
  it("makes the entry with the phone's id and returns it", async () => {
    const id = newId();
    const [result] = await push([
      mutation("transaction.create", {
        id,
        body: entryBody({ payee: "Cafe" }),
      }),
    ]);
    expect(result).toMatchObject({ id, status: "applied" });
    expect(result?.rows).toHaveLength(1);
    expect(result?.rows[0]).toMatchObject({
      id,
      version: 1,
      payee: "Cafe",
      deletedAt: null,
    });
    const read = await rest("POST", "/transactions", {}).then(() =>
      app.inject({
        url: `${base()}/transactions/${id}`,
        headers: { cookie: cookies.owner },
      }),
    );
    expect(read.statusCode).toBe(200);
    expect(read.json().amount).toEqual(money(-1000));
  });

  it("applies the same batch twice without changing anything the second time", async () => {
    const id = newId();
    const batch = [
      mutation("transaction.create", { id, body: entryBody() }),
      mutation("transfer.create", { id: newId(), body: transferBody() }),
    ];
    const first = await push(batch);
    expect(first.map((item) => item.status)).toEqual(["applied", "applied"]);
    const rowsBefore = await dbRows();
    const again = await push(batch);
    expect(again.map((item) => item.status)).toEqual(["replayed", "replayed"]);
    expect(await dbRows()).toBe(rowsBefore);
    expect(again[0]?.rows[0]?.version).toBe(1);
  });

  it("finishes a batch that was cut off: the sent part replays and the rest applies", async () => {
    const a = mutation("transaction.create", {
      body: entryBody({ amount: money(-100) }),
    });
    const b = mutation("transaction.create", {
      body: entryBody({ amount: money(-200) }),
    });
    const c = mutation("transaction.create", {
      body: entryBody({ amount: money(-300) }),
    });
    await push([a, b]);
    const results = await push([a, b, c]);
    expect(results.map((item) => item.status)).toEqual([
      "replayed",
      "replayed",
      "applied",
    ]);
    expect((await fullPull()).transactions).toHaveLength(3);
  });

  it("creates a split entry with tags and a transfer with its two legs, under the phone's transfer id", async () => {
    const tag = await send("POST", "/tags", { name: "Trip" });
    const splitId = newId();
    const transferId = newId();
    const results = await push([
      mutation("transaction.create", {
        id: splitId,
        body: entryBody({
          categoryId: null,
          amount: money(-3000),
          tagIds: [tag.id],
          splits: [
            { categoryId: food, amount: money(-1000) },
            { categoryId: food, amount: money(-2000) },
          ],
        }),
      }),
      mutation("transfer.create", {
        id: transferId,
        body: transferBody({ tagIds: [tag.id] }),
      }),
    ]);
    expect(results.map((item) => item.status)).toEqual(["applied", "applied"]);
    expect(results[1]?.rows).toHaveLength(2);
    expect(results[1]?.rows.every((row) => row.transferId === transferId)).toBe(
      true,
    );
    const pulled = await fullPull();
    expect(pulled.transactionSplits).toHaveLength(2);
    expect(pulled.transactionTags).toHaveLength(3);
  });
});

describe("last write wins", () => {
  it("applies a change made against the version the server has", async () => {
    const id = await createEntry();
    const [result] = await push([
      mutation("transaction.update", {
        targetId: id,
        baseVersion: 1,
        body: { note: "from phone" },
      }),
    ]);
    expect(result?.status).toBe("applied");
    expect(result?.rows[0]).toMatchObject({ note: "from phone", version: 2 });
  });

  it("lets the later edit win when the row changed in between, and tells the loser", async () => {
    const id = await createEntry();
    await send("PATCH", `/transactions/${id}`, {
      note: "on the web",
      expectedVersion: 1,
    });
    const serverRow = await entryRow(id);
    const at = (offsetMs: number) =>
      new Date(Date.parse(serverRow.updatedAt) + offsetMs).toISOString();

    const older = await push([
      mutation("transaction.update", {
        targetId: id,
        baseVersion: 1,
        editedAt: at(-60_000),
        body: { note: "older phone edit" },
      }),
    ]);
    expect(older[0]?.status).toBe("superseded");
    expect(older[0]?.rows[0]).toMatchObject({ note: "on the web", version: 2 });

    const tie = await push([
      mutation("transaction.update", {
        targetId: id,
        baseVersion: 1,
        editedAt: serverRow.updatedAt,
        body: { note: "tied phone edit" },
      }),
    ]);
    expect(tie[0]?.status).toBe("superseded");

    const later = await push([
      mutation("transaction.update", {
        targetId: id,
        baseVersion: 1,
        editedAt: at(1_000),
        body: { note: "later phone edit" },
      }),
    ]);
    expect(later[0]?.status).toBe("applied");
    expect(later[0]?.rows[0]).toMatchObject({
      note: "later phone edit",
      version: 3,
    });
  });

  it("treats a phone clock that is ahead as the moment the server got the change", async () => {
    const id = await createEntry();
    // The web changes the entry, then the row is made to look ten minutes old.
    await send("PATCH", `/transactions/${id}`, {
      note: "web",
      expectedVersion: 1,
    });
    await pool.query(
      "update transactions set updated_at = now() - interval '10 minutes' where id = $1",
      [id],
    );
    const future = new Date(Date.now() + 3_600_000).toISOString();
    const [ahead] = await push([
      mutation("transaction.update", {
        targetId: id,
        baseVersion: 1,
        editedAt: future,
        body: { note: "ahead" },
      }),
    ]);
    // The claim counts as "now", which is later than ten minutes ago: it wins, and the row's own time is the server's.
    expect(ahead?.status).toBe("applied");
    const row = await entryRow(id);
    expect(Math.abs(Date.now() - Date.parse(row.updatedAt))).toBeLessThan(
      60_000,
    );
    // A claim from the past still loses to a change the server made just now.
    await send("PATCH", `/transactions/${id}`, {
      note: "web again",
      expectedVersion: row.version,
    });
    const [old] = await push([
      mutation("transaction.update", {
        targetId: id,
        baseVersion: row.version,
        editedAt: new Date(Date.now() - 600_000).toISOString(),
        body: { note: "behind" },
      }),
    ]);
    expect(old?.status).toBe("superseded");
    const [stale] = await push([
      mutation("transaction.update", {
        targetId: id,
        baseVersion: 1,
        editedAt: new Date(Date.now() - 600_000).toISOString(),
        body: { note: "stale and old" },
      }),
    ]);
    expect(stale?.status).toBe("superseded");
  });

  it("lets a delete win over an older edit, and an edit lose to a delete", async () => {
    const id = await createEntry();
    await send("DELETE", `/transactions/${id}`, { expectedVersion: 1 });
    const edit = await push([
      mutation("transaction.update", {
        targetId: id,
        baseVersion: 1,
        body: { note: "too late" },
      }),
    ]);
    expect(edit[0]?.status).toBe("superseded");
    expect(edit[0]?.rows[0]?.deletedAt).not.toBeNull();
    const again = await push([
      mutation("transaction.delete", { targetId: id, baseVersion: 1 }),
    ]);
    expect(again[0]?.status).toBe("applied");

    const second = await createEntry();
    await send("PATCH", `/transactions/${second}`, {
      note: "web",
      expectedVersion: 1,
    });
    const serverRow = await entryRow(second);
    const loses = await push([
      mutation("transaction.delete", {
        targetId: second,
        baseVersion: 1,
        editedAt: new Date(
          Date.parse(serverRow.updatedAt) - 1000,
        ).toISOString(),
      }),
    ]);
    expect(loses[0]?.status).toBe("superseded");
    expect((await entryRow(second)).deletedAt).toBeNull();
    const wins = await push([
      mutation("transaction.delete", { targetId: second, baseVersion: 1 }),
    ]);
    expect(wins[0]?.status).toBe("applied");
    expect((await entryRow(second)).deletedAt).not.toBeNull();
  });

  it("updates and deletes a transfer, with the same rules", async () => {
    const transferId = newId();
    const [created] = await push([
      mutation("transfer.create", { id: transferId, body: transferBody() }),
    ]);
    const from = created?.rows.find((row) => row.amount.amount < 0);
    expect(from?.version).toBe(1);
    const [edited] = await push([
      mutation("transfer.update", {
        targetId: transferId,
        baseVersion: 1,
        body: transferBody({ amount: money(4000), time: null, note: null }),
      }),
    ]);
    expect(edited?.status, JSON.stringify(edited?.problem)).toBe("applied");
    expect(
      edited?.rows.find((row) => row.amount.amount < 0)?.amount.amount,
    ).toBe(-4000);
    const stale = await push([
      mutation("transfer.update", {
        targetId: transferId,
        baseVersion: 1,
        editedAt: new Date(Date.now() - 3_600_000).toISOString(),
        body: transferBody({ amount: money(9000), time: null, note: null }),
      }),
    ]);
    expect(stale[0]?.status).toBe("superseded");
    const [removed] = await push([
      mutation("transfer.delete", { targetId: transferId, baseVersion: 2 }),
    ]);
    expect(removed?.status).toBe("applied");
    expect(removed?.rows.every((row) => row.deletedAt !== null)).toBe(true);
    const [after] = await push([
      mutation("transfer.update", {
        targetId: transferId,
        baseVersion: 2,
        body: transferBody(),
      }),
    ]);
    expect(after?.status).toBe("superseded");
  });
});

describe("rejections", () => {
  it("rejects only the bad mutation and still applies the rest", async () => {
    const good = newId();
    const results = await push([
      mutation("transaction.create", {
        body: entryBody({ amount: money(500) }),
      }),
      mutation("transaction.create", { id: good, body: entryBody() }),
      mutation("transaction.update", {
        targetId: newId(),
        baseVersion: 1,
        body: { note: "x" },
      }),
      mutation("transaction.update", { body: { note: "x" } }),
    ]);
    expect(results.map((item) => item.status)).toEqual([
      "rejected",
      "applied",
      "rejected",
      "rejected",
    ]);
    expect(results[0]?.problem?.status).toBe(400);
    expect(results[0]?.problem?.errors?.length).toBeGreaterThan(0);
    expect(results[2]?.problem?.status).toBe(404);
    expect(results[3]?.problem?.errors?.[0]?.field).toBe("targetId");
    expect((await fullPull()).transactions.map((row) => row.id)).toEqual([
      good,
    ]);
  });

  it("refuses an id that is taken, a reused mutation id with different content, and a transfer leg edited as an entry", async () => {
    const id = await createEntry();
    const taken = await push([
      mutation("transaction.create", { id: newId(), body: entryBody() }),
    ]);
    expect(taken[0]?.status).toBe("applied");
    const collide = await push([
      mutation("transaction.create", {
        id,
        body: entryBody({ amount: money(-5) }),
      }),
    ]);
    expect(collide[0]?.status).toBe("rejected");
    expect(collide[0]?.problem?.status).toBe(409);

    const reused = newId();
    await push([
      mutation("transaction.create", { id: reused, body: entryBody() }),
    ]);
    const changed = await push([
      mutation("transaction.create", {
        id: reused,
        body: entryBody({ amount: money(-77) }),
      }),
    ]);
    expect(changed[0]?.status).toBe("rejected");
    expect(changed[0]?.problem?.status).toBe(409);

    const transferId = newId();
    const [made] = await push([
      mutation("transfer.create", { id: transferId, body: transferBody() }),
    ]);
    const leg = made?.rows[0] as SyncResult["rows"][number];
    const asEntry = await push([
      mutation("transaction.update", {
        targetId: leg.id,
        baseVersion: leg.version,
        body: { note: "x" },
      }),
    ]);
    expect(asEntry[0]?.status).toBe("rejected");
    expect(asEntry[0]?.problem?.status).toBe(409);
  });

  it("does not let a ledger touch another ledger's rows or ids", async () => {
    const foreign = newId();
    await rest("POST", "/transactions", {}, otherLedger);
    // Make an entry in the other ledger directly, then try to edit it through this ledger.
    const otherChecking = (await db.select().from(accounts)).find(
      (row) => row.ledgerId === otherLedger,
    )?.id as string;
    const otherFood = (await db.select().from(categories)).find(
      (row) => row.ledgerId === otherLedger,
    )?.id as string;
    await db.insert(transactions).values({
      id: foreign,
      ledgerId: otherLedger,
      accountId: otherChecking,
      categoryId: otherFood,
      kind: "expense",
      date: "2026-10-05",
      amount: -100,
      currency: "USD",
      baseAmount: -100,
    });
    const results = await push([
      mutation("transaction.update", {
        targetId: foreign,
        baseVersion: 1,
        body: { note: "no" },
      }),
      mutation("transaction.delete", { targetId: foreign, baseVersion: 1 }),
      mutation("transaction.create", { id: foreign, body: entryBody() }),
    ]);
    expect(results.map((item) => item.status)).toEqual([
      "rejected",
      "rejected",
      "rejected",
    ]);
    expect(results.map((item) => item.problem?.status)).toEqual([
      404, 404, 409,
    ]);
    expect(results.every((item) => item.rows.length === 0)).toBe(true);
    const row = await db
      .select()
      .from(transactions)
      .where(inArray(transactions.id, [foreign]));
    expect(row[0]).toMatchObject({ deletedAt: null, note: null, version: 1 });
  });
});

describe("access and input", () => {
  it("blocks viewers and outsiders for the whole request and needs a session and an origin", async () => {
    const body = {
      mutations: [mutation("transaction.create", { body: entryBody() })],
    };
    expect((await pushRaw(body, { cookie: cookies.viewer })).statusCode).toBe(
      403,
    );
    expect((await pushRaw(body, { cookie: cookies.outsider })).statusCode).toBe(
      404,
    );
    expect((await pushRaw(body, { cookie: "" })).statusCode).toBe(401);
    expect((await pushRaw(body, { origin: null })).statusCode).toBe(403);
    expect(
      (await pushRaw(body, { origin: "https://evil.example" })).statusCode,
    ).toBe(403);
    expect((await fullPull()).transactions).toHaveLength(0);
  });

  it("rejects a malformed request as a whole", async () => {
    const one = mutation("transaction.create", { body: entryBody() });
    const many = Array.from({ length: 51 }, () =>
      mutation("transaction.create", { body: entryBody() }),
    );
    for (const payload of [
      {},
      { mutations: [] },
      { mutations: many },
      { mutations: [one, one] },
      { mutations: [{ ...one, type: "account.create" }] },
      { mutations: [{ ...one, id: "not-an-id" }] },
      { mutations: [{ ...one, extra: 1 }] },
      { mutations: [{ ...one, editedAt: "yesterday" }] },
      { mutations: [one], extra: true },
    ])
      expect(
        (await pushRaw(payload)).statusCode,
        JSON.stringify(payload).slice(0, 80),
      ).toBe(400);
  });

  it("works with the Android app's bearer token", async () => {
    const signedIn = await app.inject({
      method: "POST",
      url: "/api/v1/auth/sign-in/email",
      headers: {
        origin: config.APP_URL,
        "x-ledgerline-client": "android",
        "x-forwarded-for": "203.0.113.42",
      },
      payload: { email: people.owner.email, password: config.OWNER_PASSWORD },
    });
    const token = signedIn.headers["set-auth-token"] as string;
    const response = await app.inject({
      method: "POST",
      url: `${base()}/sync`,
      headers: {
        authorization: `Bearer ${token}`,
        origin: config.APP_URL,
        "content-type": "application/json",
      },
      payload: JSON.stringify({
        mutations: [mutation("transaction.create", { body: entryBody() })],
      }),
    });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json().results[0].status).toBe("applied");
  });
});

describe("an offline phone and the web editing the same rows", () => {
  it("converges: versions count the applied changes and the last applied writer's text stays", async () => {
    // A small seeded generator keeps the run the same every time.
    let seedValue = 20261021;
    const random = () => {
      seedValue = (seedValue * 1664525 + 1013904223) % 4294967296;
      return seedValue / 4294967296;
    };
    const entryIds: string[] = [];
    for (let i = 0; i < 4; i++)
      entryIds.push(await createEntry({ amount: money(-100 - i) }));
    // What the phone holds: its own copy of each entry's version and last update.
    const phone = new Map<string, Row>();
    const learn = (rows: Row[]) => {
      for (const row of rows) {
        const mine = phone.get(row.id);
        if (!mine || row.version > mine.version) phone.set(row.id, row);
      }
    };
    learn((await fullPull()).transactions as unknown as Row[]);
    const applied = new Map(
      entryIds.map((id) => [id, { count: 0, note: null as string | null }]),
    );
    for (let round = 0; round < 40; round++) {
      const id = entryIds[Math.floor(random() * entryIds.length)] as string;
      const server = await entryRow(id);
      if (random() < 0.45) {
        await send("PATCH", `/transactions/${id}`, {
          note: `web ${round}`,
          expectedVersion: server.version,
        });
        const entry = applied.get(id) as { count: number; note: string | null };
        entry.count += 1;
        entry.note = `web ${round}`;
        continue;
      }
      // An offline edit made against whatever version the phone last saw, at a time near the server's.
      const held = phone.get(id) as Row;
      const editedAt = new Date(
        Date.parse(server.updatedAt) + Math.floor((random() - 0.5) * 120_000),
      ).toISOString();
      const [result] = await push([
        mutation("transaction.update", {
          targetId: id,
          baseVersion: held.version,
          editedAt,
          body: { note: `phone ${round}` },
        }),
      ]);
      expect(["applied", "superseded"]).toContain(result?.status);
      learn(result?.rows as unknown as Row[]);
      if (result?.status === "applied") {
        const entry = applied.get(id) as { count: number; note: string | null };
        entry.count += 1;
        entry.note = `phone ${round}`;
        expect(result.rows[0]).toMatchObject({ note: `phone ${round}` });
      } else
        expect(
          (result?.rows[0] as unknown as Row | undefined)?.version ?? 0,
        ).toBeGreaterThanOrEqual(held.version);
    }
    const final = (await fullPull()).transactions as unknown as Row[];
    for (const row of final) {
      const entry = applied.get(row.id) as {
        count: number;
        note: string | null;
      };
      expect(row.version, row.id).toBe(1 + entry.count);
      expect(row.note, row.id).toBe(entry.note);
    }
    // After one more pull the phone holds exactly what the server holds.
    learn(final);
    for (const row of final)
      expect(phone.get(row.id)?.version).toBe(row.version);
  });
});
