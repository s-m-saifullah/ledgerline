import { describe, expect, it } from "vitest";
import {
  convertMinor,
  currencyDigits,
  formatRate,
  parseRate,
  rateFromNumber,
  rateSchema,
} from "./currency";

describe("currency digits", () => {
  it("reads the smallest unit from the platform", () => {
    expect(currencyDigits("USD")).toBe(2);
    expect(currencyDigits("EUR")).toBe(2);
    expect(currencyDigits("JPY")).toBe(0);
    expect(currencyDigits("BHD")).toBe(3);
  });
});

describe("exact rates", () => {
  it("parses and formats without floats", () => {
    expect(parseRate("1")).toBe(10_000_000_000n);
    expect(parseRate("0.0081967213")).toBe(81_967_213n);
    expect(formatRate(parseRate("122.5000000000"))).toBe("122.5");
    expect(formatRate(parseRate("1.0"))).toBe("1");
    expect(formatRate(parseRate("0.00812"))).toBe("0.00812");
  });
  it("validates shape and rejects zero", () => {
    for (const ok of ["1", "0.00812", "1234567890.1", "0.0000000001"])
      expect(rateSchema.safeParse(ok).success).toBe(true);
    for (const bad of [
      "0",
      "0.0",
      "-1",
      "1e-5",
      "1.12345678901",
      "12345678901",
      "",
      "abc",
      " 1",
    ])
      expect(rateSchema.safeParse(bad).success).toBe(false);
  });
  it("turns provider numbers into plain decimal text", () => {
    expect(rateFromNumber(1.1217)).toBe("1.1217");
    expect(rateFromNumber(0.00812)).toBe("0.00812");
    expect(rateFromNumber(0.0000001)).toBe("0.0000001");
    expect(rateFromNumber(0)).toBeNull();
    expect(rateFromNumber(-2)).toBeNull();
    expect(rateFromNumber(Number.NaN)).toBeNull();
    expect(rateFromNumber(1e-12)).toBeNull();
  });
});

describe("convertMinor", () => {
  it("converts between two-digit currencies", () => {
    // 1000.00 EUR at 1.1217 USD each = 1121.70 USD.
    expect(convertMinor(100_000, "1.1217", "EUR", "USD")).toBe(112_170);
    expect(convertMinor(-100_000, "1.1217", "EUR", "USD")).toBe(-112_170);
    expect(convertMinor(0, "1.1217", "EUR", "USD")).toBe(0);
  });
  it("accounts for different minor-unit digits", () => {
    // 1000 JPY (0 digits) at 0.0067 USD = 6.70 USD.
    expect(convertMinor(1000, "0.0067", "JPY", "USD")).toBe(670);
    // 10.00 USD at 149.25 JPY per USD... rate is JPY per USD = 149.25 => 1492.5 JPY, ties away.
    expect(convertMinor(1000, "149.25", "USD", "JPY")).toBe(1493);
    expect(convertMinor(-1000, "149.25", "USD", "JPY")).toBe(-1493);
    // 1.000 BHD (3 digits) at 2.65 USD = 2.65 USD.
    expect(convertMinor(1000, "2.65", "BHD", "USD")).toBe(265);
  });
  it("rounds half away from zero at exact ties", () => {
    expect(convertMinor(1, "0.5", "USD", "USD")).toBe(1);
    expect(convertMinor(-1, "0.5", "USD", "USD")).toBe(-1);
    expect(convertMinor(3, "0.5", "USD", "USD")).toBe(2);
    expect(convertMinor(1, "0.49", "USD", "USD")).toBe(0);
  });
  it("is exact for a base-currency rate of one", () => {
    for (const amount of [1, 99, 123_456_789, -5, 9_007_199_254_740_991])
      expect(convertMinor(amount, "1", "USD", "USD")).toBe(amount);
  });
  it("handles tiny rates and large amounts without float error", () => {
    // 1,000,000,000.00 BDT at 0.00812 = 8,120,000.00 USD.
    expect(convertMinor(100_000_000_000, "0.00812", "BDT", "USD")).toBe(
      812_000_000,
    );
    expect(convertMinor(1, "0.0000000001", "USD", "USD")).toBe(0);
  });
  it("rejects results outside the safe integer range and bad input", () => {
    expect(() =>
      convertMinor(9_007_199_254_740_991, "2", "USD", "USD"),
    ).toThrow(RangeError);
    expect(() => convertMinor(1.5, "1", "USD", "USD")).toThrow(RangeError);
    expect(() => convertMinor(1, "abc", "USD", "USD")).toThrow();
  });
});
