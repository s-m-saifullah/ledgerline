import { localDate, newId } from "@ledgerline/shared";
import { inArray, sql } from "drizzle-orm";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { createDatabase } from "../db/client";
import { applyMigrations } from "../db/migrate";
import {
  currencies,
  exchangeRates,
  ledgerMembers,
  ledgers,
  user,
  writeReceipts,
} from "../db/schema";
import type { RateFetcher } from "../modules/currencies/provider";
import { refreshLedgerRates } from "./rates";
import { startJobRunner } from "./runner";

const url = process.env.TEST_DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith("/ledgerline_test"))
  throw new Error("Job tests require the dedicated ledgerline_test database.");
const { db, pool } = createDatabase(url);
const log = { info: vi.fn(), error: vi.fn() };
const fetchRate = vi.fn<RateFetcher>(async () => ({
  date: "2026-10-09",
  rate: "1.1217",
}));
// Ledger A has a currency pinned, B has none, C is another owner's ledger with one.
const [ledgerA, ledgerB, ledgerC] = [newId(), newId(), newId()];
const fixtureLedgers = [ledgerA, ledgerB, ledgerC];
const fixtureUsers = [newId(), newId()];
const at = (iso: string) => new Date(iso);

async function clearRows() {
  await db
    .delete(exchangeRates)
    .where(inArray(exchangeRates.ledgerId, fixtureLedgers));
  await db
    .delete(writeReceipts)
    .where(inArray(writeReceipts.ledgerId, fixtureLedgers));
}
beforeAll(async () => {
  await applyMigrations(url);
  await db.insert(ledgers).values([
    { id: ledgerA, name: "Jobs A", timeZone: "Asia/Dhaka" },
    { id: ledgerB, name: "Jobs B" },
    { id: ledgerC, name: "Jobs C" },
  ]);
  for (const [index, id] of fixtureUsers.entries())
    await db
      .insert(user)
      .values({ id, name: `owner${index}`, email: `jobs-${id}@example.com` });
  await db.insert(ledgerMembers).values([
    { ledgerId: ledgerA, userId: fixtureUsers[0] ?? "", role: "owner" },
    { ledgerId: ledgerB, userId: fixtureUsers[0] ?? "", role: "owner" },
    { ledgerId: ledgerC, userId: fixtureUsers[1] ?? "", role: "owner" },
  ]);
  await db.insert(currencies).values([
    { ledgerId: ledgerA, code: "EUR" },
    { ledgerId: ledgerC, code: "EUR" },
  ]);
});
beforeEach(async () => {
  await clearRows();
  fetchRate.mockClear();
  log.info.mockClear();
});
afterAll(async () => {
  await clearRows();
  await db
    .delete(currencies)
    .where(inArray(currencies.ledgerId, fixtureLedgers));
  await db
    .delete(ledgerMembers)
    .where(inArray(ledgerMembers.ledgerId, fixtureLedgers));
  await db.delete(ledgers).where(inArray(ledgers.id, fixtureLedgers));
  await db.delete(user).where(inArray(user.id, fixtureUsers));
  await pool.end();
});

describe("ledger-local date", () => {
  it("follows the time zone and falls back to UTC", () => {
    const instant = at("2026-10-11T03:30:00Z");
    expect(localDate(instant, null)).toBe("2026-10-11");
    expect(localDate(instant, "America/Chicago")).toBe("2026-10-10");
    expect(localDate(at("2026-10-10T20:00:00Z"), "Asia/Dhaka")).toBe(
      "2026-10-11",
    );
  });
});

describe("daily rate refresh", () => {
  it("fetches once per ledger-local day, only for ledgers with currencies", async () => {
    const first = await refreshLedgerRates(
      db,
      at("2026-10-11T01:00:00Z"),
      fetchRate,
      log,
    );
    expect(first).toMatchObject({ ledgers: 2, fetched: 2, failed: 0 });
    expect(fetchRate).toHaveBeenCalledTimes(2);
    // Later the same day in each ledger's zone: replayed, no new fetch.
    const again = await refreshLedgerRates(
      db,
      at("2026-10-11T02:00:00Z"),
      fetchRate,
      log,
    );
    expect(again).toMatchObject({ ledgers: 2, fetched: 0, failed: 0 });
    expect(fetchRate).toHaveBeenCalledTimes(2);
  });

  it("fetches again on the next local day", async () => {
    await refreshLedgerRates(db, at("2026-10-11T01:00:00Z"), fetchRate, log);
    fetchRate.mockClear();
    // 2026-10-11T01:00Z is still the 11th in Dhaka (+6); a day later is the 12th.
    const next = await refreshLedgerRates(
      db,
      at("2026-10-12T01:00:00Z"),
      fetchRate,
      log,
    );
    expect(next.fetched).toBe(2);
    expect(fetchRate).toHaveBeenCalledTimes(2);
  });

  it("stores each ledger's rates in that ledger only", async () => {
    await refreshLedgerRates(db, at("2026-10-11T01:00:00Z"), fetchRate, log);
    const rows = await db
      .select({
        ledgerId: exchangeRates.ledgerId,
        source: exchangeRates.source,
      })
      .from(exchangeRates)
      .where(inArray(exchangeRates.ledgerId, fixtureLedgers));
    expect(rows.map((row) => row.ledgerId).sort()).toEqual(
      [ledgerA, ledgerC].sort(),
    );
    expect(rows.every((row) => row.source === "api")).toBe(true);
  });

  it("logs counts only", async () => {
    await refreshLedgerRates(db, at("2026-10-11T01:00:00Z"), fetchRate, log);
    expect(log.info).toHaveBeenCalledTimes(1);
    expect(log.info.mock.calls[0]?.[0]).toEqual({
      ledgers: 2,
      fetched: 2,
      failed: 0,
    });
  });
});

describe("job runner", () => {
  it("schedules the hourly tick, runs one at start and stops cleanly", async () => {
    const schema = "pgboss_test";
    const tick = vi.fn(async (_now: Date) => undefined);
    const runner = await startJobRunner({
      connectionString: url,
      schema,
      tick,
      log,
    });
    try {
      await vi.waitFor(() => expect(tick).toHaveBeenCalled(), {
        timeout: 20000,
        interval: 250,
      });
      expect(tick.mock.calls[0]?.[0]).toBeInstanceOf(Date);
      const schedules = await runner.boss.getSchedules("tick");
      expect(schedules.map((item) => item.cron)).toEqual(["0 * * * *"]);
    } finally {
      await runner.stop();
      await db.execute(sql.raw(`DROP SCHEMA IF EXISTS ${schema} CASCADE`));
    }
  }, 40000);
});
