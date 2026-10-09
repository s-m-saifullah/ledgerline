import { expect, it } from "vitest";
import {
  accountListQuerySchema,
  accountTypeSchema,
  createAccountSchema,
  updateAccountSchema,
} from "./accounts";

it("supports all six account types and signed USD opening balances", () => {
  for (const type of accountTypeSchema.options) {
    expect(
      createAccountSchema.parse({
        name: "  My account  ",
        type,
        openingBalance: { amount: -125050, currency: "USD" },
      }),
    ).toEqual({
      name: "My account",
      type,
      openingBalance: { amount: -125050, currency: "USD" },
    });
  }
});
it("rejects invalid account names, money, types and caller-controlled fields", () => {
  const valid = {
    name: "Bank",
    type: "bank",
    openingBalance: { amount: 0, currency: "USD" },
  };
  for (const body of [
    { ...valid, name: "  " },
    { ...valid, name: "a".repeat(101) },
    { ...valid, type: "crypto" },
    { ...valid, ledgerId: "another-ledger" },
    { ...valid, archivedAt: "2026-01-01" },
    { ...valid, openingBalance: { amount: 1.25, currency: "USD" } },
    { ...valid, openingBalance: { amount: 1, currency: "BDT" } },
  ])
    expect(createAccountSchema.safeParse(body).success).toBe(false);
});
it("requires an expected version and at least one real edit", () => {
  expect(
    updateAccountSchema.parse({ name: "Renamed", expectedVersion: 2 }),
  ).toEqual({ name: "Renamed", expectedVersion: 2 });
  for (const body of [
    { name: "Renamed" },
    { expectedVersion: 1 },
    { name: "Renamed", expectedVersion: 0 },
    { name: "Renamed", expectedVersion: 1, currency: "BDT" },
  ])
    expect(updateAccountSchema.safeParse(body).success).toBe(false);
});
it("defaults pagination and bounds the requested page size", () => {
  expect(accountListQuerySchema.parse({})).toEqual({
    limit: 50,
    status: "all",
  });
  expect(
    accountListQuerySchema.parse({ limit: "2", status: "active" }),
  ).toEqual({ limit: 2, status: "active" });
  for (const limit of ["0", "101", "1.5", "NaN"])
    expect(accountListQuerySchema.safeParse({ limit }).success).toBe(false);
});
