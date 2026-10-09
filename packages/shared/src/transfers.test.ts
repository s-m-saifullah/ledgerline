import { expect, it } from "vitest";
import { newId } from "./index";
import { createTransferSchema, updateTransferSchema } from "./transfers";

const body = {
  fromAccountId: newId(),
  toAccountId: newId(),
  date: "2026-10-07",
  amount: { amount: 29, currency: "USD" },
};
it("accepts exact positive USD cents, optional local time and distinct normalized accounts", () => {
  expect(createTransferSchema.parse(body)).toMatchObject({
    time: null,
    note: null,
  });
  expect(createTransferSchema.parse({ ...body, time: "09:05" }).time).toBe(
    "09:05",
  );
  for (const amount of [0, -1, 0.1, Number.MAX_SAFE_INTEGER + 1])
    expect(
      createTransferSchema.safeParse({
        ...body,
        amount: { amount, currency: "USD" },
      }).success,
    ).toBe(false);
  expect(
    createTransferSchema.safeParse({
      ...body,
      toAccountId: body.fromAccountId.toUpperCase(),
    }).success,
  ).toBe(false);
});
it("requires complete versioned corrections and rejects transaction-only fields", () => {
  expect(
    updateTransferSchema.safeParse({
      ...body,
      time: null,
      note: null,
      expectedVersion: 1,
    }).success,
  ).toBe(true);
  for (const fields of [
    { expectedVersion: 1 },
    { ...body, status: "pending" },
    { ...body, categoryId: newId() },
    { ...body, amount: { amount: 1, currency: "BDT" } },
  ])
    expect(updateTransferSchema.safeParse(fields).success).toBe(false);
});
