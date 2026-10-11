import {
  currencyListSchema,
  exchangeRateListSchema,
  exchangeRateSchema,
  newId,
  type RefreshRatesResult,
  refreshRatesResultSchema,
} from "@ledgerline/shared";
import { inArray } from "drizzle-orm";
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
  account as credentials,
  currencies,
  exchangeRates,
  ledgerMembers,
  ledgers,
  session,
  user,
  writeReceipts,
} from "../../db/schema";
import { ApiProblem } from "../../lib/problem";
import { hashPassword } from "../auth/password";
import type { FetchedRate, RateFetcher } from "./provider";
import { lookupRate } from "./service";

const url = process.env.TEST_DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith("/ledgerline_test"))
  throw new Error(
    "Currency tests require the dedicated ledgerline_test database.",
  );
const config = readConfig({
  NODE_ENV: "test",
  DATABASE_URL: url,
  APP_URL: "http://localhost:5173",
  BETTER_AUTH_SECRET: "currencies-test-secret-only-0000000000000000",
  OWNER_EMAIL: "currencies-owner@example.com",
  OWNER_PASSWORD: "Currencies-test-password-000",
  OWNER_NAME: "Currencies owner",
});
const { db, pool } = createDatabase(url);
// The fake source never touches the network; tests set what it returns.
const source = new Map<string, FetchedRate | null>();
const fetchRate = vi.fn<RateFetcher>(async (code) => source.get(code) ?? null);
const app = await buildApp(db, config, { fetchRate });
const ledgerId = newId();
const foreignLedger = newId();
const fixtureLedgers = [ledgerId, foreignLedger];
const fixtureUsers = [newId(), newId(), newId()];
let ownerCookie = "";
let editorCookie = "";
let viewerCookie = "";
const root = (ledger = ledgerId) => `/api/v1/ledgers/${ledger}`;
const headers = (cookie = ownerCookie, key = newId()) => ({
  "content-type": "application/json",
  cookie,
  origin: config.APP_URL,
  "idempotency-key": key,
});
const send = (
  method: "POST" | "PUT" | "DELETE",
  path: string,
  payload: unknown,
  ledger = ledgerId,
  cookie = ownerCookie,
  key = newId(),
) =>
  app.inject({
    method,
    url: `${root(ledger)}${path}`,
    headers: headers(cookie, key),
    payload: JSON.stringify(payload),
  });
const pin = (code: string, ledger = ledgerId, cookie = ownerCookie) =>
  send("POST", "/currencies", { code }, ledger, cookie);
const setRate = (
  code: string,
  date: string,
  rate: string,
  expectedVersion?: number,
  ledger = ledgerId,
) =>
  send(
    "PUT",
    "/exchange-rates",
    { code, date, rate, ...(expectedVersion ? { expectedVersion } : {}) },
    ledger,
  );
const refresh = (body: unknown = {}, ledger = ledgerId, cookie = ownerCookie) =>
  send("POST", "/exchange-rates/refresh", body, ledger, cookie);
const list = async (code: string, ledger = ledgerId) => {
  const response = await app.inject({
    url: `${root(ledger)}/exchange-rates?code=${code}`,
    headers: { cookie: ownerCookie },
  });
  expect(response.statusCode).toBe(200);
  return exchangeRateListSchema.parse(response.json()).items;
};
const pinned = async () => {
  const response = await app.inject({
    url: `${root()}/currencies`,
    headers: { cookie: ownerCookie },
  });
  expect(response.statusCode).toBe(200);
  return currencyListSchema.parse(response.json());
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
    .delete(exchangeRates)
    .where(inArray(exchangeRates.ledgerId, fixtureLedgers));
  await db
    .delete(currencies)
    .where(inArray(currencies.ledgerId, fixtureLedgers));
  await db
    .delete(writeReceipts)
    .where(inArray(writeReceipts.ledgerId, fixtureLedgers));
}
beforeAll(async () => {
  await applyMigrations(url);
  await db
    .insert(ledgers)
    .values(
      fixtureLedgers.map((id) => ({ id, name: "Synthetic currencies ledger" })),
    );
  const password = await hashPassword(config.OWNER_PASSWORD);
  for (const [index, role] of (
    ["owner", "editor", "viewer"] as const
  ).entries()) {
    const id = fixtureUsers[index] ?? "";
    await db.insert(user).values({
      id,
      name: role,
      email: `currencies-${role}-${id}@example.com`,
    });
    await db.insert(credentials).values({
      userId: id,
      accountId: id,
      providerId: "credential",
      password,
    });
    await db.insert(ledgerMembers).values({ userId: id, ledgerId, role });
  }
  await app.ready();
  ownerCookie = await signIn(`currencies-owner-${fixtureUsers[0]}@example.com`);
  editorCookie = await signIn(
    `currencies-editor-${fixtureUsers[1]}@example.com`,
  );
  viewerCookie = await signIn(
    `currencies-viewer-${fixtureUsers[2]}@example.com`,
  );
});
beforeEach(async () => {
  await clearRows();
  source.clear();
  fetchRate.mockClear();
});
afterAll(async () => {
  await app.close();
  await clearRows();
  await db.delete(session).where(inArray(session.userId, fixtureUsers));
  await db.delete(credentials).where(inArray(credentials.userId, fixtureUsers));
  await db
    .delete(ledgerMembers)
    .where(inArray(ledgerMembers.ledgerId, fixtureLedgers));
  await db.delete(ledgers).where(inArray(ledgers.id, fixtureLedgers));
  await db.delete(user).where(inArray(user.id, fixtureUsers));
  await pool.end();
});

describe("pinned currencies", () => {
  it("starts empty with the base currency named", async () => {
    const result = await pinned();
    expect(result.baseCurrency).toBe("USD");
    expect(result.items).toEqual([]);
  });

  it("adds a currency once, never the base, and rejects unknown codes", async () => {
    expect((await pin("EUR")).statusCode).toBe(201);
    expect((await pin("EUR")).statusCode).toBe(409);
    expect((await pin("USD")).statusCode).toBe(409);
    expect((await pin("ZZZ")).statusCode).toBe(400);
    expect((await pin("eur")).statusCode).toBe(400);
    expect((await pinned()).items.map((item) => item.code)).toEqual(["EUR"]);
  });

  it("replays the same key and removes a currency with its version", async () => {
    const key = newId();
    const first = await send(
      "POST",
      "/currencies",
      { code: "GBP" },
      ledgerId,
      ownerCookie,
      key,
    );
    const again = await send(
      "POST",
      "/currencies",
      { code: "GBP" },
      ledgerId,
      ownerCookie,
      key,
    );
    expect(again.headers["idempotency-replayed"]).toBe("true");
    expect(again.json()).toEqual(first.json());
    const { id, version } = first.json() as { id: string; version: number };
    expect(
      (await send("DELETE", `/currencies/${id}`, { expectedVersion: 9 }))
        .statusCode,
    ).toBe(409);
    expect(
      (await send("DELETE", `/currencies/${id}`, { expectedVersion: version }))
        .statusCode,
    ).toBe(204);
    expect((await pinned()).items).toEqual([]);
  });
});

describe("stored rates", () => {
  it("sets, lists and edits manual rates with versions", async () => {
    await pin("EUR");
    const created = await setRate("EUR", "2026-10-09", "1.1217");
    expect(created.statusCode).toBe(201);
    const rate = exchangeRateSchema.parse(created.json());
    expect(rate).toMatchObject({
      rate: "1.1217",
      source: "manual",
      version: 1,
    });
    expect((await setRate("EUR", "2026-10-09", "1.2")).statusCode).toBe(409);
    const edited = await setRate("EUR", "2026-10-09", "1.13", 1);
    expect(edited.statusCode).toBe(200);
    expect(exchangeRateSchema.parse(edited.json()).version).toBe(2);
    expect((await setRate("EUR", "2026-10-09", "1.14", 1)).statusCode).toBe(
      409,
    );
    await setRate("EUR", "2026-10-10", "1.15");
    expect((await list("EUR")).map((item) => item.date)).toEqual([
      "2026-10-10",
      "2026-10-09",
    ]);
    expect((await pinned()).items[0]?.latestRate?.rate).toBe("1.15");
  });

  it("rejects bad rates, the base currency, unpinned currencies and the future", async () => {
    await pin("EUR");
    for (const bad of ["0", "-1", "1e3", "abc", "1.12345678901", ""])
      expect((await setRate("EUR", "2026-10-09", bad)).statusCode).toBe(400);
    expect((await setRate("USD", "2026-10-09", "1")).statusCode).toBe(409);
    expect((await setRate("GBP", "2026-10-09", "1.3")).statusCode).toBe(409);
    expect((await setRate("EUR", "2999-01-01", "1.1")).statusCode).toBe(409);
    expect((await setRate("EUR", "2026-10-09", "1.1", 1)).statusCode).toBe(404);
  });

  it("removes a rate with its version", async () => {
    await pin("EUR");
    const rate = exchangeRateSchema.parse(
      (await setRate("EUR", "2026-10-09", "1.1")).json(),
    );
    expect(
      (
        await send("DELETE", `/exchange-rates/${rate.id}`, {
          expectedVersion: 5,
        })
      ).statusCode,
    ).toBe(409);
    expect(
      (
        await send("DELETE", `/exchange-rates/${rate.id}`, {
          expectedVersion: 1,
        })
      ).statusCode,
    ).toBe(204);
    expect(await list("EUR")).toEqual([]);
  });
});

describe("refreshing rates", () => {
  it("stores fetched rates, updates api rates and never overwrites manual ones", async () => {
    await pin("EUR");
    await pin("BDT");
    await pin("JPY");
    source.set("EUR", { date: "2026-10-09", rate: "1.1217" });
    source.set("BDT", { date: "2026-10-09", rate: "0.00812" });
    const first = refreshRatesResultSchema.parse((await refresh()).json());
    expect(first).toEqual({ updated: 2, keptManual: 0, failed: ["JPY"] });
    expect((await list("EUR"))[0]).toMatchObject({
      rate: "1.1217",
      source: "api",
    });

    source.set("EUR", { date: "2026-10-09", rate: "1.12" });
    const second = refreshRatesResultSchema.parse((await refresh()).json());
    expect(second.updated).toBe(1);
    expect((await list("EUR"))[0]?.rate).toBe("1.12");

    const bdt = (await list("BDT"))[0];
    await setRate("BDT", "2026-10-09", "0.0083", bdt?.version);
    source.set("BDT", { date: "2026-10-09", rate: "0.009" });
    const third: RefreshRatesResult = refreshRatesResultSchema.parse(
      (await refresh()).json(),
    );
    expect(third.keptManual).toBe(1);
    expect((await list("BDT"))[0]).toMatchObject({
      rate: "0.0083",
      source: "manual",
    });
  });

  it("refreshes one currency, and only a pinned one", async () => {
    await pin("EUR");
    source.set("EUR", { date: "2026-10-09", rate: "1.1" });
    source.set("GBP", { date: "2026-10-09", rate: "1.3" });
    expect((await refresh({ code: "GBP" })).statusCode).toBe(409);
    expect(fetchRate).not.toHaveBeenCalled();
    await refresh({ code: "EUR" });
    expect(fetchRate).toHaveBeenCalledTimes(1);
    expect(fetchRate).toHaveBeenCalledWith("EUR", "USD");
  });

  it("reports failures instead of erroring, and ignores rates dated far ahead", async () => {
    await pin("EUR");
    await pin("GBP");
    source.set("GBP", { date: "2999-01-01", rate: "1.3" });
    const result = refreshRatesResultSchema.parse((await refresh()).json());
    expect(result.failed.sort()).toEqual(["EUR", "GBP"]);
    expect(await list("GBP")).toEqual([]);
  });

  it("lets removed api rates be fetched again", async () => {
    await pin("EUR");
    source.set("EUR", { date: "2026-10-09", rate: "1.1" });
    await refresh();
    const rate = (await list("EUR"))[0];
    await send("DELETE", `/exchange-rates/${rate?.id}`, {
      expectedVersion: rate?.version,
    });
    expect(await list("EUR")).toEqual([]);
    await refresh();
    expect(await list("EUR")).toHaveLength(1);
  });
});

describe("rate lookup for entries", () => {
  it("uses the newest rate on or before the date, one for the base currency, else asks for a rate", async () => {
    await pin("EUR");
    await setRate("EUR", "2026-10-02", "1.1");
    await setRate("EUR", "2026-10-09", "1.2");
    const at = (date: string, code = "EUR") =>
      lookupRate(db, ledgerId, code, "USD", date);
    expect(await at("2026-10-09")).toMatchObject({
      rate: "1.2",
      date: "2026-10-09",
    });
    // A Sunday uses Friday's rate.
    expect(await at("2026-10-11")).toMatchObject({
      rate: "1.2",
      source: "manual",
    });
    expect(await at("2026-10-05")).toMatchObject({
      rate: "1.1",
      date: "2026-10-02",
    });
    expect(await at("2026-10-05", "USD")).toEqual({
      rate: "1",
      date: "2026-10-05",
      source: "base",
    });
    await expect(at("2026-10-01")).rejects.toBeInstanceOf(ApiProblem);
    await expect(at("2026-10-01", "GBP")).rejects.toMatchObject({
      statusCode: 409,
    });
  });
});

describe("rate preview for entries", () => {
  const preview = (query: string, ledger = ledgerId, cookie = ownerCookie) =>
    app.inject({
      url: `${root(ledger)}/exchange-rates/lookup?${query}`,
      headers: { cookie },
    });
  it("gives the rate an entry would be saved with, without failing when none exists", async () => {
    await pin("EUR");
    await setRate("EUR", "2026-10-02", "1.1217");
    const exact = (await preview("code=EUR&date=2026-10-02")).json();
    expect(exact).toMatchObject({
      code: "EUR",
      baseCurrency: "USD",
      rate: "1.1217",
      rateDate: "2026-10-02",
      source: "manual",
    });
    // A Sunday uses the Friday rate, and says which day it came from.
    expect((await preview("code=EUR&date=2026-10-04")).json()).toMatchObject({
      rate: "1.1217",
      rateDate: "2026-10-02",
    });
    // Before any stored rate there is none to preview.
    expect((await preview("code=EUR&date=2026-09-01")).json()).toMatchObject({
      rate: null,
      rateDate: null,
      source: null,
    });
    expect((await preview("code=USD&date=2026-10-04")).json()).toMatchObject({
      rate: "1",
      source: "base",
    });
  });

  it("matches what saving uses and rejects bad input", async () => {
    await pin("EUR");
    await setRate("EUR", "2026-10-02", "1.1217");
    const preview1 = (await preview("code=EUR&date=2026-10-09")).json();
    const looked = await lookupRate(db, ledgerId, "EUR", "USD", "2026-10-09");
    expect(preview1.rate).toBe(looked.rate);
    for (const bad of [
      "code=EUR",
      "date=2026-10-02",
      "code=eur&date=2026-10-02",
      "code=EUR&date=2026-13-40",
    ])
      expect((await preview(bad)).statusCode).toBe(400);
    expect(
      (
        await app.inject({
          url: `${root()}/exchange-rates/lookup?code=EUR&date=2026-10-02`,
        })
      ).statusCode,
    ).toBe(401);
  });

  it("is readable by viewers and never uses another ledger's rates", async () => {
    await pin("EUR");
    await db.insert(exchangeRates).values({
      ledgerId: foreignLedger,
      code: "EUR",
      date: "2026-10-02",
      rate: "9.9",
      source: "manual",
    });
    expect((await preview("code=EUR&date=2026-10-03")).json().rate).toBeNull();
    expect(
      (await preview("code=EUR&date=2026-10-03", ledgerId, viewerCookie))
        .statusCode,
    ).toBe(200);
    expect(
      (await preview("code=EUR&date=2026-10-03", foreignLedger)).statusCode,
    ).toBe(404);
  });
});

describe("access", () => {
  it("lets viewers read but not write, and editors write", async () => {
    await pin("EUR");
    const viewerRead = await app.inject({
      url: `${root()}/currencies`,
      headers: { cookie: viewerCookie },
    });
    expect(viewerRead.statusCode).toBe(200);
    expect((await pin("GBP", ledgerId, viewerCookie)).statusCode).toBe(403);
    expect((await refresh({}, ledgerId, viewerCookie)).statusCode).toBe(403);
    expect(fetchRate).not.toHaveBeenCalled();
    expect((await pin("GBP", ledgerId, editorCookie)).statusCode).toBe(201);
  });

  it("requires a session, a trusted origin and an idempotency key", async () => {
    expect((await app.inject({ url: `${root()}/currencies` })).statusCode).toBe(
      401,
    );
    const noOrigin = await app.inject({
      method: "POST",
      url: `${root()}/currencies`,
      headers: { ...headers(), origin: "https://elsewhere.example.com" },
      payload: JSON.stringify({ code: "EUR" }),
    });
    expect(noOrigin.statusCode).toBe(403);
    const noKey = await app.inject({
      method: "POST",
      url: `${root()}/currencies`,
      headers: { ...headers(), "idempotency-key": "" },
      payload: JSON.stringify({ code: "EUR" }),
    });
    expect(noKey.statusCode).toBe(400);
  });
});

describe("ledger isolation", () => {
  it("cannot read or write another ledger's currencies and rates", async () => {
    await db
      .insert(currencies)
      .values({ ledgerId: foreignLedger, code: "EUR" });
    const [foreignRate] = await db
      .insert(exchangeRates)
      .values({
        ledgerId: foreignLedger,
        code: "EUR",
        date: "2026-10-09",
        rate: "1.1",
        source: "api",
      })
      .returning();
    const [foreignCurrency] = await db
      .select()
      .from(currencies)
      .where(inArray(currencies.ledgerId, [foreignLedger]));
    for (const path of ["/currencies", "/exchange-rates?code=EUR"]) {
      const response = await app.inject({
        url: `${root(foreignLedger)}${path}`,
        headers: { cookie: ownerCookie },
      });
      expect(response.statusCode).toBe(404);
    }
    expect((await pin("GBP", foreignLedger)).statusCode).toBe(404);
    expect((await refresh({}, foreignLedger)).statusCode).toBe(404);
    expect(fetchRate).not.toHaveBeenCalled();
    // Foreign IDs are not found through this ledger.
    await pin("EUR");
    expect(
      (
        await send("DELETE", `/currencies/${foreignCurrency?.id}`, {
          expectedVersion: 1,
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await send("DELETE", `/exchange-rates/${foreignRate?.id}`, {
          expectedVersion: 1,
        })
      ).statusCode,
    ).toBe(404);
    // This ledger sees none of the other ledger's rates.
    expect(await list("EUR")).toEqual([]);
    expect((await pinned()).items[0]?.latestRate).toBeNull();
    expect(
      await db
        .select()
        .from(exchangeRates)
        .where(inArray(exchangeRates.ledgerId, [foreignLedger])),
    ).toHaveLength(1);
  });
});
