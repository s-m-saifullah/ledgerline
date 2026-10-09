import { describe, expect, it } from "vitest";
import { accountBody, formDefaults } from "./form";
import { cleanAmountText, decimalFromCents, formatUsd } from "./money";

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
      direction: "positive",
      amount: "90071992547409.91",
    }).openingBalance.amount,
  ).toBe(Number.MAX_SAFE_INTEGER);
  expect(formDefaults().amount).toBe("0.00");
  for (const amount of ["-1", "1.234", "1e3", "", "90071992547409.92"])
    expect(() =>
      accountBody({
        name: "Bank",
        type: "bank",
        direction: "positive",
        amount,
      }),
    ).toThrow();
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
