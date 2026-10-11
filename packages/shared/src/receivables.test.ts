import { describe, expect, it } from "vitest";
import {
  createContactSchema,
  createPaymentSchema,
  createReceivableSchema,
  newId,
  paymentActionSchema,
  receivableSnapshotSchema,
  transactionSchema,
  updateReceivableSchema,
} from "./index";

const id = newId();
describe("receivable contracts", () => {
  it("accepts Unicode duplicate labels and rejects invalid contacts", () => {
    expect(createContactSchema.parse({ name: "  সাম  " }).name).toBe("সাম");
    expect(
      createContactSchema.safeParse({ name: "", email: "bad" }).success,
    ).toBe(false);
  });
  it("requires exact positive safe USD service money and calendar dates", () => {
    for (const amount of [0, -1, 1.1, Number.MAX_SAFE_INTEGER + 1])
      expect(
        createReceivableSchema.safeParse({
          contactId: id,
          description: "Work",
          serviceDate: "2026-10-07",
          amount: { amount, currency: "USD" },
        }).success,
      ).toBe(false);
    expect(
      createReceivableSchema.parse({
        contactId: id,
        description: "Work",
        serviceDate: "2026-10-07",
        amount: { amount: Number.MAX_SAFE_INTEGER, currency: "USD" },
      }).dueDate,
    ).toBeNull();
  });
  it("keeps service time optional in writes and defaults it to null in older history", () => {
    const base = {
      contactId: id,
      description: "Work",
      serviceDate: "2026-10-07",
      amount: { amount: 100, currency: "USD" },
    };
    // Omitted stays absent so older retries keep their fingerprint.
    expect("serviceTime" in createReceivableSchema.parse(base)).toBe(false);
    expect(
      createReceivableSchema.parse({ ...base, serviceTime: "09:05" })
        .serviceTime,
    ).toBe("09:05");
    expect(
      createReceivableSchema.parse({ ...base, serviceTime: null }).serviceTime,
    ).toBeNull();
    expect(
      updateReceivableSchema.safeParse({
        ...base,
        dueDate: null,
        expectedVersion: 1,
      }).success,
    ).toBe(true);
    for (const bad of ["24:00", "9:5", "12:60", ""])
      expect(
        createReceivableSchema.safeParse({ ...base, serviceTime: bad }).success,
      ).toBe(false);
    const legacy = {
      ...base,
      dueDate: null,
      createdAt: "2026-10-07T00:00:00.000Z",
      updatedAt: "2026-10-07T00:00:00.000Z",
      id,
      ledgerId: id,
      version: 1,
      received: { amount: 0, currency: "USD" },
      remaining: { amount: 100, currency: "USD" },
      outstanding: { amount: 100, currency: "USD" },
      status: "unpaid",
      writtenOffAt: null,
      writtenOffAmount: null,
      writeOffReason: null,
      deletedAt: null,
    };
    expect(receivableSnapshotSchema.parse(legacy).serviceTime).toBeNull();
  });
  it("rejects pending/link shortcuts and requires both versions for payment actions", () => {
    const body = {
      amount: { amount: 1, currency: "USD" },
      accountId: id,
      categoryId: id,
      date: "2026-10-07",
      expectedReceivableVersion: 1,
    };
    expect(createPaymentSchema.parse(body).time).toBeNull();
    expect(
      createPaymentSchema.safeParse({ ...body, status: "pending" }).success,
    ).toBe(false);
    expect(
      createPaymentSchema.safeParse({ ...body, transactionId: id }).success,
    ).toBe(false);
    expect(paymentActionSchema.safeParse({ expectedVersion: 1 }).success).toBe(
      false,
    );
  });
  it("normalizes linkage on old transaction receipts", () => {
    const row = {
      id,
      ledgerId: id,
      accountId: id,
      categoryId: id,
      kind: "income",
      date: "2026-10-07",
      amount: { amount: 1, currency: "USD" },
      baseAmount: { amount: 1, currency: "USD" },
      fxRate: "1",
      status: "cleared",
      payee: null,
      note: null,
      transferId: null,
      version: 1,
      createdAt: "2026-10-07T00:00:00.000Z",
      updatedAt: "2026-10-07T00:00:00.000Z",
    };
    expect(transactionSchema.parse(row).receivableId).toBeNull();
    expect(transactionSchema.parse(row).receivablePaymentId).toBeNull();
  });
});
