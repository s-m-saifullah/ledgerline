import { changeMarkerSchema, newId } from "@ledgerline/shared";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../../app";
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
  tags,
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

// ADR 0044: the change marker an open web page polls, moving on any change to the ledger and on nothing else.
const url = requireTestDatabase("Change marker tests");
const config = testConfig(url, "changes");
const { db, pool } = createDatabase(url);
const app = await buildApp(db, config);
const ledgerId = newId();
const otherLedger = newId();
const ids = [ledgerId, otherLedger];
const people = {
  owner: { id: newId(), email: "changes-person-owner@example.com" },
  viewer: { id: newId(), email: "changes-person-viewer@example.com" },
  outsider: { id: newId(), email: "changes-person-outsider@example.com" },
};
let cookies = { owner: "", viewer: "", outsider: "" };
let checking = "";
let food = "";
let otherAccount = "";
let otherFood = "";

async function marker(ledger = ledgerId, cookie = cookies.owner) {
  const response = await app.inject({
    url: `/api/v1/ledgers/${ledger}/changes`,
    headers: { cookie },
  });
  expect(response.statusCode, response.body).toBe(200);
  expect(response.headers["cache-control"]).toBe("no-store");
  return changeMarkerSchema.parse(response.json()).marker;
}

async function send(
  method: "POST" | "PATCH" | "PUT" | "DELETE",
  path: string,
  body: unknown,
  ledger = ledgerId,
  cookie = cookies.owner,
) {
  const response = await app.inject({
    url: `/api/v1/ledgers/${ledger}${path}`,
    method,
    headers: {
      cookie,
      origin: config.APP_URL,
      "idempotency-key": newId(),
      "content-type": "application/json",
    },
    payload: JSON.stringify(body),
  });
  expect(response.statusCode, response.body).toBeLessThan(300);
  return response.body ? response.json() : undefined;
}

const entry = (account: string, category: string) => ({
  accountId: account,
  categoryId: category,
  kind: "expense",
  date: "2026-10-05",
  amount: { amount: -1000, currency: "USD" },
});

beforeAll(async () => {
  await applyMigrations(url);
  await db
    .insert(ledgers)
    .values(ids.map((id) => ({ id, name: "Synthetic changes suite" })));
  await seedUser(db, config, { ...people.owner, ledgerId, role: "owner" });
  await seedUser(db, config, { ...people.viewer, ledgerId, role: "viewer" });
  await seedUser(db, config, {
    ...people.outsider,
    ledgerId: otherLedger,
    role: "owner",
  });
  const seed = async (ledger: string) => {
    const account = newId();
    const category = newId();
    await db.insert(accounts).values({
      id: account,
      ledgerId: ledger,
      name: `Checking ${ledger}`,
      type: "bank",
      currency: "USD",
      openingBalance: 0,
    });
    await db.insert(categories).values({
      id: category,
      ledgerId: ledger,
      name: "Food",
      kind: "expense",
    });
    return { account, category };
  };
  ({ account: checking, category: food } = await seed(ledgerId));
  ({ account: otherAccount, category: otherFood } = await seed(otherLedger));
  await app.ready();
  cookies = {
    owner: await signInCookie(app, config, people.owner.email),
    viewer: await signInCookie(app, config, people.viewer.email),
    outsider: await signInCookie(app, config, people.outsider.email),
  };
});

afterAll(async () => {
  await db
    .delete(transactionTags)
    .where(inArray(transactionTags.ledgerId, ids));
  await db.delete(transactions).where(inArray(transactions.ledgerId, ids));
  await db.delete(tags).where(inArray(tags.ledgerId, ids));
  await db.delete(budgets).where(inArray(budgets.ledgerId, ids));
  await db.delete(categories).where(inArray(categories.ledgerId, ids));
  await db.delete(accounts).where(inArray(accounts.ledgerId, ids));
  await db.delete(writeReceipts).where(inArray(writeReceipts.ledgerId, ids));
  const userIds = Object.values(people).map((person) => person.id);
  await db.delete(ledgerMembers).where(inArray(ledgerMembers.ledgerId, ids));
  await db.delete(ledgers).where(inArray(ledgers.id, ids));
  await db.delete(session).where(inArray(session.userId, userIds));
  await db.delete(credentials).where(inArray(credentials.userId, userIds));
  await db.delete(user).where(inArray(user.id, userIds));
  await app.close();
  await pool.end();
});

describe("change marker", () => {
  it("stays the same while nothing changes, and is the same for every member", async () => {
    const first = await marker();
    expect(await marker()).toBe(first);
    expect(await marker(ledgerId, cookies.viewer)).toBe(first);
  });

  it("moves when an entry is created, edited, tagged and deleted", async () => {
    let last = await marker();
    const moved = async () => {
      const now = await marker();
      expect(now).not.toBe(last);
      last = now;
    };
    const made = await send("POST", "/transactions", entry(checking, food));
    await moved();
    await send("PATCH", `/transactions/${made.id}`, {
      expectedVersion: made.version,
      payee: "Grocer",
    });
    await moved();
    const tag = await send("POST", "/tags", { name: "Trip" });
    await moved();
    const tagged = await send("PATCH", `/transactions/${made.id}`, {
      expectedVersion: made.version + 1,
      tagIds: [tag.id],
    });
    await moved();
    await send("DELETE", `/transactions/${made.id}`, {
      expectedVersion: tagged.version,
    });
    await moved();
  });

  it("moves for tables the phone does not mirror, such as budgets", async () => {
    const before = await marker();
    await send("PUT", "/budgets", {
      categoryId: food,
      month: "2026-10",
      amount: { amount: 50_000, currency: "USD" },
      rollover: false,
    });
    expect(await marker()).not.toBe(before);
  });

  it("moves when a row is removed for good, not only soft-deleted", async () => {
    const tag = await send("POST", "/tags", { name: "Gone soon" });
    const before = await marker();
    await db.delete(tags).where(eq(tags.id, tag.id));
    expect(await marker()).not.toBe(before);
  });

  it("does not move for changes in another ledger", async () => {
    const before = await marker();
    const outsider = await marker(otherLedger, cookies.outsider);
    await send(
      "POST",
      "/transactions",
      entry(otherAccount, otherFood),
      otherLedger,
      cookies.outsider,
    );
    expect(await marker()).toBe(before);
    expect(await marker(otherLedger, cookies.outsider)).not.toBe(outsider);
  });

  it("is only for members: another ledger is 404 and no session is 401", async () => {
    const other = await app.inject({
      url: `/api/v1/ledgers/${otherLedger}/changes`,
      headers: { cookie: cookies.owner },
    });
    expect(other.statusCode).toBe(404);
    const anonymous = await app.inject({
      url: `/api/v1/ledgers/${ledgerId}/changes`,
    });
    expect(anonymous.statusCode).toBe(401);
  });
});
