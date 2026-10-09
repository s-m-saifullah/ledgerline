import { describe, expect, it } from "vitest";
import {
  addMoney,
  idSchema,
  isoDate,
  moneySchema,
  newId,
  parseMinorUnits,
} from "./index";

describe("money", () => {
  it("preserves cents, signs, and different currency precision", () => {
    expect(parseMinorUnits("0.29")).toBe(29);
    expect(parseMinorUnits("-1250.50")).toBe(-125050);
    expect(parseMinorUnits("15000")).toBe(1500000);
    expect(parseMinorUnits("100", 0)).toBe(100);
    expect(parseMinorUnits("1.001", 3)).toBe(1001);
    expect(parseMinorUnits("90071992547409.91")).toBe(Number.MAX_SAFE_INTEGER);
  });
  it("rejects rounding, overflow, exponent notation, and invalid precision", () => {
    for (const value of [
      "1.001",
      "90071992547409.92",
      "NaN",
      "1e2",
      "1,000",
      "",
    ])
      expect(() => parseMinorUnits(value)).toThrow();
    expect(() => parseMinorUnits("1", -1)).toThrow();
    expect(() => moneySchema.parse({ amount: 1.1, currency: "USD" })).toThrow();
    expect(() => moneySchema.parse({ amount: 1, currency: "XXX" })).toThrow();
  });
  it("prevents mixed currencies and unsafe sums", () => {
    expect(
      addMoney(
        { amount: 29, currency: "USD" },
        { amount: 71, currency: "USD" },
      ),
    ).toEqual({ amount: 100, currency: "USD" });
    expect(() =>
      addMoney({ amount: 1, currency: "USD" }, { amount: 1, currency: "BDT" }),
    ).toThrow();
    expect(() =>
      addMoney(
        { amount: Number.MAX_SAFE_INTEGER, currency: "USD" },
        { amount: 1, currency: "USD" },
      ),
    ).toThrow();
  });
});
it("generates UUIDv7 and validates real calendar dates", () => {
  expect(idSchema.parse(newId())).toBeTruthy();
  expect(isoDate("2026-10-06")).toBe("2026-10-06");
  expect(() => isoDate("2026-02-30")).toThrow();
});
