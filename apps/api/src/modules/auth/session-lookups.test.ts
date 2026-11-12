import { newId } from "@ledgerline/shared";
import { eq } from "drizzle-orm";
import type { InjectOptions } from "fastify";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { buildApp } from "../../app";
import { createDatabase } from "../../db/client";
import { applyMigrations } from "../../db/migrate";
import {
  categories,
  account as credentials,
  ledgerMembers,
  ledgers,
  session,
  user,
  writeReceipts,
} from "../../db/schema";
import {
  requireTestDatabase,
  seedUser,
  signInCookie,
  testConfig,
} from "../../test-support/harness";

// Every request used to read the session table twice (the account guard, then the route's own check). A request now
// reads it once, however many parts of it need to know who is asking.
const url = requireTestDatabase("Session lookup tests");
const config = testConfig(url, "sel");
const { db, pool } = createDatabase(url);
const app = await buildApp(db, config);
const ledgerId = newId();
const userId = newId();
const email = "sel-person@example.com";
let cookie = "";

beforeAll(async () => {
  await applyMigrations(url);
  await db
    .insert(ledgers)
    .values({ id: ledgerId, name: "Synthetic session lookups" });
  await seedUser(db, config, { id: userId, email, ledgerId, role: "owner" });
  cookie = await signInCookie(app, config, email);
});

afterAll(async () => {
  await db.delete(writeReceipts).where(eq(writeReceipts.ledgerId, ledgerId));
  await db.delete(categories).where(eq(categories.ledgerId, ledgerId));
  await db.delete(ledgerMembers).where(eq(ledgerMembers.ledgerId, ledgerId));
  await db.delete(ledgers).where(eq(ledgers.id, ledgerId));
  await db.delete(session).where(eq(session.userId, userId));
  await db.delete(credentials).where(eq(credentials.userId, userId));
  await db.delete(user).where(eq(user.id, userId));
  await app.close();
  await pool.end();
});

/** Runs one request and counts the session lookups (by token) it made. */
async function withLookups(request: InjectOptions) {
  const spy = vi.spyOn(pool, "query");
  try {
    const response = await app.inject(request);
    const reads = spy.mock.calls.filter(([query]) => {
      const text =
        typeof query === "string" ? query : (query as { text: string }).text;
      // The lookup by token, not the device list the sessions route reads for itself.
      return /^\s*select\b[\s\S]*\bfrom "auth_sessions"[\s\S]*"token"\s*=/i.test(
        text,
      );
    }).length;
    return { response, reads };
  } finally {
    spy.mockRestore();
  }
}

const get = (path: string) => ({
  method: "GET" as const,
  url: path,
  headers: { origin: config.APP_URL, cookie },
});

describe("one session lookup per request", () => {
  it.each([
    ["a ledger's list", `/api/v1/ledgers/${ledgerId}/accounts`],
    ["the ledger list", "/api/v1/ledgers"],
    ["one ledger", `/api/v1/ledgers/${ledgerId}`],
    ["Home", `/api/v1/ledgers/${ledgerId}/home?month=2026-11`],
    ["who I am", "/api/v1/me"],
    ["my signed-in devices", "/api/v1/sessions"],
    ["an export", `/api/v1/ledgers/${ledgerId}/exports/transactions.csv`],
  ])("%s", async (_name, path) => {
    const { response, reads } = await withLookups(get(path));

    expect(response.statusCode, response.body).toBe(200);
    expect(reads).toBe(1);
  });

  it("a write", async () => {
    const { response, reads } = await withLookups({
      method: "POST",
      url: `/api/v1/ledgers/${ledgerId}/categories`,
      headers: {
        origin: config.APP_URL,
        cookie,
        "idempotency-key": newId(),
      },
      payload: { name: "Synthetic lookups", kind: "expense" },
    });

    expect(response.statusCode, response.body).toBe(201);
    expect(reads).toBe(1);
  });

  it("a request without a session is still refused", async () => {
    const { response } = await withLookups({
      method: "GET",
      url: `/api/v1/ledgers/${ledgerId}/accounts`,
      headers: { origin: config.APP_URL },
    });

    expect(response.statusCode).toBe(401);
  });
});
