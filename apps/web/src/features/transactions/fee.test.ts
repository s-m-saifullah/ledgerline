import type { Account } from "@ledgerline/shared";
import { expect, it } from "vitest";
import { defaultFeeText, feeMinor, parseFee } from "./fee";

it("reads a plain number as a fixed fee and a number with % as a percentage", () => {
  expect(parseFee("", "USD")).toEqual({ kind: "none" });
  expect(parseFee("  ", "USD")).toEqual({ kind: "none" });
  expect(parseFee("2", "USD")).toEqual({ kind: "fixed", minor: 200 });
  expect(parseFee("1.50", "USD")).toEqual({ kind: "fixed", minor: 150 });
  expect(parseFee("$1,200.5", "USD")).toEqual({ kind: "fixed", minor: 120050 });
  expect(parseFee("150", "JPY")).toEqual({ kind: "fixed", minor: 150 });
  expect(parseFee("2%", "USD")).toEqual({ kind: "percent", bps: 200 });
  expect(parseFee("1.5 %", "USD")).toEqual({ kind: "percent", bps: 150 });
  expect(parseFee(".5%", "USD")).toEqual({ kind: "percent", bps: 50 });
  expect(parseFee("100%", "USD")).toEqual({ kind: "percent", bps: 10000 });
});

it("explains what is wrong instead of guessing", () => {
  for (const text of [
    "0",
    "-2",
    "abc",
    "1.234",
    "2%%",
    "%",
    "0%",
    "101%",
    "1.234%",
  ])
    expect(parseFee(text, "USD").kind, text).toBe("invalid");
  expect(parseFee("1.5", "JPY").kind).toBe("invalid");
  const bad = parseFee("abc", "USD");
  expect(bad.kind === "invalid" && bad.message).toMatch(/2%/);
});

it("works a percentage out of the amount sent with exact rounding", () => {
  expect(feeMinor(parseFee("2", "USD"), null)).toBe(200);
  expect(feeMinor(parseFee("1.5%", "USD"), 10000)).toBe(150);
  expect(feeMinor(parseFee("1.5%", "USD"), 333)).toBe(5);
  expect(feeMinor(parseFee("1.5%", "USD"), null)).toBeNull();
  expect(feeMinor(parseFee("", "USD"), 10000)).toBeNull();
});

it("shows an account's remembered fee the way it would be typed", () => {
  const account = (defaultFee: Account["defaultFee"]) =>
    ({ defaultFee }) as Account;
  expect(defaultFeeText(undefined)).toBe("");
  expect(defaultFeeText(account(null))).toBe("");
  expect(defaultFeeText(account({ basisPoints: 150 }))).toBe("1.5%");
  expect(defaultFeeText(account({ basisPoints: 200 }))).toBe("2%");
  expect(
    defaultFeeText(account({ amount: { amount: 200, currency: "USD" } })),
  ).toBe("2.00");
  expect(
    defaultFeeText(account({ amount: { amount: 150, currency: "JPY" } })),
  ).toBe("150");
});
