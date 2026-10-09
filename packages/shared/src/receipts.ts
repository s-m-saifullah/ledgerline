import { z } from "zod";
import {
  idSchema,
  ledgerParamsSchema,
  usdMoneySchema,
  versionSchema,
} from "./contracts";
import {
  contactParamsSchema,
  paymentSchema,
  positiveUsdSchema,
} from "./receivables";
import { transactionDateSchema, transactionTimeSchema } from "./transactions";

/** A receipt that would touch more services than this must be split by the payer. */
export const MAX_RECEIPT_ALLOCATIONS = 100;

/** Apply cents to open services in the order given (oldest first); exact integer math. */
export function allocateSerially(
  amount: number,
  open: readonly { id: string; outstanding: number }[],
) {
  let left = BigInt(amount);
  const applied: { id: string; applied: number; remainingAfter: number }[] = [];
  for (const service of open) {
    if (left <= 0n) break;
    const owed = BigInt(service.outstanding);
    if (owed <= 0n) continue;
    const take = left < owed ? left : owed;
    applied.push({
      id: service.id,
      applied: Number(take),
      remainingAfter: Number(owed - take),
    });
    left -= take;
  }
  return { allocations: applied, unapplied: Number(left) };
}

const allocationSchema = z.object({
  receivableId: idSchema,
  description: z.string(),
  serviceDate: transactionDateSchema,
  version: versionSchema,
  outstanding: usdMoneySchema,
  applied: usdMoneySchema,
  remainingAfter: usdMoneySchema,
});
export const receiptPreviewQuerySchema = z.object({
  amount: z.coerce.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
});
export const receiptPreviewSchema = z.object({
  contactId: idSchema,
  amount: usdMoneySchema,
  openTotal: usdMoneySchema,
  exceedsBalance: z.boolean(),
  tooManyServices: z.boolean(),
  allocations: z.array(allocationSchema),
});
const expectedAllocationSchema = z.strictObject({
  receivableId: idSchema,
  expectedVersion: versionSchema,
  applied: z.number().int().min(1),
});
const receiptFields = {
  accountId: idSchema,
  categoryId: idSchema,
  date: transactionDateSchema,
  time: transactionTimeSchema.nullable().default(null),
  note: z.string().trim().max(2000).nullable().default(null),
};
export const createReceiptSchema = z.strictObject({
  amount: positiveUsdSchema,
  ...receiptFields,
  expectedAllocations: z
    .array(expectedAllocationSchema)
    .min(1)
    .max(MAX_RECEIPT_ALLOCATIONS),
});
const expectedPaymentSchema = z.strictObject({
  paymentId: idSchema,
  expectedVersion: versionSchema,
  expectedReceivableVersion: versionSchema,
});
const expectedPaymentsSchema = z
  .array(expectedPaymentSchema)
  .min(1)
  .max(MAX_RECEIPT_ALLOCATIONS);
export const updateReceiptSchema = z.strictObject({
  ...receiptFields,
  expectedPayments: expectedPaymentsSchema,
});
export const receiptActionSchema = z.strictObject({
  expectedPayments: expectedPaymentsSchema,
});
export const receiptParamsSchema = ledgerParamsSchema.extend({
  receiptId: idSchema,
});
export const receiptContactParamsSchema = contactParamsSchema;
export const receiptSchema = z.object({
  id: idSchema,
  contactId: idSchema,
  amount: positiveUsdSchema,
  payments: z.array(paymentSchema).min(1),
});
export type ReceiptPreview = z.infer<typeof receiptPreviewSchema>;
export type CreateReceipt = z.infer<typeof createReceiptSchema>;
export type UpdateReceipt = z.infer<typeof updateReceiptSchema>;
export type ReceiptAction = z.infer<typeof receiptActionSchema>;
export type Receipt = z.infer<typeof receiptSchema>;
