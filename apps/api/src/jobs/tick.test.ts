import { describe, expect, it, vi } from "vitest";
import type { Database } from "../db/client";

// ADR 0049: the hourly tick also removes people deleted more than 30 days ago.
const purgeDeletedPeople = vi.fn(async () => ({ purged: 3, failed: 1 }));
vi.mock("../modules/users/lifecycle", () => ({ purgeDeletedPeople }));
vi.mock("./rates", () => ({ refreshLedgerRates: vi.fn(async () => "rates") }));
vi.mock("./recurring", () => ({
  runRecurringRules: vi.fn(async () => "recurring"),
}));
const { runTick } = await import("./tick");

describe("the hourly tick", () => {
  it("removes deleted people with the tick's own clock and log, after the other steps", async () => {
    const db = {} as Database;
    const now = new Date("2026-12-15T12:00:00.000Z");
    const log = { info: vi.fn(), error: vi.fn() };
    const result = await runTick(db, now, { fetchRate: vi.fn(), log });
    expect(purgeDeletedPeople).toHaveBeenCalledTimes(1);
    expect(purgeDeletedPeople).toHaveBeenCalledWith(db, now, log);
    expect(result).toEqual({
      rates: "rates",
      recurring: "recurring",
      purged: { purged: 3, failed: 1 },
    });
  });
});
