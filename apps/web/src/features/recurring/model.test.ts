import type { RecurringRule } from "@ledgerline/shared";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { ruleEndHint, ruleHint, ruleStatus } from "./model";

// "Next Nov 1" has no year in the current year, so the clock is pinned (the year rule: lib/time.ts formatDay).
beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-14T12:00:00"));
});
afterAll(() => {
  vi.useRealTimers();
});
const rule = (extra: Partial<RecurringRule> = {}) =>
  ({
    title: "Rent",
    kind: "expense",
    accountId: "a1",
    frequency: "month",
    interval: 1,
    nextDate: "2026-11-01",
    paused: false,
    pausedReason: null,
    needsAttention: 0,
    ...extra,
  }) as RecurringRule;

it("says what the rule does next, or why it does not", () => {
  expect(ruleStatus(rule())).toBe("Next Nov 1");
  expect(ruleStatus(rule({ nextDate: null }))).toBe("Ended");
  expect(ruleStatus(rule({ paused: true, pausedReason: "manual" }))).toBe(
    "Paused",
  );
  expect(ruleStatus(rule({ paused: true, pausedReason: "access" }))).toBe(
    "Paused, the person it runs as can no longer write",
  );
  // A paused rule is paused even when it still has a next date.
  expect(ruleStatus(rule({ paused: true, nextDate: "2026-11-01" }))).toBe(
    "Paused",
  );
});
it("adds the year to the next date when it is not this year", () => {
  expect(ruleStatus(rule({ nextDate: "2027-01-15" }))).toBe(
    "Next Jan 15, 2027",
  );
  expect(ruleStatus(rule({ nextDate: "2025-12-31" }))).toBe(
    "Next Dec 31, 2025",
  );
});
it("makes one hint of the kind, the schedule and the status", () => {
  expect(ruleHint(rule())).toBe("Expense · Every month · Next Nov 1");
  expect(
    ruleHint(rule({ kind: "transfer", frequency: "week", interval: 2 })),
  ).toBe("Transfer · Every 2 weeks · Next Nov 1");
  expect(ruleHint(rule({ kind: "income", paused: true }))).toBe(
    "Income · Every month · Paused",
  );
});
it("puts entries that need a look before the account's name", () => {
  const accounts = [{ id: "a1", name: "Harbor Checking" }];
  expect(ruleEndHint(rule(), accounts)).toBe("Harbor Checking");
  expect(ruleEndHint(rule({ needsAttention: 1 }), accounts)).toBe(
    "1 needs attention",
  );
  expect(ruleEndHint(rule({ needsAttention: 3 }), accounts)).toBe(
    "3 need attention",
  );
});
it("leaves the account's name empty until the accounts are known or when it is gone", () => {
  expect(ruleEndHint(rule(), undefined)).toBe("");
  expect(ruleEndHint(rule({ accountId: "gone" }), [])).toBe("");
});
