import { describe, expect, it } from "vitest";
import { hourlyResult, totalText } from "./hourly";

describe("hourly helper", () => {
  it("waits until both boxes are filled", () => {
    expect(hourlyResult("", "40", "USD")).toBeNull();
    expect(hourlyResult("3.5", " ", "USD")).toBeNull();
  });
  it("works out the total in minor units", () => {
    expect(hourlyResult("3.5", "$40", "USD")).toEqual({
      ok: true,
      total: 14000,
      hours: "3.5",
      rate: "$40.00",
    });
    expect(hourlyResult("2.25", "33.33", "USD")).toMatchObject({
      ok: true,
      total: 7499,
    });
  });
  it("follows the currency's decimals", () => {
    expect(hourlyResult("1.5", "5000", "JPY")).toMatchObject({
      ok: true,
      total: 7500,
    });
    expect(hourlyResult("1", "40.5", "JPY")).toMatchObject({ ok: false });
    expect(totalText(14000, "USD")).toBe("140.00");
    expect(totalText(7500, "JPY")).toBe("7500");
    expect(totalText(1500, "BHD")).toBe("1.500");
  });
  it("explains bad input", () => {
    expect(hourlyResult("abc", "40", "USD")).toMatchObject({ ok: false });
    expect(hourlyResult("1", "free", "USD")).toMatchObject({ ok: false });
    expect(hourlyResult("0.01", "0.01", "USD")).toMatchObject({ ok: false });
  });
});
