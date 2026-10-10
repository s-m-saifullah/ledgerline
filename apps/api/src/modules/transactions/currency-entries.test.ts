import {
  accountSchema,
  newId,
  type Transaction,
  type Transfer,
  transactionSchema,
  transferSchema,
} from "@ledgerline/shared";
import { and, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
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
  session,
  transactionSplits,
  transactions,
  user,
  writeReceipts,
} from "../../db/schema";
import { hashPassword } from "../auth/password";
import { getHomeSummary } from "../home/service";

const url = process.env.TEST_DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith("/ledgerline_test"))
  throw new Error(
    "Currency entry tests require the dedicated ledgerline_test database.",
  );
const config = readConfig({
  NODE_ENV: "test",
  DATABASE_URL: url,
  APP_URL: "http://localhost:5173",
  BETTER_AUTH_SECRET: "currency-entries-test-secret-only-00000000000",
  OWNER_EMAIL: "currency-entries-owner@example.com",
  OWNER_PASSWORD: "Currency-entries-test-password-000",
  OWNER_NAME: "Currency entries owner",
});
const { db, pool } = createDatabase(url);
const app = await buildApp(db, config);
const ledgerId = newId();
const foreignLedger = newId();
const fixtureLedgers = [ledgerId, foreignLedger];
const ownerId = newId();
const usd = newId();
const eur = newId();
const eur2 = newId();
const bdt = newId();
const jpy = newId();
const food = newId();
const rent = newId();
const salary = newId();
let cookie = "";
const root = (ledger = ledgerId) => `/api/v1/ledgers/${ledger}`;
const headers = (key = newId()) => ({
  "content-type": "application/json",
  cookie,
  origin: config.APP_URL,
  "idempotency-key": key,
});
const send = (
  method: "POST" | "PATCH" | "DELETE",
  path: string,
  payload: unknown,
  ledger = ledgerId,
) =>
  app.inject({
    method,
    url: `${root(ledger)}${path}`,
    headers: headers(),
    payload: JSON.stringify(payload),
  });
const money = (amount: number, currency = "USD") => ({ amount, currency });
const entry = (
  accountId: string,
  amount: number,
  currency: string,
  extra: Record<string, unknown> = {},
) => ({
  accountId,
  categoryId: food,
  kind: amount < 0 ? "expense" : "income",
  date: "2026-10-05",
  amount: money(amount, currency),
  ...extra,
});
async function createEntry(
  accountId: string,
  amount: number,
  currency: string,
  extra: Record<string, unknown> = {},
): Promise<Transaction> {
  const response = await send(
    "POST",
    "/transactions",
    entry(accountId, amount, currency, extra),
  );
  expect(response.statusCode, response.body).toBe(201);
  return transactionSchema.parse(response.json());
}
const transfer = (
  from: string,
  to: string,
  amount: number,
  fromCurrency: string,
  extra: Record<string, unknown> = {},
) =>
  send("POST", "/transfers", {
    fromAccountId: from,
    toAccountId: to,
    amount: money(amount, fromCurrency),
    date: "2026-10-05",
    ...extra,
  });
async function createTransfer(
  from: string,
  to: string,
  amount: number,
  fromCurrency: string,
  extra: Record<string, unknown> = {},
): Promise<Transfer> {
  const response = await transfer(from, to, amount, fromCurrency, extra);
  expect(response.statusCode, response.body).toBe(201);
  return transferSchema.parse(response.json());
}
const legs = (transferId: string) =>
  db
    .select()
    .from(transactions)
    .where(
      and(
        eq(transactions.ledgerId, ledgerId),
        eq(transactions.transferId, transferId),
      ),
    );
const rate = (code: string, date: string, value: string, ledger = ledgerId) =>
  db.insert(exchangeRates).values({
    ledgerId: ledger,
    code,
    date,
    rate: value,
    source: "manual",
  });
async function signIn() {
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/auth/sign-in/email",
    headers: { origin: config.APP_URL },
    payload: {
      email: `currency-entries-${ownerId}@example.com`,
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
      .where(inArray(transactionSplits.ledgerId, fixtureLedgers));
    await tx
      .delete(transactions)
      .where(inArray(transactions.ledgerId, fixtureLedgers));
  });
  await db
    .delete(exchangeRates)
    .where(inArray(exchangeRates.ledgerId, fixtureLedgers));
  await db
    .delete(currencies)
    .where(inArray(currencies.ledgerId, fixtureLedgers));
  await db
    .delete(accounts)
    .where(inArray(accounts.id, [])) // fixture accounts are kept; extras removed below
    .catch(() => undefined);
  await db
    .delete(writeReceipts)
    .where(inArray(writeReceipts.ledgerId, fixtureLedgers));
}
const fixtureAccounts = [usd, eur, eur2, bdt, jpy];
async function removeExtraAccounts() {
  const rows = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(eq(accounts.ledgerId, ledgerId));
  const extra = rows
    .map((row) => row.id)
    .filter((id) => !fixtureAccounts.includes(id));
  if (extra.length)
    await db.delete(accounts).where(inArray(accounts.id, extra));
}
beforeAll(async () => {
  await applyMigrations(url);
  await db
    .insert(ledgers)
    .values(
      fixtureLedgers.map((id) => ({ id, name: "Synthetic currency ledger" })),
    );
  await db.insert(user).values({
    id: ownerId,
    name: "owner",
    email: `currency-entries-${ownerId}@example.com`,
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
  const open = (
    id: string,
    name: string,
    currency: string,
    balance: number,
  ) => ({
    id,
    ledgerId,
    name,
    type: "bank" as const,
    currency,
    openingBalance: balance,
  });
  await db
    .insert(accounts)
    .values([
      open(usd, "Dollars", "USD", 1_000_000),
      open(eur, "Euros", "EUR", 1_000_000),
      open(eur2, "More euros", "EUR", 0),
      open(bdt, "Taka", "BDT", 100_000_000),
      open(jpy, "Yen", "JPY", 0),
    ]);
  await app.ready();
  cookie = await signIn();
});
beforeEach(async () => {
  await clearRows();
  await removeExtraAccounts();
  await rate("EUR", "2026-10-02", "1.1217");
  await rate("BDT", "2026-10-02", "0.0082");
  await rate("JPY", "2026-10-02", "0.0067");
});
afterAll(async () => {
  await app.close();
  await clearRows();
  await removeExtraAccounts();
  await db.delete(accounts).where(inArray(accounts.ledgerId, fixtureLedgers));
  await db
    .delete(categories)
    .where(inArray(categories.ledgerId, fixtureLedgers));
  await db.delete(session).where(inArray(session.userId, [ownerId]));
  await db.delete(credentials).where(inArray(credentials.userId, [ownerId]));
  await db
    .delete(ledgerMembers)
    .where(inArray(ledgerMembers.ledgerId, fixtureLedgers));
  await db.delete(ledgers).where(inArray(ledgers.id, fixtureLedgers));
  await db.delete(user).where(inArray(user.id, [ownerId]));
  await pool.end();
});

describe("accounts in other currencies", () => {
  it("needs the currency added first, then keeps it for the account's life", async () => {
    const body = {
      name: "Pounds",
      type: "bank",
      openingBalance: money(5000, "GBP"),
    };
    expect((await send("POST", "/accounts", body)).statusCode).toBe(409);
    await db.insert(currencies).values({ ledgerId, code: "GBP" });
    const created = await send("POST", "/accounts", body);
    expect(created.statusCode, created.body).toBe(201);
    const account = accountSchema.parse(created.json());
    expect(account.currency).toBe("GBP");
    expect(account.balance).toEqual(money(5000, "GBP"));
    const edited = await send("PATCH", `/accounts/${account.id}`, {
      expectedVersion: 1,
      openingBalance: money(100, "USD"),
    });
    expect(edited.statusCode).toBe(409);
  });
});

describe("pricing entries", () => {
  it("freezes the newest rate on or before the entry's date", async () => {
    const created = await createEntry(eur, -10000, "EUR");
    expect(created.amount).toEqual(money(-10000, "EUR"));
    expect(created.fxRate).toBe("1.1217");
    expect(created.baseAmount).toEqual(money(-11217, "USD"));
    await rate("EUR", "2026-10-04", "1.2");
    expect((await createEntry(eur, -10000, "EUR")).baseAmount.amount).toBe(
      -12000,
    );
    // An earlier date still uses the earlier rate.
    expect(
      (await createEntry(eur, -10000, "EUR", { date: "2026-10-03" })).fxRate,
    ).toBe("1.1217");
  });

  it("converts between currencies with different minor units", async () => {
    // 1000 yen (no minor unit) at 0.0067 USD each is 6.70 USD.
    expect((await createEntry(jpy, -1000, "JPY")).baseAmount.amount).toBe(-670);
    // 10,000.00 taka at 0.0082 USD each is 82.00 USD.
    expect((await createEntry(bdt, -1_000_000, "BDT")).baseAmount.amount).toBe(
      -8200,
    );
  });

  it("uses a rate set by hand, and says so when none exists", async () => {
    const manual = await createEntry(eur, -10000, "EUR", { fxRate: "1.3" });
    expect(manual.fxRate).toBe("1.3");
    expect(manual.baseAmount.amount).toBe(-13000);
    const missing = await send(
      "POST",
      "/transactions",
      entry(eur, -10000, "EUR", { date: "2026-09-01" }),
    );
    expect(missing.statusCode).toBe(409);
    expect(missing.json().errors[0].field).toBe("currency");
    expect(
      await db
        .select()
        .from(transactions)
        .where(eq(transactions.ledgerId, ledgerId)),
    ).toHaveLength(1);
  });

  it("requires the account's currency and keeps the base currency at rate 1", async () => {
    const wrong = await send("POST", "/transactions", entry(eur, -100, "USD"));
    expect(wrong.statusCode).toBe(409);
    expect(wrong.json().errors[0].field).toBe("amount.currency");
    expect(
      (
        await send(
          "POST",
          "/transactions",
          entry(usd, -100, "USD", { fxRate: "2" }),
        )
      ).statusCode,
    ).toBe(409);
    const base = await createEntry(usd, -100, "USD", { fxRate: "1" });
    expect(base.fxRate).toBe("1");
    expect(base.baseAmount.amount).toBe(-100);
  });

  it("never uses another ledger's rates", async () => {
    await db.delete(exchangeRates).where(eq(exchangeRates.ledgerId, ledgerId));
    await rate("EUR", "2026-10-02", "9.9", foreignLedger);
    const response = await send(
      "POST",
      "/transactions",
      entry(eur, -100, "EUR"),
    );
    expect(response.statusCode).toBe(409);
  });
});

describe("editing keeps the saved rate", () => {
  it("recomputes from the entry's own rate unless it is changed by hand", async () => {
    const created = await createEntry(eur, -10000, "EUR");
    await rate("EUR", "2026-10-06", "1.5");
    const amount = await send("PATCH", `/transactions/${created.id}`, {
      expectedVersion: 1,
      amount: money(-20000, "EUR"),
    });
    expect(amount.statusCode, amount.body).toBe(200);
    const edited = transactionSchema.parse(amount.json());
    expect(edited.fxRate).toBe("1.1217");
    expect(edited.baseAmount.amount).toBe(-22434);
    // Moving the date does not fetch a new rate.
    const moved = transactionSchema.parse(
      (
        await send("PATCH", `/transactions/${created.id}`, {
          expectedVersion: 2,
          date: "2026-10-07",
        })
      ).json(),
    );
    expect(moved.fxRate).toBe("1.1217");
    const manual = transactionSchema.parse(
      (
        await send("PATCH", `/transactions/${created.id}`, {
          expectedVersion: 3,
          fxRate: "1.5",
        })
      ).json(),
    );
    expect(manual.fxRate).toBe("1.5");
    expect(manual.baseAmount.amount).toBe(-30000);
  });

  it("prices again when an entry moves to an account in another currency", async () => {
    const created = await createEntry(eur, -10000, "EUR");
    const sameAmount = await send("PATCH", `/transactions/${created.id}`, {
      expectedVersion: 1,
      accountId: usd,
    });
    expect(sameAmount.statusCode).toBe(409);
    const moved = transactionSchema.parse(
      (
        await send("PATCH", `/transactions/${created.id}`, {
          expectedVersion: 1,
          accountId: usd,
          amount: money(-5000, "USD"),
        })
      ).json(),
    );
    expect(moved.fxRate).toBe("1");
    expect(moved.baseAmount).toEqual(money(-5000, "USD"));
  });
});

describe("split entries in another currency", () => {
  it("shares the base amount across lines exactly", async () => {
    const created = await createEntry(eur, -10000, "EUR", {
      categoryId: null,
      splits: [
        { categoryId: food, amount: money(-3333, "EUR"), note: null },
        { categoryId: rent, amount: money(-3333, "EUR"), note: null },
        { categoryId: food, amount: money(-3334, "EUR"), note: null },
      ],
    });
    expect(created.baseAmount.amount).toBe(-11217);
    expect(created.splits.map((line) => line.amount.currency)).toEqual([
      "EUR",
      "EUR",
      "EUR",
    ]);
    const stored = await db
      .select()
      .from(transactionSplits)
      .where(eq(transactionSplits.transactionId, created.id));
    expect(stored.reduce((sum, line) => sum + line.baseAmount, 0)).toBe(-11217);
    expect(stored.reduce((sum, line) => sum + line.amount, 0)).toBe(-10000);
  });

  it("rejects lines in another currency than the entry", async () => {
    const response = await send(
      "POST",
      "/transactions",
      entry(eur, -10000, "EUR", {
        categoryId: null,
        splits: [
          { categoryId: food, amount: money(-5000, "USD"), note: null },
          { categoryId: rent, amount: money(-5000, "EUR"), note: null },
        ],
      }),
    );
    expect(response.statusCode).toBe(400);
  });
});

describe("transfers across currencies", () => {
  it("fixes the value from the base-currency side and nets to zero", async () => {
    // 100.00 USD becomes 89.00 EUR: the dollars set the base value.
    const out = await createTransfer(usd, eur, 10000, "USD", {
      receivedAmount: money(8900, "EUR"),
    });
    expect(out.amount).toEqual(money(10000, "USD"));
    expect(out.receivedAmount).toEqual(money(8900, "EUR"));
    expect(out.baseAmount).toEqual(money(10000, "USD"));
    const stored = await legs(out.id);
    const from = stored.find((row) => row.amount < 0);
    const to = stored.find((row) => row.amount > 0);
    expect([from?.amount, from?.currency, from?.baseAmount]).toEqual([
      -10000,
      "USD",
      -10000,
    ]);
    expect([to?.amount, to?.currency, to?.baseAmount]).toEqual([
      8900,
      "EUR",
      10000,
    ]);
    expect(Number(from?.fxRate)).toBe(1);
    expect(to?.fxRate).toBe("1.1235955056");
    // Balances move in each account's own currency.
    const balance = async (id: string) =>
      accountSchema.parse(
        (
          await app.inject({
            url: `${root()}/accounts/${id}`,
            headers: { cookie },
          })
        ).json(),
      ).balance;
    expect(await balance(usd)).toEqual(money(990000, "USD"));
    expect(await balance(eur)).toEqual(money(1008900, "EUR"));
  });

  it("takes the value from the received dollars when money arrives in the base currency", async () => {
    const out = await createTransfer(eur, usd, 10000, "EUR", {
      receivedAmount: money(11200, "USD"),
    });
    expect(out.baseAmount.amount).toBe(11200);
    const from = (await legs(out.id)).find((row) => row.amount < 0);
    expect(from?.baseAmount).toBe(-11200);
    // Read straight from the database, where the exact decimal keeps its scale.
    expect(Number(from?.fxRate)).toBe(1.12);
  });

  it("looks up the sent currency's rate when neither account is in the base currency", async () => {
    const out = await createTransfer(eur, bdt, 10000, "EUR", {
      receivedAmount: money(1_370_000, "BDT"),
    });
    // 100.00 EUR at 1.1217 is 112.17 USD, carried on both legs with opposite signs.
    expect(out.baseAmount.amount).toBe(11217);
    const stored = await legs(out.id);
    expect(stored.reduce((sum, row) => sum + row.baseAmount, 0)).toBe(0);
    expect(Number(stored.find((row) => row.amount < 0)?.fxRate)).toBe(1.1217);
    // BDT leg: 112.17 USD for 13,700.00 BDT.
    expect(stored.find((row) => row.amount > 0)?.fxRate).toBe("0.0081875912");
  });

  it("keeps one amount and one rate within a currency", async () => {
    const out = await createTransfer(eur, eur2, 5000, "EUR");
    expect(out.receivedAmount).toEqual(money(5000, "EUR"));
    const stored = await legs(out.id);
    expect(stored.map((row) => row.baseAmount).sort((a, b) => a - b)).toEqual([
      -5609, 5609,
    ]);
    expect(stored.every((row) => Number(row.fxRate) === 1.1217)).toBe(true);
    const manual = await createTransfer(eur, eur2, 5000, "EUR", {
      fxRate: "1.2",
    });
    expect(manual.baseAmount.amount).toBe(6000);
  });

  it("explains what is missing or inconsistent", async () => {
    const field = async (response: Awaited<ReturnType<typeof transfer>>) => {
      expect(response.statusCode, response.body).toBe(409);
      return response.json().errors[0].field as string;
    };
    expect(await field(await transfer(usd, eur, 10000, "USD"))).toBe(
      "receivedAmount",
    );
    expect(
      await field(
        await transfer(usd, eur, 10000, "USD", {
          receivedAmount: money(100, "USD"),
        }),
      ),
    ).toBe("receivedAmount.currency");
    expect(
      await field(
        await transfer(eur, eur2, 5000, "EUR", {
          receivedAmount: money(4000, "EUR"),
        }),
      ),
    ).toBe("receivedAmount");
    expect(
      await field(
        await transfer(usd, eur, 10000, "USD", {
          receivedAmount: money(8900, "EUR"),
          fxRate: "1.1",
        }),
      ),
    ).toBe("fxRate");
    expect(
      await field(
        await transfer(usd, eur, 10000, "EUR", {
          receivedAmount: money(8900, "EUR"),
        }),
      ),
    ).toBe("amount.currency");
    expect(
      await field(
        await transfer(eur, bdt, 10000, "EUR", {
          receivedAmount: money(100, "BDT"),
          date: "2026-09-01",
        }),
      ),
    ).toBe("currency");
  });

  it("keeps the saved rate on an edit and restores both legs together", async () => {
    const out = await createTransfer(eur, bdt, 10000, "EUR", {
      receivedAmount: money(1_370_000, "BDT"),
    });
    await rate("EUR", "2026-10-06", "1.5");
    const edited = await send("PATCH", `/transfers/${out.id}`, {
      fromAccountId: eur,
      toAccountId: bdt,
      amount: money(20000, "EUR"),
      receivedAmount: money(2_740_000, "BDT"),
      date: "2026-10-05",
      time: null,
      note: null,
      expectedVersion: out.version,
    });
    expect(edited.statusCode, edited.body).toBe(200);
    expect(transferSchema.parse(edited.json()).baseAmount.amount).toBe(22434);
    const removed = await send("DELETE", `/transfers/${out.id}`, {
      expectedVersion: 2,
    });
    expect(removed.statusCode).toBe(204);
    const restored = await send("POST", `/transfers/${out.id}/restore`, {
      expectedVersion: 3,
    });
    expect(restored.statusCode, restored.body).toBe(200);
    const stored = await legs(out.id);
    expect(stored.reduce((sum, row) => sum + row.baseAmount, 0)).toBe(0);
    expect(stored.every((row) => row.deletedAt === null)).toBe(true);
  });
});

describe("Home across currencies", () => {
  it("values balances at the newest rate and names currencies with no rate", async () => {
    await rate("EUR", "2026-10-04", "1.2");
    await db
      .delete(exchangeRates)
      .where(
        and(
          eq(exchangeRates.ledgerId, ledgerId),
          eq(exchangeRates.code, "JPY"),
        ),
      );
    await db
      .update(accounts)
      .set({ openingBalance: 5000 })
      .where(eq(accounts.id, jpy));
    const home = await getHomeSummary(db, ownerId, ledgerId, "2026-10");
    // USD 10,000.00 + EUR 10,000.00 at 1.2 + BDT 1,000,000.00 at 0.0082; yen has no rate.
    const expected = 1_000_000 + 1_200_000 + 820_000;
    expect(home.inHand.amount).toBe(expected);
    expect(home.netWorth.amount).toBe(expected);
    expect(home.unconvertedCurrencies).toEqual(["JPY"]);
    const row = (id: string) =>
      home.accounts.find((account) => account.id === id);
    expect(row(eur)?.balance).toEqual(money(1_000_000, "EUR"));
    expect(row(eur)?.baseBalance).toEqual(money(1_200_000, "USD"));
    expect(row(jpy)?.baseBalance).toBeNull();
  });

  it("shows foreign entries in their own currency with their frozen base value", async () => {
    await createEntry(eur, -10000, "EUR");
    await rate("EUR", "2026-10-06", "1.5");
    const home = await getHomeSummary(db, ownerId, ledgerId, "2026-10");
    expect(home.moneyOut.amount).toBe(11217);
    const latest = home.latest.find(
      (row) => row.transaction.amount.currency === "EUR",
    );
    expect(latest?.transaction.fxRate).toBe("1.1217");
    expect(latest?.transaction.baseAmount.amount).toBe(-11217);
  });
});

describe("database rules", () => {
  const row = {
    ledgerId,
    categoryId: food,
    kind: "expense" as const,
    date: "2026-10-05",
    status: "cleared" as const,
  };
  it("ties every entry to its account's currency and keeps the base currency at rate 1", async () => {
    await expect(
      db.insert(transactions).values({
        ...row,
        accountId: usd,
        currency: "EUR",
        fxRate: "1.1",
        amount: -100,
        baseAmount: -110,
      }),
    ).rejects.toThrow();
    await expect(
      db.insert(transactions).values({
        ...row,
        accountId: usd,
        amount: -100,
        baseAmount: -100,
        fxRate: "2",
      }),
    ).rejects.toThrow();
    await expect(
      db.insert(transactions).values({
        ...row,
        accountId: eur,
        currency: "EUR",
        fxRate: "0",
        amount: -100,
        baseAmount: 0,
      }),
    ).rejects.toThrow();
    await db.insert(transactions).values({
      ...row,
      accountId: eur,
      currency: "EUR",
      fxRate: "1.1217",
      amount: -100,
      baseAmount: -112,
    });
  });

  it("requires the legs of a transfer to net to zero in the base currency", async () => {
    const pair = (fromBase: number, toBase: number) => {
      const transferId = newId();
      const now = new Date();
      const common = {
        ledgerId,
        categoryId: null,
        kind: "transfer" as const,
        transferId,
        date: "2026-10-05",
        status: "cleared" as const,
        createdAt: now,
        updatedAt: now,
      };
      return db.insert(transactions).values([
        { ...common, accountId: usd, amount: -10000, baseAmount: fromBase },
        {
          ...common,
          accountId: eur,
          currency: "EUR",
          fxRate: "1.12",
          amount: 8900,
          baseAmount: toBase,
        },
      ]);
    };
    await expect(pair(-10000, 9999)).rejects.toThrow();
    await pair(-10000, 10000);
    // Within one currency the amounts must also be opposites.
    const same = newId();
    const now = new Date();
    const common = {
      ledgerId,
      categoryId: null,
      kind: "transfer" as const,
      transferId: same,
      date: "2026-10-05",
      status: "cleared" as const,
      createdAt: now,
      updatedAt: now,
    };
    await expect(
      db.insert(transactions).values([
        { ...common, accountId: usd, amount: -10000, baseAmount: -10000 },
        {
          ...common,
          accountId: bdt,
          currency: "BDT",
          fxRate: "0.0082",
          amount: 1,
          baseAmount: 10000,
        },
      ]),
    ).resolves.toBeDefined();
  });
});
