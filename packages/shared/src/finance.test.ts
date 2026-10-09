import { expect, it } from "vitest";
import {
  calendarDateSchema,
  expectedVersionSchema,
  idempotencyKeySchema,
  usdMoneySchema,
} from "./index";

it("accepts exact signed USD cents and rejects foreign currency, fractions and overflow", () => {
  expect(usdMoneySchema.parse({ amount: -29, currency: "USD" })).toEqual({
    amount: -29,
    currency: "USD",
  });
  for (const money of [
    { amount: 29, currency: "BDT" },
    { amount: 0.29, currency: "USD" },
    { amount: Number.MAX_SAFE_INTEGER + 1, currency: "USD" },
  ])
    expect(usdMoneySchema.safeParse(money).success).toBe(false);
});

it("validates calendar dates, bounded versions and opaque write keys", () => {
  expect(calendarDateSchema.parse("2028-02-29")).toBe("2028-02-29");
  expect(calendarDateSchema.safeParse("2026-02-29").success).toBe(false);
  expect(expectedVersionSchema.parse({ expectedVersion: 1 })).toEqual({
    expectedVersion: 1,
  });
  for (const expectedVersion of [0, -1, 1.5, 2_147_483_648])
    expect(expectedVersionSchema.safeParse({ expectedVersion }).success).toBe(
      false,
    );
  expect(idempotencyKeySchema.safeParse("action-key:123").success).toBe(true);
  for (const key of ["", "short", " padded-action-key ", "a".repeat(129)])
    expect(idempotencyKeySchema.safeParse(key).success).toBe(false);
});
