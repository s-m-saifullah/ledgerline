import { z } from "zod";
import {
  idSchema,
  ledgerParamsSchema,
  usdMoneySchema,
  versionSchema,
} from "./contracts";
import { transactionDateSchema, transactionTimeSchema } from "./transactions";

const fields = {
  fromAccountId: idSchema,
  toAccountId: idSchema,
  amount: usdMoneySchema.refine((money) => money.amount > 0, {
    path: ["amount"],
    message: "Enter a positive transfer amount.",
  }),
  date: transactionDateSchema,
  time: transactionTimeSchema.nullable(),
  note: z.string().trim().max(2000).nullable(),
};
const distinct = (body: { fromAccountId: string; toAccountId: string }) =>
  body.fromAccountId.toLowerCase() !== body.toAccountId.toLowerCase();
export const createTransferSchema = z
  .strictObject({
    ...fields,
    time: fields.time.default(null),
    note: fields.note.default(null),
  })
  .refine(distinct, {
    path: ["toAccountId"],
    message: "Choose two different accounts.",
  });
export const updateTransferSchema = z
  .strictObject({ ...fields, expectedVersion: versionSchema })
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
