import { z } from "zod";
import {
  calendarDateSchema,
  idSchema,
  ledgerParamsSchema,
  moneySchema,
  usdMoneySchema,
  versionSchema,
} from "./contracts";
import { rateSchema } from "./currency";

export const transactionKindSchema = z.enum(["expense", "income"]);
export const transactionStatusSchema = z.enum(["cleared", "pending"]);
export const transactionDateSchema = calendarDateSchema.refine(
  (date) => date >= "0001-01-01",
  "Use a calendar year from 0001 through 9999.",
);
export const transactionTimeSchema = z
  .string()
  .length(5)
  .regex(
    /^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/,
    "Use a local time in HH:mm format.",
  );
export const transactionSplitInputSchema = z.strictObject({
  id: idSchema.optional(),
  categoryId: idSchema,
  amount: moneySchema,
  note: z.string().trim().max(2000).nullable().default(null),
});
export const transactionSplitSchema = transactionSplitInputSchema.extend({
  id: idSchema,
  version: versionSchema,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
const splitsInputSchema = z.array(transactionSplitInputSchema).min(2).max(50);
const fields = {
  accountId: idSchema,
  categoryId: idSchema.nullable(),
  kind: transactionKindSchema,
  date: transactionDateSchema,
  time: transactionTimeSchema.nullable(),
  amount: moneySchema,
  status: transactionStatusSchema,
  payee: z.string().trim().max(200).nullable(),
  note: z.string().trim().max(2000).nullable(),
};
function validSign(body: { kind: string; amount: { amount: number } }) {
  return body.kind === "expense"
    ? body.amount.amount < 0
    : body.amount.amount > 0;
}
export const createTransactionSchema = z
  .strictObject({
    ...fields,
    // Omission preserves ordinary pre-upgrade receipt fingerprints.
    splits: splitsInputSchema.optional(),
    // Set the rate by hand: base-currency value of one unit of the entry's currency. Omit it
    // and the newest stored rate on or before the date is used.
    fxRate: rateSchema.optional(),
    // Keep omitted time absent from the write fingerprint so pre-upgrade retries match.
    time: fields.time.optional(),
    status: fields.status.default("cleared"),
    payee: fields.payee.default(null),
    note: fields.note.default(null),
  })
  .refine(validSign, {
    path: ["amount", "amount"],
    message:
      "Expenses must be negative and income positive; zero is not allowed.",
  })
  .superRefine((body, ctx) => {
    if (body.splits) {
      if (body.categoryId !== null)
        ctx.addIssue({
          code: "custom",
          path: ["categoryId"],
          message: "Split entries have no parent category.",
        });
      if (
        body.splits.some(
          (line) => !validSign({ kind: body.kind, amount: line.amount }),
        )
      )
        ctx.addIssue({
          code: "custom",
          path: ["splits"],
          message:
            "Every line must have the entry's direction and a nonzero amount.",
        });
      if (
        body.splits.some(
          (line) => line.amount.currency !== body.amount.currency,
        )
      )
        ctx.addIssue({
          code: "custom",
          path: ["splits"],
          message: "Every line must use the entry's currency.",
        });
      if (
        body.splits.reduce(
          (total, line) => total + BigInt(line.amount.amount),
          0n,
        ) !== BigInt(body.amount.amount)
      )
        ctx.addIssue({
          code: "custom",
          path: ["splits"],
          message: "Split lines must total the transaction exactly.",
        });
      const ids = body.splits.flatMap((line) =>
        line.id ? [line.id.toLowerCase()] : [],
      );
      if (new Set(ids).size !== ids.length)
        ctx.addIssue({
          code: "custom",
          path: ["splits"],
          message: "Each split ID may appear only once.",
        });
    } else if (body.categoryId === null)
      ctx.addIssue({
        code: "custom",
        path: ["categoryId"],
        message: "Choose a category or provide split lines.",
      });
  });
// Partial edits are validated against the complete saved entry in the service.
export const updateTransactionSchema = z
  .strictObject({
    splits: splitsInputSchema.nullable().optional(),
    fxRate: rateSchema.optional(),
    accountId: fields.accountId.optional(),
    categoryId: fields.categoryId.optional(),
    kind: fields.kind.optional(),
    date: fields.date.optional(),
    time: fields.time.optional(),
    amount: fields.amount.optional(),
    status: fields.status.optional(),
    payee: fields.payee.optional(),
    note: fields.note.optional(),
    expectedVersion: versionSchema,
  })
  .refine(
    (body) =>
      Object.entries(body).some(
        ([key, value]) => key !== "expectedVersion" && value !== undefined,
      ),
    "Provide a transaction field to update.",
  );
export const deleteTransactionSchema = z.strictObject({
  expectedVersion: versionSchema,
});
export const restoreTransactionSchema = z.strictObject({
  expectedVersion: versionSchema,
});
export type RestoreTransaction = z.infer<typeof restoreTransactionSchema>;
export const transactionParamsSchema = ledgerParamsSchema.extend({
  transactionId: idSchema,
});
// A self-contained date/UUID key remains usable when the cursor row is edited or deleted.
export const transactionCursorSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}_[0-9a-fA-F-]{36}$/)
  .refine((value) => {
    const [date, id] = value.split("_");
    return (
      transactionDateSchema.safeParse(date).success &&
      idSchema.safeParse(id).success
    );
  }, "Provide a valid transaction cursor.");
export const transactionListQuerySchema = z
  .object({
    cursor: transactionCursorSchema.optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    accountId: idSchema.optional(),
    categoryId: idSchema.optional(),
    from: transactionDateSchema.optional(),
    to: transactionDateSchema.optional(),
    text: z.string().trim().min(1).max(200).optional(),
    status: transactionStatusSchema.optional(),
    kind: z.enum(["expense", "income", "transfer"]).optional(),
  })
  .refine((body) => !body.from || !body.to || body.from <= body.to, {
    path: ["to"],
    message: "End date must be on or after start date.",
  });
export const transactionSchema = z.object({
  ...fields,
  categoryId: idSchema.nullable(),
  kind: z.enum(["expense", "income", "transfer"]),
  // Old idempotency receipts predate this optional field.
  time: fields.time.default(null),
  id: idSchema,
  ledgerId: idSchema,
  // Exact decimal text: base-currency value of one unit of this entry's currency.
  fxRate: rateSchema,
  baseAmount: usdMoneySchema,
  transferId: idSchema.nullable(),
  receivablePaymentId: idSchema.nullable().default(null),
  receivableId: idSchema.nullable().default(null),
  isSplit: z.boolean().default(false),
  splits: z.array(transactionSplitSchema).default([]),
  version: versionSchema,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export const transactionListSchema = z.object({
  items: z.array(transactionSchema),
  nextCursor: transactionCursorSchema.nullable(),
});
export type Transaction = z.infer<typeof transactionSchema>;
export type CreateTransaction = z.infer<typeof createTransactionSchema>;
export type UpdateTransaction = z.infer<typeof updateTransactionSchema>;
export type DeleteTransaction = z.infer<typeof deleteTransactionSchema>;
export type TransactionListQuery = z.infer<typeof transactionListQuerySchema>;

export type TransactionSplit = z.infer<typeof transactionSplitSchema>;
