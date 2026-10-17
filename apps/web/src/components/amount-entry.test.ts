import { describe, expect, it } from "vitest";
import { centsFirstValue, pastedValue, plainAmountValue } from "./amount-entry";

/** Type each character in turn, the way a keyboard reports it (the new text is the old plus one). */
function type(start: string, keys: string, digits = 2) {
  let value = start;
  for (const key of keys) value = centsFirstValue(value, value + key, digits);
  return value;
}
function backspace(start: string, times: number, digits = 2) {
  let value = start;
  for (let i = 0; i < times; i++)
    value = centsFirstValue(value, value.slice(0, -1), digits);
  return value;
}

describe("cents-first typing", () => {
  it("fills digits in from the right", () => {
    expect(type("", "1")).toBe("0.01");
    expect(type("", "12")).toBe("0.12");
    expect(type("", "123")).toBe("1.23");
    expect(type("", "123456")).toBe("1234.56");
  });
  it("starts with zeros and keeps them out of the way", () => {
    expect(type("", "0")).toBe("0.00");
    expect(type("", "005")).toBe("0.05");
    expect(type("", "0050")).toBe("0.50");
  });
  it("follows the currency's decimals", () => {
    expect(type("", "1500", 0)).toBe("1500");
    expect(type("", "1234", 3)).toBe("1.234");
  });
  it("drops the last digit on backspace and empties the box at zero", () => {
    expect(backspace("12.34", 1)).toBe("1.23");
    expect(backspace("12.34", 3)).toBe("0.01"); // 12.34 -> 1.23 -> 0.12 -> 0.01
    expect(backspace("0.05", 1)).toBe("");
    expect(backspace("12.34", 4)).toBe("");
    expect(centsFirstValue("5", "", 0)).toBe("");
  });
  it("appends to an existing value, even one saved without full decimals", () => {
    expect(type("12.50", "3")).toBe("125.03");
    expect(type("100", "2")).toBe("1000.02"); // 100.00 shifts left by one digit
    expect(type("7.5", "1")).toBe("75.01");
    expect(backspace("100", 1)).toBe("10.00");
  });
  it("ignores characters that are not digits", () => {
    expect(centsFirstValue("12.34", "12.34.", 2)).toBe("12.34");
    expect(centsFirstValue("12.34", "12.34x", 2)).toBe("12.34");
    expect(centsFirstValue("100", "100.", 2)).toBe("100.00");
    expect(centsFirstValue("", "-", 2)).toBe("");
  });
  it("starts over from the digits when the whole box is replaced", () => {
    expect(centsFirstValue("12.34", "5", 2)).toBe("0.05");
    expect(centsFirstValue("12.34", "99.5", 2)).toBe("9.95");
    expect(centsFirstValue("12.34", "", 2)).toBe("");
  });
  it("refuses a value beyond the safe money range", () => {
    const big = "90071992547409.91"; // 9007199254740991 minor units
    expect(centsFirstValue(big, `${big}0`, 2)).toBe(big);
    expect(type("", "9007199254740991")).toBe(big);
    expect(type("", "90071992547409910")).toBe(big);
  });
});

describe("pasting", () => {
  it("reads a pasted amount the ordinary way", () => {
    expect(pastedValue("12.50", 2)).toBe("12.50");
    expect(pastedValue("$1,200.5", 2)).toBe("1200.50");
    expect(pastedValue("1250", 2)).toBe("1250.00");
    expect(pastedValue("1250", 0)).toBe("1250");
  });
  it("ignores text that is not an amount", () => {
    expect(pastedValue("abc", 2)).toBeNull();
    expect(pastedValue("1.234", 2)).toBeNull();
    expect(pastedValue("-5", 2)).toBeNull();
  });
});

describe("the ordinary box", () => {
  it("keeps only digits and one decimal point", () => {
    expect(plainAmountValue("12a.5b", 2)).toBe("12.5");
    expect(plainAmountValue("$1,200.50", 2)).toBe("1200.50");
    expect(plainAmountValue("1.2.3", 2)).toBe("1.23");
    expect(plainAmountValue("-5", 2)).toBe("5");
    expect(plainAmountValue("abc", 2)).toBe("");
  });
  it("allows what is on the way to an amount", () => {
    expect(plainAmountValue(".", 2)).toBe(".");
    expect(plainAmountValue("12.", 2)).toBe("12.");
    expect(plainAmountValue(".5", 2)).toBe(".5");
  });
  it("limits the decimals to the currency's", () => {
    expect(plainAmountValue("12.345", 2)).toBe("12.34");
    expect(plainAmountValue("1.2345", 3)).toBe("1.234");
    expect(plainAmountValue("1500.5", 0)).toBe("1500");
    expect(plainAmountValue("1500.", 0)).toBe("1500");
  });
});
