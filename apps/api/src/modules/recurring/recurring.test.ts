import {
  newId,
  type RecurringRule,
  recurringRuleSchema,
  recurringRunListSchema,
} from "@ledgerline/shared";
import { and, eq, inArray, isNull } from "drizzle-orm";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { buildApp } from "../../app";
import { readConfig } from "../../config";
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
  recurringRules,
  recurringRuns,
  session,
  transactions,
  user,
  writeReceipts,
} from "../../db/schema";
import { MAX_PER_RULE, runRecurringRules } from "../../jobs/recurring";
import { hashPassword } from "../auth/password";

const url = process.env.TEST_DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith("/ledgerline_test"))
  throw new Error(
    "Recurring tests require the dedicated ledgerline_test database.",
  );
const config = readConfig({
  NODE_ENV: "test",
  DATABASE_URL: url,
  APP_URL: "http://localhost:5173",
  BETTER_AUTH_SECRET: "recurring-test-secret-only-0000000000000000",
  OWNER_EMAIL: "recurring-owner@example.com",
  OWNER_PASSWORD: "Recurring-test-password-000",
  OWNER_NAME: "Recurring owner",
});
const { db, pool } = createDatabase(url);
let current = new Date("2026-10-11T12:00:00Z");
const app = await buildApp(db, config, { now: () => current });
const log = { info: vi.fn(), error: vi.fn() };
const ledgerId = newId();
const foreignLedger = newId();
const fixtureLedgers = [ledgerId, foreignLedger];
const fixtureUsers = [newId(), newId(), newId()];
const cookies: string[] = [];
const ids = {
  checking: newId(),
  savings: newId(),
  wallet: newId(),
  rent: newId(),
  salary: newId(),
  bonus: newId(),
  foreignAccount: newId(),
  foreignCategory: newId(),
};
const root = (ledger = ledgerId) => `/api/v1/ledgers/${ledger}`;
const send = (
  method: "POST" | "PATCH" | "DELETE",
  path: string,
  payload: unknown,
  cookie = cookies[0] ?? "",
  ledger = ledgerId,
  key = newId(),
) =>
  app.inject({
    method,
    url: `${root(ledger)}${path}`,
    headers: {
      "content-type": "application/json",
      cookie,
      origin: config.APP_URL,
      "idempotency-key": key,
    },
    payload: JSON.stringify(payload),
  });
const get = (path: string, cookie = cookies[0] ?? "", ledger = ledgerId) =>
  app.inject({ url: `${root(ledger)}${path}`, headers: { cookie } });
const rent = (extra: object = {}) => ({
  title: "Rent",
  kind: "expense",
  accountId: ids.checking,
  toAccountId: null,
  categoryId: ids.rent,
  amount: { amount: -120000, currency: "USD" },
  receivedAmount: null,
  bonus: null,
  payee: "Landlord",
  note: null,
  frequency: "month",
  interval: 1,
  startDate: "2026-11-01",
  endDate: null,
  ...extra,
});
const transfer = (extra: object = {}) =>
  rent({
    title: "Savings",
    kind: "transfer",
    toAccountId: ids.savings,
    categoryId: null,
    payee: null,
    amount: { amount: 5000, currency: "USD" },
    ...extra,
  });
async function make(body: object = rent(), cookie = cookies[0] ?? "") {
  const response = await send("POST", "/recurring-rules", body, cookie);
  expect(response.statusCode).toBe(201);
  return recurringRuleSchema.parse(response.json());
}
const rule = async (id: string) =>
  recurringRuleSchema.parse((await get(`/recurring-rules/${id}`)).json());
const runsOf = async (id: string) =>
  recurringRunListSchema.parse(
    (await get(`/recurring-rules/${id}/runs`)).json(),
  ).items;
const run = () => runRecurringRules(db, current, log);
const liveEntries = (accountId = ids.checking) =>
  db
    .select()
    .from(transactions)
    .where(
      and(
        eq(transactions.ledgerId, ledgerId),
        eq(transactions.accountId, accountId),
        isNull(transactions.deletedAt),
      ),
    )
    .orderBy(transactions.date);
const at = (iso: string) => {
  current = new Date(iso);
};
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
  await db
    .delete(recurringRuns)
    .where(inArray(recurringRuns.ledgerId, fixtureLedgers));
  await db
    .delete(recurringRules)
    .where(inArray(recurringRules.ledgerId, fixtureLedgers));
  await db
    .delete(transactions)
    .where(inArray(transactions.ledgerId, fixtureLedgers));
  await db
    .delete(writeReceipts)
    .where(inArray(writeReceipts.ledgerId, fixtureLedgers));
}
beforeAll(async () => {
  await applyMigrations(url);
  await db.insert(ledgers).values([
    { id: ledgerId, name: "Recurring ledger", timeZone: "America/Chicago" },
    { id: foreignLedger, name: "Other ledger", timeZone: "UTC" },
  ]);
  const password = await hashPassword(config.OWNER_PASSWORD);
  for (const [index, role] of (
    ["owner", "editor", "viewer"] as const
  ).entries()) {
    const id = fixtureUsers[index] ?? "";
    await db
      .insert(user)
      .values({ id, name: role, email: `recurring-${role}-${id}@example.com` });
    await db.insert(credentials).values({
      userId: id,
      accountId: id,
      providerId: "credential",
      password,
    });
    await db.insert(ledgerMembers).values({ userId: id, ledgerId, role });
  }
  await db.insert(accounts).values([
    {
      id: ids.checking,
      ledgerId,
      name: "Checking",
      type: "bank",
      openingBalance: 1000000,
    },
    {
      id: ids.savings,
      ledgerId,
      name: "Savings",
      type: "bank",
      openingBalance: 0,
    },
    {
      id: ids.wallet,
      ledgerId,
      name: "Wallet",
      type: "wallet",
      openingBalance: 0,
      currency: "BDT",
    },
    {
      id: ids.foreignAccount,
      ledgerId: foreignLedger,
      name: "Foreign",
      type: "bank",
      openingBalance: 0,
    },
  ]);
  await db.insert(categories).values([
    { id: ids.rent, ledgerId, name: "Rent", kind: "expense" },
    { id: ids.salary, ledgerId, name: "Salary", kind: "income" },
    { id: ids.bonus, ledgerId, name: "Bonus", kind: "income" },
    {
      id: ids.foreignCategory,
      ledgerId: foreignLedger,
      name: "Foreign",
      kind: "expense",
    },
  ]);
  await db.insert(currencies).values({ ledgerId, code: "BDT" });
  await db.insert(exchangeRates).values({
    ledgerId,
    code: "BDT",
    date: "2026-10-01",
    rate: "0.0083",
    source: "manual",
  });
  await app.ready();
  for (const [index, role] of ["owner", "editor", "viewer"].entries())
    cookies.push(
      await signIn(`recurring-${role}-${fixtureUsers[index]}@example.com`),
    );
});
beforeEach(async () => {
  await clearRows();
  log.info.mockClear();
  log.error.mockClear();
  at("2026-10-11T12:00:00Z");
  await db
    .update(ledgers)
    .set({ timeZone: "America/Chicago" })
    .where(eq(ledgers.id, ledgerId));
  await db
    .update(accounts)
    .set({ archivedAt: null })
    .where(eq(accounts.ledgerId, ledgerId));
  await db
    .update(ledgerMembers)
    .set({ role: "owner" })
    .where(
      and(
        eq(ledgerMembers.ledgerId, ledgerId),
        eq(ledgerMembers.userId, fixtureUsers[0] ?? ""),
      ),
    );
});
afterAll(async () => {
  await app.close();
  await clearRows();
  await db
    .delete(exchangeRates)
    .where(inArray(exchangeRates.ledgerId, fixtureLedgers));
  await db
    .delete(currencies)
    .where(inArray(currencies.ledgerId, fixtureLedgers));
  await db
    .delete(categories)
    .where(inArray(categories.ledgerId, fixtureLedgers));
  await db.delete(accounts).where(inArray(accounts.ledgerId, fixtureLedgers));
  await db.delete(session).where(inArray(session.userId, fixtureUsers));
  await db.delete(credentials).where(inArray(credentials.userId, fixtureUsers));
  await db
    .delete(ledgerMembers)
    .where(inArray(ledgerMembers.ledgerId, fixtureLedgers));
  await db.delete(ledgers).where(inArray(ledgers.id, fixtureLedgers));
  await db.delete(user).where(inArray(user.id, fixtureUsers));
  await pool.end();
});

describe("creating rules", () => {
  it("needs the ledger time zone", async () => {
    await db
      .update(ledgers)
      .set({ timeZone: null })
      .where(eq(ledgers.id, ledgerId));
    const response = await send("POST", "/recurring-rules", rent());
    expect(response.statusCode).toBe(409);
    expect(response.json().errors[0].field).toBe("timeZone");
  });

  it("saves a future rule and creates nothing yet", async () => {
    const saved = await make();
    expect(saved).toMatchObject({
      nextDate: "2026-11-01",
      paused: false,
      needsAttention: 0,
      version: 1,
    });
    expect(await liveEntries()).toHaveLength(0);
    expect((await get("/recurring-rules")).json().items).toHaveLength(1);
  });

  it("catches up a start in the past, one entry per occurrence, on its own date", async () => {
    const saved = await make(rent({ startDate: "2026-08-31" }));
    const entries = await liveEntries();
    expect(entries.map((row) => row.date)).toEqual([
      "2026-08-31",
      "2026-09-30",
    ]);
    expect(entries[0]).toMatchObject({
      status: "cleared",
      kind: "expense",
      amount: -120000,
      currency: "USD",
      payee: "Landlord",
      categoryId: ids.rent,
    });
    expect((await rule(saved.id)).nextDate).toBe("2026-10-31");
    expect((await runsOf(saved.id)).map((item) => item.status)).toEqual([
      "created",
      "created",
    ]);
  });

  it("replays the same key without a second rule", async () => {
    const key = newId();
    const first = await send(
      "POST",
      "/recurring-rules",
      rent(),
      cookies[0],
      ledgerId,
      key,
    );
    const again = await send(
      "POST",
      "/recurring-rules",
      rent(),
      cookies[0],
      ledgerId,
      key,
    );
    expect(again.headers["idempotency-replayed"]).toBe("true");
    expect(again.json()).toEqual(first.json());
    expect((await get("/recurring-rules")).json().items).toHaveLength(1);
  });

  it("checks currencies, transfers and categories against the accounts", async () => {
    const bad = async (body: object, field: string) => {
      const response = await send("POST", "/recurring-rules", body);
      expect(response.statusCode).toBe(409);
      expect(JSON.stringify(response.json().errors)).toContain(field);
    };
    await bad(rent({ amount: { amount: -100, currency: "EUR" } }), "amount");
    await bad(transfer({ toAccountId: ids.wallet }), "receivedAmount");
    await bad(
      transfer({ receivedAmount: { amount: 100, currency: "USD" } }),
      "receivedAmount",
    );
    await bad(
      transfer({
        toAccountId: ids.wallet,
        receivedAmount: { amount: 1200, currency: "BDT" },
        bonus: {
          amount: { amount: 30, currency: "USD" },
          categoryId: ids.bonus,
        },
      }),
      "bonus",
    );
    await bad(rent({ categoryId: ids.salary }), "categoryId");
    await db
      .update(accounts)
      .set({ archivedAt: new Date() })
      .where(eq(accounts.id, ids.savings));
    await bad(transfer(), "toAccountId");
  });
});

describe("running", () => {
  it("creates nothing twice and carries on when time moves", async () => {
    const saved = await make(rent({ startDate: "2026-08-31" }));
    expect(await run()).toMatchObject({ created: 0 });
    expect(await liveEntries()).toHaveLength(2);
    at("2026-11-01T12:00:00Z");
    expect(await run()).toMatchObject({ created: 1 });
    expect((await liveEntries()).map((row) => row.date)).toEqual([
      "2026-08-31",
      "2026-09-30",
      "2026-10-31",
    ]);
    expect((await rule(saved.id)).nextDate).toBe("2026-11-30");
    expect(await run()).toMatchObject({ created: 0 });
  });

  it("uses the ledger's own date, not UTC", async () => {
    await make(rent({ startDate: "2026-10-11" }));
    // 2026-10-11T03:00Z is still the 10th in Chicago.
    await db.delete(transactions).where(eq(transactions.ledgerId, ledgerId));
    await clearRows();
    at("2026-10-11T03:00:00Z");
    await make(rent({ startDate: "2026-10-11" }));
    expect(await liveEntries()).toHaveLength(0);
    at("2026-10-11T06:00:00Z");
    await run();
    expect(await liveEntries()).toHaveLength(1);
  });

  it("never recreates an entry the person deleted", async () => {
    const saved = await make(rent({ startDate: "2026-09-30" }));
    const [entry] = await liveEntries();
    await db
      .update(transactions)
      .set({ deletedAt: new Date() })
      .where(eq(transactions.id, entry?.id ?? ""));
    // Even if the rule's date is rewound, the saved key replays instead of creating again.
    await db
      .update(recurringRules)
      .set({ nextDate: "2026-09-30" })
      .where(eq(recurringRules.id, saved.id));
    await run();
    expect(await liveEntries()).toHaveLength(0);
  });

  it("stops at the cap and carries on at the next run", async () => {
    const saved = await make(
      rent({
        frequency: "day",
        startDate: "2026-01-01",
        amount: { amount: -100, currency: "USD" },
      }),
    );
    expect(await liveEntries()).toHaveLength(MAX_PER_RULE);
    await run();
    expect((await liveEntries()).length).toBeGreaterThan(MAX_PER_RULE);
    for (let i = 0; i < 3; i++) await run();
    // 2026-01-01 through 2026-10-11 is 284 days.
    expect(await liveEntries()).toHaveLength(284);
    expect((await rule(saved.id)).nextDate).toBe("2026-10-12");
  });

  it("ends at the end date", async () => {
    const saved = await make(
      rent({ startDate: "2026-08-31", endDate: "2026-09-30" }),
    );
    expect(await liveEntries()).toHaveLength(2);
    expect((await rule(saved.id)).nextDate).toBeNull();
    at("2027-01-01T12:00:00Z");
    expect(await run()).toMatchObject({ created: 0 });
  });

  it("makes transfers, in one currency and across currencies with an explicit bonus", async () => {
    await make(transfer({ startDate: "2026-10-01" }));
    const legs = await db
      .select()
      .from(transactions)
      .where(
        and(
          eq(transactions.ledgerId, ledgerId),
          inArray(transactions.accountId, [ids.checking, ids.savings]),
        ),
      );
    expect(legs).toHaveLength(2);
    expect(legs.map((row) => row.amount).sort((a, b) => a - b)).toEqual([
      -5000, 5000,
    ]);
    expect(new Set(legs.map((row) => row.transferId)).size).toBe(1);

    await make(
      transfer({
        title: "Remittance",
        toAccountId: ids.wallet,
        startDate: "2026-10-02",
        receivedAmount: { amount: 1200000, currency: "BDT" },
        bonus: {
          amount: { amount: 30000, currency: "BDT" },
          categoryId: ids.bonus,
        },
      }),
    );
    const wallet = await liveEntries(ids.wallet);
    expect(
      wallet.map((row) => [row.kind, row.amount, row.currency]).sort(),
    ).toEqual([
      ["income", 30000, "BDT"],
      ["transfer", 1200000, "BDT"],
    ]);
  });
});

describe("needs attention", () => {
  it("records a fixed reason, retries, and can be skipped", async () => {
    const saved = await make(transfer({ startDate: "2026-11-01" }));
    await db
      .update(accounts)
      .set({ archivedAt: new Date() })
      .where(eq(accounts.id, ids.savings));
    at("2026-11-01T12:00:00Z");
    expect(await run()).toMatchObject({ attention: 1, created: 0 });
    const [item] = await runsOf(saved.id);
    expect(item).toMatchObject({
      status: "attention",
      reason: "Choose an active account.",
    });
    expect((await rule(saved.id)).needsAttention).toBe(1);
    // Still failing on the next run, still one row.
    await run();
    expect(await runsOf(saved.id)).toHaveLength(1);
    // Fixing the cause lets the retry create it.
    await db
      .update(accounts)
      .set({ archivedAt: null })
      .where(eq(accounts.id, ids.savings));
    expect(await run()).toMatchObject({ created: 1 });
    expect((await runsOf(saved.id))[0]).toMatchObject({
      status: "created",
      reason: null,
    });
    expect((await rule(saved.id)).needsAttention).toBe(0);
  });

  it("does not try a skipped occurrence again", async () => {
    const saved = await make(transfer({ startDate: "2026-11-01" }));
    await db
      .update(accounts)
      .set({ archivedAt: new Date() })
      .where(eq(accounts.id, ids.savings));
    at("2026-11-01T12:00:00Z");
    await run();
    const [item] = await runsOf(saved.id);
    const skipped = await send("POST", `/recurring-runs/${item?.id}/skip`, {
      expectedVersion: item?.version ?? 0,
    });
    expect(skipped.statusCode).toBe(200);
    expect(skipped.json()).toMatchObject({ status: "skipped", reason: null });
    await db
      .update(accounts)
      .set({ archivedAt: null })
      .where(eq(accounts.id, ids.savings));
    await run();
    expect(await liveEntries(ids.savings)).toHaveLength(0);
    // Only an occurrence needing attention can be skipped.
    expect(
      (
        await send("POST", `/recurring-runs/${item?.id}/skip`, {
          expectedVersion: 2,
        })
      ).statusCode,
    ).toBe(409);
  });
});

describe("pause, resume, edit and delete", () => {
  it("skips what came due while paused", async () => {
    const saved = await make(
      rent({ startDate: "2026-10-01", frequency: "week" }),
    );
    const paused = await send("POST", `/recurring-rules/${saved.id}/pause`, {
      expectedVersion: saved.version,
    });
    expect(paused.json()).toMatchObject({
      paused: true,
      pausedReason: "manual",
    });
    const entriesBefore = (await liveEntries()).length;
    at("2026-10-25T12:00:00Z");
    expect(await run()).toMatchObject({ rules: 0 });
    expect(await liveEntries()).toHaveLength(entriesBefore);
    const resumed = await send("POST", `/recurring-rules/${saved.id}/resume`, {
      expectedVersion: 2,
    });
    expect(resumed.statusCode).toBe(200);
    // 2026-10-01 is a Thursday; today (the 25th, a Sunday) leaves Thursday the 29th next.
    expect((await rule(saved.id)).nextDate).toBe("2026-10-29");
    expect(await liveEntries()).toHaveLength(entriesBefore);
  });

  it("edits the template without touching entries already made", async () => {
    const saved = await make(rent({ startDate: "2026-10-01" }));
    const edited = await send("PATCH", `/recurring-rules/${saved.id}`, {
      ...rent({
        startDate: "2026-10-01",
        amount: { amount: -130000, currency: "USD" },
        title: "Rent v2",
      }),
      expectedVersion: saved.version,
    });
    expect(edited.statusCode).toBe(200);
    expect(edited.json()).toMatchObject({
      title: "Rent v2",
      version: 2,
      nextDate: "2026-11-01",
    });
    expect((await liveEntries())[0]?.amount).toBe(-120000);
    at("2026-11-01T12:00:00Z");
    await run();
    expect((await liveEntries()).map((row) => row.amount)).toEqual([
      -120000, -130000,
    ]);
  });

  it("restarts a schedule change from today once something was created", async () => {
    const saved = await make(rent({ startDate: "2026-10-01" }));
    const edited = await send("PATCH", `/recurring-rules/${saved.id}`, {
      ...rent({ startDate: "2026-10-01", frequency: "week" }),
      expectedVersion: saved.version,
    });
    // Weekly from 2026-10-01 (Thursday): the next after today (Sunday the 11th) is the 15th.
    expect(edited.json().nextDate).toBe("2026-10-15");
    expect(await liveEntries()).toHaveLength(1);
  });

  it("refuses a stale version", async () => {
    const saved = await make();
    expect(
      (
        await send("PATCH", `/recurring-rules/${saved.id}`, {
          ...rent(),
          expectedVersion: 7,
        })
      ).statusCode,
    ).toBe(409);
    expect(
      (
        await send("DELETE", `/recurring-rules/${saved.id}`, {
          expectedVersion: 7,
        })
      ).statusCode,
    ).toBe(409);
  });

  it("deletes the rule and keeps its entries", async () => {
    const saved = await make(rent({ startDate: "2026-10-01" }));
    expect(
      (
        await send("DELETE", `/recurring-rules/${saved.id}`, {
          expectedVersion: 1,
        })
      ).statusCode,
    ).toBe(204);
    expect((await get(`/recurring-rules/${saved.id}`)).statusCode).toBe(404);
    expect(await liveEntries()).toHaveLength(1);
    at("2027-01-01T12:00:00Z");
    expect(await run()).toMatchObject({ rules: 0 });
  });

  it("pauses a rule whose creator lost write access", async () => {
    const saved = await make(rent({ startDate: "2026-11-01" }), cookies[1]);
    await db
      .update(ledgerMembers)
      .set({ role: "viewer" })
      .where(
        and(
          eq(ledgerMembers.ledgerId, ledgerId),
          eq(ledgerMembers.userId, fixtureUsers[1] ?? ""),
        ),
      );
    at("2026-11-01T12:00:00Z");
    try {
      expect(await run()).toMatchObject({ paused: 1, created: 0 });
      expect(await rule(saved.id)).toMatchObject({
        paused: true,
        pausedReason: "access",
      });
      expect(await liveEntries()).toHaveLength(0);
    } finally {
      await db
        .update(ledgerMembers)
        .set({ role: "editor" })
        .where(
          and(
            eq(ledgerMembers.ledgerId, ledgerId),
            eq(ledgerMembers.userId, fixtureUsers[1] ?? ""),
          ),
        );
    }
  });

  it("blocks deleting an account or category a rule uses", async () => {
    await make(rent());
    const account = await send("DELETE", `/accounts/${ids.checking}`, {
      expectedVersion: 1,
    });
    expect(account.statusCode).toBe(409);
    const category = await send("DELETE", `/categories/${ids.rent}`, {
      expectedVersion: 1,
    });
    expect(category.statusCode).toBe(409);
  });
});

describe("access", () => {
  it("lets viewers read but not write", async () => {
    const saved = await make();
    const viewer = cookies[2] ?? "";
    expect((await get("/recurring-rules", viewer)).statusCode).toBe(200);
    expect(
      (await get(`/recurring-rules/${saved.id}/runs`, viewer)).statusCode,
    ).toBe(200);
    for (const [method, path, body] of [
      ["POST", "/recurring-rules", rent()],
      [
        "PATCH",
        `/recurring-rules/${saved.id}`,
        { ...rent(), expectedVersion: 1 },
      ],
      ["DELETE", `/recurring-rules/${saved.id}`, { expectedVersion: 1 }],
      ["POST", `/recurring-rules/${saved.id}/pause`, { expectedVersion: 1 }],
    ] as const)
      expect((await send(method, path, body, viewer)).statusCode).toBe(403);
  });

  it("cannot read or write another ledger's rules, accounts or categories", async () => {
    const saved = await make();
    const other = await send(
      "POST",
      "/recurring-rules",
      rent(),
      cookies[0],
      foreignLedger,
    );
    expect(other.statusCode).toBe(404);
    expect(
      (await get("/recurring-rules", cookies[0], foreignLedger)).statusCode,
    ).toBe(404);
    expect(
      (await get(`/recurring-rules/${saved.id}`, cookies[0], foreignLedger))
        .statusCode,
    ).toBe(404);
    expect(
      (
        await get(
          `/recurring-rules/${saved.id}/runs`,
          cookies[0],
          foreignLedger,
        )
      ).statusCode,
    ).toBe(404);
    for (const [method, path, body] of [
      [
        "PATCH",
        `/recurring-rules/${saved.id}`,
        { ...rent(), expectedVersion: 1 },
      ],
      ["DELETE", `/recurring-rules/${saved.id}`, { expectedVersion: 1 }],
      ["POST", `/recurring-rules/${saved.id}/pause`, { expectedVersion: 1 }],
      ["POST", `/recurring-rules/${saved.id}/resume`, { expectedVersion: 1 }],
      ["POST", `/recurring-runs/${newId()}/skip`, { expectedVersion: 1 }],
    ] as const)
      expect(
        (await send(method, path, body, cookies[0], foreignLedger)).statusCode,
      ).toBe(404);
    // Another ledger's account or category in the body is not found in this ledger.
    expect(
      (
        await send(
          "POST",
          "/recurring-rules",
          rent({ accountId: ids.foreignAccount }),
        )
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await send(
          "POST",
          "/recurring-rules",
          rent({ categoryId: ids.foreignCategory }),
        )
      ).statusCode,
    ).toBe(404);
    // A rule is untouched by the failed attempts.
    const unchanged: RecurringRule = await rule(saved.id);
    expect(unchanged.version).toBe(1);
  });

  it("needs a signed-in session", async () => {
    expect((await get("/recurring-rules", "")).statusCode).toBe(401);
  });
});

describe("logging", () => {
  it("reports counts only", async () => {
    await make(
      rent({
        startDate: "2026-09-30",
        title: "Secret rent",
        payee: "Secret payee",
      }),
    );
    at("2026-11-01T12:00:00Z");
    await run();
    const logged = JSON.stringify([
      ...log.info.mock.calls,
      ...log.error.mock.calls,
    ]);
    expect(logged).not.toContain("Secret");
    expect(logged).not.toContain("120000");
  });
});
