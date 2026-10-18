import { describe, expect, it } from "vitest";
import { cashFlowReportQuerySchema, monthsEndingAt } from "./reports";

describe("monthsEndingAt", () => {
  it("lists months oldest first, across year boundaries", () => {
    expect(monthsEndingAt("2026-10", 1)).toEqual(["2026-10"]);
    expect(monthsEndingAt("2027-02", 4)).toEqual([
      "2026-11",
      "2026-12",
      "2027-01",
      "2027-02",
    ]);
    expect(monthsEndingAt("2026-12", 12)[0]).toBe("2026-01");
    expect(monthsEndingAt("2026-01", 2)).toEqual(["2025-12", "2026-01"]);
  });
});

describe("cash flow query", () => {
  it("defaults to twelve months and limits the range", () => {
    expect(cashFlowReportQuerySchema.parse({ to: "2026-10" }).months).toBe(12);
    expect(
      cashFlowReportQuerySchema.safeParse({ to: "2026-10", months: "25" })
        .success,
    ).toBe(false);
    expect(
      cashFlowReportQuerySchema.parse({ to: "2026-10", months: "24" }).months,
    ).toBe(24);
  });
});
