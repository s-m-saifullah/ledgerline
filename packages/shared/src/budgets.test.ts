import { describe, expect, it } from "vitest";
import {
  computeBudgetPositions,
  copyBudgetsSchema,
  previousMonth,
  setBudgetSchema,
} from "./budgets";
import { newId } from "./index";

describe("budget rollover", () => {
  it("steps back across a year boundary", () => {
    expect(previousMonth("2026-01")).toBe("2025-12");
    expect(previousMonth("2026-10")).toBe("2026-09");
  });
  it("carries leftovers forward, overspending as a negative", () => {
    const rows = [
      { month: "2026-08", amount: 10000, rollover: true },
      { month: "2026-09", amount: 10000, rollover: true },
      { month: "2026-10", amount: 10000, rollover: true },
    ];
    const spent = new Map([
      ["2026-08", 4000],
      ["2026-09", 16000],
      ["2026-10", 1000],
    ]);
    const result = computeBudgetPositions(rows, spent);
    expect(result.get("2026-08")).toEqual({
      carriedIn: 0,
      spent: 4000,
      left: 6000,
    });
    expect(result.get("2026-09")?.carriedIn).toBe(6000);
    expect(result.get("2026-09")?.left).toBe(0);
    expect(result.get("2026-10")?.carriedIn).toBe(0);
    expect(result.get("2026-10")?.left).toBe(9000);
  });
  it("carries a negative balance", () => {
    const rows = [
      { month: "2026-09", amount: 5000, rollover: true },
      { month: "2026-10", amount: 5000, rollover: true },
    ];
    const result = computeBudgetPositions(rows, new Map([["2026-09", 8000]]));
    expect(result.get("2026-10")?.carriedIn).toBe(-3000);
    expect(result.get("2026-10")?.left).toBe(2000);
  });
  it("does not carry without the flag or across a gap", () => {
    const rows = [
      { month: "2026-07", amount: 5000, rollover: true },
      { month: "2026-09", amount: 5000, rollover: true },
      { month: "2026-10", amount: 5000, rollover: false },
    ];
    const result = computeBudgetPositions(rows, new Map());
    expect(result.get("2026-09")?.carriedIn).toBe(0);
    expect(result.get("2026-10")?.carriedIn).toBe(0);
  });
});

describe("budget requests", () => {
  const body = {
    categoryId: newId(),
    month: "2026-10",
    amount: { amount: 12000, currency: "USD" },
    rollover: false,
  };
  it("accepts a budget and rejects negatives and other currencies", () => {
    expect(setBudgetSchema.safeParse(body).success).toBe(true);
    expect(
      setBudgetSchema.safeParse({
        ...body,
        amount: { amount: -1, currency: "USD" },
      }).success,
    ).toBe(false);
    expect(
      setBudgetSchema.safeParse({
        ...body,
        amount: { amount: 100, currency: "EUR" },
      }).success,
    ).toBe(false);
    expect(
      setBudgetSchema.safeParse({ ...body, month: "2026-13" }).success,
    ).toBe(false);
  });
  it("needs two different months to copy", () => {
    expect(
      copyBudgetsSchema.safeParse({ fromMonth: "2026-09", toMonth: "2026-09" })
        .success,
    ).toBe(false);
    expect(
      copyBudgetsSchema.safeParse({ fromMonth: "2026-09", toMonth: "2026-10" })
        .success,
    ).toBe(true);
  });
});
