import { z } from "zod";
import {
  idSchema,
  ledgerParamsSchema,
  moneySchema,
  usdMoneySchema,
  versionSchema,
} from "./contracts";
import { rateSchema } from "./currency";
import { transactionDateSchema, transactionTimeSchema } from "./transactions";

const fields = {
  fromAccountId: idSchema,
  toAccountId: idSchema,
  // What leaves the sending account, in its currency.
  amount: moneySchema.refine((money) => money.amount > 0, {
    path: ["amount"],
    message: "Enter a positive transfer amount.",
  }),
  date: transactionDateSchema,
  time: transactionTimeSchema.nullable(),
  note: z.string().trim().max(2000).nullable(),
};
// Only needed when the accounts use different currencies; omitted means the same amount arrives.
const receivedAmount = moneySchema
  .refine((money) => money.amount > 0, {
    path: ["receivedAmount"],
    message: "Enter a positive received amount.",
  })
  .optional();
// Base-currency value of one unit of the sent currency, for transfers where neither account
// uses the base currency; omitted means the newest stored rate on or before the date.
const manualRate = rateSchema.optional();
const distinct = (body: { fromAccountId: string; toAccountId: string }) =>
  body.fromAccountId.toLowerCase() !== body.toAccountId.toLowerCase();
export const createTransferSchema = z
  .strictObject({
    ...fields,
    receivedAmount,
    fxRate: manualRate,
    time: fields.time.default(null),
    note: fields.note.default(null),
  })
  .refine(distinct, {
    path: ["toAccountId"],
    message: "Choose two different accounts.",
  });
export const updateTransferSchema = z
  .strictObject({
    ...fields,
    receivedAmount,
    fxRate: manualRate,
    expectedVersion: versionSchema,
  })
  .refine(distinct, {
    path: ["toAccountId"],
    message: "Choose two different accounts.",
  });
export const transferVersionSchema = z.strictObject({
  expectedVersion: versionSchema,
});
export const transferParamsSchema = ledgerParamsSchema.extend({
  transferId: idSchema,
});
export const transferSchema = z.object({
  ...fields,
  // What arrived, in the receiving account's currency (equals `amount` within one currency).
  receivedAmount: moneySchema,
  // The transfer's value in the base currency; both legs carry opposite, equal base amounts.
  baseAmount: usdMoneySchema,
  id: idSchema,
  ledgerId: idSchema,
  fromTransactionId: idSchema,
  toTransactionId: idSchema,
  version: versionSchema,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type Transfer = z.infer<typeof transferSchema>;
export type CreateTransfer = z.infer<typeof createTransferSchema>;
export type UpdateTransfer = z.infer<typeof updateTransferSchema>;
