import { describe, expect, it } from "vitest";
import { accountBody, formDefaults } from "./form";
import {
  cleanAmountText,
  decimalFromCents,
  formatMoney,
  formatUsd,
} from "./money";

it("formats cents exactly, including negative cents and the safe-integer boundary", () => {
  expect(formatUsd(-29)).toBe("-$0.29");
  expect(formatUsd(125050)).toBe("$1,250.50");
  expect(formatUsd(Number.MAX_SAFE_INTEGER)).toBe("$90,071,992,547,409.91");
  expect(decimalFromCents(Number.MIN_SAFE_INTEGER)).toBe("-90071992547409.91");
});
it("converts the chosen debt direction without floating-point rounding", () => {
  expect(
    accountBody({
      name: "  My card  ",
      type: "card",
      currency: "USD",
      direction: "negative",
      amount: "12.29",
    }),
  ).toEqual({
    name: "My card",
    type: "card",
    openingBalance: { amount: -1229, currency: "USD" },
  });
  expect(
    accountBody({
      name: "Cash",
      type: "cash",
      currency: "USD",
      direction: "positive",
      amount: "90071992547409.91",
    }).openingBalance.amount,
  ).toBe(Number.MAX_SAFE_INTEGER);
  expect(formDefaults().amount).toBe("0.00");
  expect(formDefaults().currency).toBe("USD");
  for (const amount of ["-1", "1.234", "1e3", "", "90071992547409.92"])
    expect(() =>
      accountBody({
        name: "Bank",
        type: "bank",
        currency: "USD",
        direction: "positive",
        amount,
      }),
    ).toThrow();
});

it("reads the opening balance in the chosen currency's own minor units", () => {
  const body = (currency: string, amount: string) =>
    accountBody({
      name: "Abroad",
      type: "bank",
      currency,
      direction: "positive",
      amount,
    });
  expect(body("EUR", "12.34").openingBalance).toEqual({
    amount: 1234,
    currency: "EUR",
  });
  // Yen has no minor unit: whole amounts only.
  expect(body("JPY", "1500").openingBalance).toEqual({
    amount: 1500,
    currency: "JPY",
  });
  expect(() => body("JPY", "15.5")).toThrow();
  // Three digits for the dinar.
  expect(body("BHD", "1.234").openingBalance.amount).toBe(1234);
  expect(() => body("BHD", "1.2345")).toThrow();
  expect(() => body("EUR", "1.234")).toThrow();
  expect(formDefaults(undefined, "JPY")).toMatchObject({
    currency: "JPY",
    amount: "0",
  });
});

describe("cleanAmountText", () => {
  it("accepts what people type and leaves unclear input to fail validation", () => {
    expect(cleanAmountText("$1,200.50")).toBe("1200.50");
    expect(cleanAmountText(" $ 5 ")).toBe("5");
    expect(cleanAmountText(".50")).toBe("0.50");
    expect(cleanAmountText("5.")).toBe("5");
    expect(cleanAmountText("1,234,567")).toBe("1234567");
    expect(cleanAmountText("12.34")).toBe("12.34");
    // Not a recognizable thousands grouping, a European decimal comma or a sign: unchanged.
    for (const text of ["1,20", "1,2345", "12,5", "-5", "1.2.3", "five", ""])
      expect(cleanAmountText(text)).toBe(text.trim());
  });
});

describe("formatMoney", () => {
  it("formats each currency with its own minor units, exact to the last unit", () => {
    expect(formatMoney(125050, "USD")).toBe("$1,250.50");
    expect(formatMoney(-29, "EUR")).toBe("-€0.29");
    expect(formatMoney(1000, "JPY")).toBe("¥1,000");
    // Intl puts a no-break space after a currency code.
    expect(formatMoney(-2500, "BHD").replace(/\u00a0/g, " ")).toBe(
      "-BHD 2.500",
    );
    expect(formatMoney(Number.MAX_SAFE_INTEGER, "USD")).toBe(
      "$90,071,992,547,409.91",
    );
    expect(formatMoney(Number.MAX_SAFE_INTEGER, "JPY")).toBe(
      "¥9,007,199,254,740,991",
    );
  });
  it("keeps decimal text exact for any number of digits", () => {
    expect(decimalFromCents(125050)).toBe("1250.50");
    expect(decimalFromCents(-5, 2)).toBe("-0.05");
    expect(decimalFromCents(1000, 0)).toBe("1000");
    expect(decimalFromCents(2500, 3)).toBe("2.500");
  });
});
