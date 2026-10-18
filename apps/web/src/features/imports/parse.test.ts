import { describe, expect, it } from "vitest";
import { parseAmount, parseDate, parseTime } from "./parse";

describe("parseDate", () => {
  it("reads each format and rejects dates that do not exist", () => {
    expect(parseDate("2026-10-05", "iso")).toBe("2026-10-05");
    expect(parseDate("2026/1/5", "iso")).toBe("2026-01-05");
    expect(parseDate("10/05/2026", "mdy")).toBe("2026-10-05");
    expect(parseDate("05/10/2026", "dmy")).toBe("2026-10-05");
    expect(parseDate("5.10.26", "dmy")).toBe("2026-10-05");
    expect(parseDate("2026-10-05T14:30:00", "iso")).toBe("2026-10-05");
    expect(parseDate("2026-10-05 14:30", "iso")).toBe("2026-10-05");
    expect(parseDate("2024-02-29", "iso")).toBe("2024-02-29");
    expect(parseDate("2026-02-29", "iso")).toBeNull();
    expect(parseDate("13/05/2026", "mdy")).toBeNull();
    expect(parseDate("2026-13-01", "iso")).toBeNull();
    expect(parseDate("10/05/2026", "iso")).toBeNull();
    expect(parseDate("2026-10-05", "mdy")).toBeNull();
    expect(parseDate("", "iso")).toBeNull();
    expect(parseDate("yesterday", "iso")).toBeNull();
    expect(parseDate("0000-01-01", "iso")).toBeNull();
  });
});

describe("parseTime", () => {
  it("returns HH:MM", () => {
    expect(parseTime("9:05")).toBe("09:05");
    expect(parseTime("21:30:45")).toBe("21:30");
    expect(parseTime("9:05 PM")).toBe("21:05");
    expect(parseTime("12:00 AM")).toBe("00:00");
    expect(parseTime("12:30 pm")).toBe("12:30");
    expect(parseTime("24:00")).toBeNull();
    expect(parseTime("13:00 PM")).toBeNull();
    expect(parseTime("9:75")).toBeNull();
    expect(parseTime("noon")).toBeNull();
  });
});

describe("parseAmount", () => {
  it("reads dot-decimal amounts as exact minor units", () => {
    expect(parseAmount("12.50", "dot", 2)).toBe(1250);
    expect(parseAmount("1,234.56", "dot", 2)).toBe(123456);
    expect(parseAmount("1234", "dot", 2)).toBe(123400);
    expect(parseAmount("0.05", "dot", 2)).toBe(5);
    expect(parseAmount(".5", "dot", 2)).toBe(50);
    expect(parseAmount("7.", "dot", 2)).toBe(700);
    expect(parseAmount("1,000,000.01", "dot", 2)).toBe(100000001);
    expect(parseAmount("19.99", "dot", 2)).toBe(1999);
  });
  it("reads comma-decimal amounts", () => {
    expect(parseAmount("1.234,56", "comma", 2)).toBe(123456);
    expect(parseAmount("12,5", "comma", 2)).toBe(1250);
    expect(parseAmount("1.000", "comma", 2)).toBe(100000);
  });
  it("reads signs, brackets, symbols and spaces", () => {
    expect(parseAmount("-12.50", "dot", 2)).toBe(-1250);
    expect(parseAmount("+12.50", "dot", 2)).toBe(1250);
    expect(parseAmount("12.50-", "dot", 2)).toBe(-1250);
    expect(parseAmount("(12.50)", "dot", 2)).toBe(-1250);
    expect(parseAmount("-$7", "dot", 2)).toBe(-700);
    expect(parseAmount("$ 1,234.50", "dot", 2)).toBe(123450);
    expect(parseAmount("USD 5.00", "dot", 2)).toBe(500);
    expect(parseAmount("€ 1.234,56", "comma", 2)).toBe(123456);
    expect(parseAmount("-0", "dot", 2)).toBe(0);
  });
  it("follows the currency's own digits", () => {
    expect(parseAmount("1,200", "dot", 0)).toBe(1200);
    expect(parseAmount("1.234", "dot", 3)).toBe(1234);
    expect(parseAmount("12.5", "dot", 0)).toBeNull();
    expect(parseAmount("12.345", "dot", 2)).toBeNull();
  });
  it("rejects what is not an amount", () => {
    for (const text of [
      "",
      "abc",
      "1,23",
      "12,34.56",
      "1.2.3",
      "--5",
      "1x2",
      "9007199254740993",
      "NaN",
    ])
      expect(parseAmount(text, "dot", 2), text).toBeNull();
  });
});
