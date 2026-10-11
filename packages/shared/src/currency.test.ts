import { describe, expect, it } from "vitest";
import {
  allocateBaseAmounts,
  convertMinor,
  currencyDigits,
  deriveRate,
  formatRate,
  invertRate,
  parseRate,
  rateFromInverse,
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

describe("reading a rate the other way round", () => {
  it("inverts exactly and trims trailing zeros", () => {
    expect(invertRate("0.00812")).toBe("123.1527");
    expect(invertRate("0.00812", 6)).toBe("123.152709");
    expect(invertRate("0.5")).toBe("2");
    expect(invertRate("2")).toBe("0.5");
    expect(invertRate("1")).toBe("1");
    expect(invertRate("1.1217")).toBe("0.891504");
    expect(invertRate("0.0000613497")).toBe("16300");
    expect(invertRate("0.0067", 4)).toBe("149.2537");
  });
  it("rejects a rate of zero", () => {
    expect(() => invertRate("0")).toThrow(RangeError);
  });
  it("turns a typed amount into the stored rate", () => {
    expect(rateFromInverse("122.5")).toBe("0.0081632653");
    expect(rateFromInverse("0.5")).toBe("2");
    expect(rateFromInverse("1")).toBe("1");
    expect(rateFromInverse(" 149.25 ")).toBe("0.0067001675");
  });
  it("refuses unusable input and amounts too large to store", () => {
    for (const bad of [
      "",
      "0",
      "0.0",
      "-5",
      "abc",
      "1e3",
      "1,5",
      "99999999999",
    ])
      expect(rateFromInverse(bad)).toBeNull();
    // The smallest storable rate is 0.0000000001; anything beyond it would round to zero.
    expect(rateFromInverse("10000000000")).toBe("0.0000000001");
    expect(rateFromInverse("100000000000")).toBeNull();
  });
  it("round-trips what people type without drifting", () => {
    for (const typed of [
      "122.5",
      "16300",
      "149.25",
      "3.6725",
      "0.9",
      "1",
      "4.5",
    ])
      expect(invertRate(rateFromInverse(typed) as string)).toBe(typed);
  });
});

describe("allocateBaseAmounts", () => {
  const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);
  it("returns the amounts themselves when the base equals the amount", () => {
    expect(allocateBaseAmounts(-3000, -3000, [-1000, -2000])).toEqual([
      -1000, -2000,
    ]);
    expect(allocateBaseAmounts(5000, 5000, [1, 4999])).toEqual([1, 4999]);
  });
  it("shares a converted amount so the lines add up exactly", () => {
    // 100 EUR in three lines at 1.1217 USD each: 112.17 USD does not split evenly.
    const lines = [-3333, -3333, -3334];
    const result = allocateBaseAmounts(-10000, -11217, lines);
    expect(sum(result)).toBe(-11217);
    // Floors are 3738, 3738, 3739; the two spare units go to the largest remainders.
    expect(result).toEqual([-3739, -3738, -3740]);
  });
  it("gives leftover units to the largest remainders, earliest first on ties", () => {
    expect(allocateBaseAmounts(3, 5, [1, 1, 1])).toEqual([2, 2, 1]);
    expect(allocateBaseAmounts(-3, -5, [-1, -1, -1])).toEqual([-2, -2, -1]);
    expect(allocateBaseAmounts(10, 1, [3, 3, 4])).toEqual([0, 0, 1]);
  });
  it("always adds up, for many shapes", () => {
    for (const parent of [2, 7, 100, 9999, 123_457])
      for (const base of [1, 3, 98, 10_000, 99_999]) {
        const lines = Array.from({ length: Math.min(parent, 5) }, (_, i) =>
          i === 0 ? parent - (Math.min(parent, 5) - 1) : 1,
        );
        const result = allocateBaseAmounts(parent, base, lines);
        expect(sum(result)).toBe(base);
        for (const part of result) expect(part).toBeGreaterThanOrEqual(0);
      }
  });
  it("rejects lines that do not match the parent", () => {
    expect(() => allocateBaseAmounts(-100, -100, [-60, -50])).toThrow(
      RangeError,
    );
    expect(() => allocateBaseAmounts(-100, -100, [-150, 50])).toThrow(
      RangeError,
    );
    expect(() => allocateBaseAmounts(0, 0, [])).toThrow(RangeError);
    expect(() => allocateBaseAmounts(100, 100, [100, 0])).toThrow(RangeError);
  });
});

describe("deriveRate", () => {
  it("recovers the rate behind a converted amount", () => {
    expect(deriveRate(11217, 10000, "EUR", "USD")).toBe("1.1217");
    expect(deriveRate(-11217, -10000, "EUR", "USD")).toBe("1.1217");
    expect(deriveRate(812, 100000, "BDT", "USD")).toBe("0.00812");
    expect(deriveRate(670, 1000, "JPY", "USD")).toBe("0.0067");
    expect(deriveRate(10000, 10000, "USD", "USD")).toBe("1");
  });
  it("rounds to the stored precision and is never zero", () => {
    expect(deriveRate(1, 3, "USD", "USD")).toBe("0.3333333333");
    expect(deriveRate(0, 100, "USD", "USD")).toBe("0.0000000001");
  });
  it("feeds back into the same base amount", () => {
    for (const [base, amount] of [
      [11217, 10000],
      [11200, 9999],
      [1234567, 1000000],
    ] as const)
      expect(
        convertMinor(
          amount,
          deriveRate(base, amount, "EUR", "USD"),
          "EUR",
          "USD",
        ),
      ).toBe(base);
  });
  it("rejects a zero source amount", () => {
    expect(() => deriveRate(100, 0, "EUR", "USD")).toThrow(RangeError);
  });
});
