import { describe, expect, it } from "vitest";
import { newId } from "./index";
import {
  createRecurringRuleSchema,
  firstOccurrenceOnOrAfter,
  occurrence,
  occurrenceAfter,
  occurrencesBetween,
  type Schedule,
} from "./recurring";

const monthly = (startDate: string, interval = 1): Schedule => ({
  frequency: "month",
  interval,
  startDate,
});

describe("schedule dates", () => {
  it("clamps a month's missing days without drifting", () => {
    expect(
      occurrencesBetween(monthly("2026-01-31"), "2026-01-01", "2026-06-30"),
    ).toEqual([
      "2026-01-31",
      "2026-02-28",
      "2026-03-31",
      "2026-04-30",
      "2026-05-31",
      "2026-06-30",
    ]);
    expect(occurrence(monthly("2028-01-31"), 1)).toBe("2028-02-29");
  });

  it("handles leap days for yearly rules", () => {
    const yearly: Schedule = {
      frequency: "year",
      interval: 1,
      startDate: "2028-02-29",
    };
    expect([1, 2, 3, 4].map((n) => occurrence(yearly, n))).toEqual([
      "2029-02-28",
      "2030-02-28",
      "2031-02-28",
      "2032-02-29",
    ]);
  });

  it("steps days and weeks by the interval", () => {
    const fortnight: Schedule = {
      frequency: "week",
      interval: 2,
      startDate: "2026-10-09",
    };
    expect(occurrencesBetween(fortnight, "2026-10-09", "2026-11-30")).toEqual([
      "2026-10-09",
      "2026-10-23",
      "2026-11-06",
      "2026-11-20",
    ]);
    const everyThreeDays: Schedule = {
      frequency: "day",
      interval: 3,
      startDate: "2026-12-30",
    };
    expect(
      occurrencesBetween(everyThreeDays, "2026-12-30", "2027-01-08"),
    ).toEqual(["2026-12-30", "2027-01-02", "2027-01-05", "2027-01-08"]);
  });

  it("finds the first occurrence on or after a date, including a start in the future", () => {
    const schedule = monthly("2026-03-15", 2);
    expect(firstOccurrenceOnOrAfter(schedule, "2026-01-01")).toEqual({
      index: 0,
      date: "2026-03-15",
    });
    expect(firstOccurrenceOnOrAfter(schedule, "2026-03-16")?.date).toBe(
      "2026-05-15",
    );
    expect(firstOccurrenceOnOrAfter(schedule, "2026-05-15")?.date).toBe(
      "2026-05-15",
    );
    expect(occurrenceAfter(schedule, "2026-05-15")).toBe("2026-07-15");
  });

  it("agrees with a brute-force walk for many schedules and dates", () => {
    const starts = [
      "2024-02-29",
      "2026-01-31",
      "2026-12-31",
      "2027-03-01",
      "2026-10-11",
    ];
    for (const frequency of ["day", "week", "month", "year"] as const)
      for (const interval of [1, 2, 3, 7, 13])
        for (const startDate of starts) {
          const schedule: Schedule = { frequency, interval, startDate };
          const walked: string[] = [];
          for (let n = 0; n < 60; n++) {
            const date = occurrence(schedule, n);
            if (date) walked.push(date);
          }
          for (const probe of [
            "2024-01-01",
            "2026-02-28",
            "2026-10-11",
            "2027-02-28",
            "2028-02-29",
            "2030-06-15",
          ]) {
            const expected = walked.find((date) => date >= probe);
            if (expected)
              expect(firstOccurrenceOnOrAfter(schedule, probe)?.date).toBe(
                expected,
              );
          }
          expect(walked).toEqual([...walked].sort());
          expect(new Set(walked).size).toBe(walked.length);
        }
  });

  it("stops at the limit and past year 9999", () => {
    expect(
      occurrencesBetween(
        { frequency: "day", interval: 1, startDate: "2026-01-01" },
        "2026-01-01",
        "2030-01-01",
        5,
      ),
    ).toHaveLength(5);
    expect(occurrence(monthly("9999-12-31"), 1)).toBeNull();
    expect(
      firstOccurrenceOnOrAfter(monthly("9999-12-31"), "9999-12-31")?.date,
    ).toBe("9999-12-31");
    expect(occurrenceAfter(monthly("9999-12-31"), "9999-12-31")).toBeNull();
  });
});

describe("rule shape", () => {
  const account = newId();
  const base = {
    title: "Rent",
    kind: "expense",
    accountId: account,
    toAccountId: null,
    categoryId: newId(),
    amount: { amount: -120000, currency: "USD" },
    receivedAmount: null,
    bonus: null,
    payee: null,
    note: null,
    frequency: "month",
    interval: 1,
    startDate: "2026-11-01",
    endDate: null,
  };
  const bad = (change: object) =>
    createRecurringRuleSchema.safeParse({ ...base, ...change }).success;

  it("accepts a valid expense and rejects wrong signs", () => {
    expect(bad({})).toBe(true);
    expect(bad({ amount: { amount: 100, currency: "USD" } })).toBe(false);
    expect(bad({ kind: "income" })).toBe(false);
    expect(
      bad({ kind: "income", amount: { amount: 5000, currency: "USD" } }),
    ).toBe(true);
  });

  it("checks transfers, bonus and dates", () => {
    const transfer = {
      kind: "transfer",
      toAccountId: newId(),
      categoryId: null,
      amount: { amount: 10000, currency: "USD" },
    };
    expect(bad(transfer)).toBe(true);
    expect(bad({ ...transfer, toAccountId: account })).toBe(false);
    expect(bad({ ...transfer, toAccountId: null })).toBe(false);
    expect(bad({ ...transfer, categoryId: newId() })).toBe(false);
    expect(
      bad({
        ...transfer,
        bonus: {
          amount: { amount: 250, currency: "BDT" },
          categoryId: newId(),
        },
        receivedAmount: { amount: 1200000, currency: "BDT" },
      }),
    ).toBe(true);
    expect(
      bad({
        bonus: {
          amount: { amount: 250, currency: "USD" },
          categoryId: newId(),
        },
      }),
    ).toBe(false);
    expect(bad({ receivedAmount: { amount: 5, currency: "USD" } })).toBe(false);
    expect(bad({ endDate: "2026-10-31" })).toBe(false);
    expect(bad({ endDate: "2026-11-01" })).toBe(true);
    expect(bad({ interval: 0 })).toBe(false);
    expect(bad({ title: "  " })).toBe(false);
  });
});
