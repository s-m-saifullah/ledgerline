import { describe, expect, it } from "vitest";
import { newId } from "./index";
import {
  createTransactionSchema,
  transactionCursorSchema,
  transactionListQuerySchema,
  updateTransactionSchema,
} from "./transactions";

const input = {
  accountId: newId(),
  categoryId: newId(),
  kind: "expense",
  date: "2024-02-29",
  amount: { amount: -29, currency: "USD" },
};
describe("transaction contracts", () => {
  it("sets cleared/default empty text and preserves exact signed cents", () => {
    expect(createTransactionSchema.parse(input)).toMatchObject({
      status: "cleared",
      payee: null,
      note: null,
      amount: { amount: -29, currency: "USD" },
    });
    for (const amount of [Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER])
      expect(
        createTransactionSchema.parse({
          ...input,
          kind: amount < 0 ? "expense" : "income",
          amount: { amount, currency: "USD" },
        }).amount.amount,
      ).toBe(amount);
  });
  it("rejects zero, wrong signs, floats, foreign currency and invalid calendar dates", () => {
    for (const changes of [
      { amount: { amount: 0, currency: "USD" } },
      { kind: "income" },
      { amount: { amount: -1.1, currency: "USD" } },
      { amount: { amount: -29, currency: "BDT" } },
      { date: "2025-02-29" },
      { date: "0000-01-01" },
      { fxRate: 1 },
      { transferId: newId() },
    ])
      expect(
        createTransactionSchema.safeParse({ ...input, ...changes }).success,
      ).toBe(false);
  });
  it("accepts optional local minute precision and explicit clears, rejecting timestamps and invalid times", () => {
    for (const time of ["00:00", "12:34", "23:59", null]) {
      expect(createTransactionSchema.parse({ ...input, time }).time).toBe(time);
      expect(
        updateTransactionSchema.parse({ time, expectedVersion: 1 }).time,
      ).toBe(time);
    }
    for (const time of [
      "",
      "24:00",
      "12:60",
      "9:05",
      "12:34:56",
      "12:34Z",
      "12:34\n",
      "2026-10-07T12:34:00Z",
    ])
      expect(
        createTransactionSchema.safeParse({ ...input, time }).success,
      ).toBe(false);
  });
  it("requires a real partial change, preserves nullable clears and bounds versions", () => {
    expect(
      updateTransactionSchema.parse({ note: null, expectedVersion: 1 }),
    ).toEqual({ note: null, expectedVersion: 1 });
    for (const body of [
      { expectedVersion: 1 },
      { note: "Edit" },
      { note: "Edit", expectedVersion: 2147483648 },
    ])
      expect(updateTransactionSchema.safeParse(body).success).toBe(false);
  });
  it("validates self-contained date/UUID cursors and inclusive ordered date ranges", () => {
    expect(transactionCursorSchema.parse(`2024-02-29_${newId()}`)).toContain(
      "2024-02-29_",
    );
    expect(
      transactionCursorSchema.safeParse(`2025-02-29_${newId()}`).success,
    ).toBe(false);
    expect(
      transactionListQuerySchema.parse({ from: "2026-10-07", to: "2026-10-07" })
        .limit,
    ).toBe(50);
    expect(
      transactionListQuerySchema.safeParse({
        from: "2026-10-08",
        to: "2026-10-07",
      }).success,
    ).toBe(false);
  });
});

it("validates exact split sums at safe integer boundaries without intermediate floating-point arithmetic", () => {
  const body = {
    ...input,
    categoryId: null,
    amount: { amount: Number.MIN_SAFE_INTEGER, currency: "USD" },
    splits: [
      { categoryId: newId(), amount: { amount: -23, currency: "USD" } },
      {
        categoryId: newId(),
        amount: { amount: Number.MIN_SAFE_INTEGER + 23, currency: "USD" },
      },
    ],
  };
  expect(createTransactionSchema.parse(body).splits).toHaveLength(2);
  expect(
    createTransactionSchema.safeParse({
      ...body,
      amount: { amount: Number.MIN_SAFE_INTEGER + 1, currency: "USD" },
    }).success,
  ).toBe(false);
});
it("rejects invalid split directions, duplicate IDs and invalid category allocation shapes", () => {
  const id = newId();
  const lines = [
    { id, categoryId: newId(), amount: { amount: -10, currency: "USD" } },
    { id, categoryId: newId(), amount: { amount: -19, currency: "USD" } },
  ];
  expect(
    createTransactionSchema.safeParse({
      ...input,
      categoryId: null,
      splits: lines,
    }).success,
  ).toBe(false);
  expect(
    createTransactionSchema.safeParse({
      ...input,
      categoryId: null,
      splits: lines.slice(0, 1),
    }).success,
  ).toBe(false);
  expect(
    createTransactionSchema.safeParse({ ...input, categoryId: null }).success,
  ).toBe(false);
  expect(
    createTransactionSchema.safeParse({
      ...input,
      splits: lines.map(({ id: _, ...line }) => line),
    }).success,
  ).toBe(false);
});
