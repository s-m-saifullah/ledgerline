import {
  type Account,
  createTransactionSchema,
  idSchema,
  parseMinorUnits,
  type Transaction,
  transactionKindSchema,
  transactionStatusSchema,
  transactionTimeSchema,
} from "@ledgerline/shared";
import { z } from "zod";
import { cleanAmountText, decimalFromCents } from "../accounts/money";
export function localToday(now = new Date()) {
  return `${String(now.getFullYear()).padStart(4, "0")}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}
export const transactionFormSchema = z
  .object({
    amount: z
      .string()
      .trim()
      .transform(cleanAmountText)
      .refine((value) => {
        if (!/^\d+(?:\.\d{1,2})?$/.test(value)) return false;
        try {
          return parseMinorUnits(value) > 0;
        } catch {
          return false;
        }
      }, "Enter a positive amount with up to two decimal places, within the supported range."),
    accountId: idSchema,
    categoryId: z.string(),
    splitEnabled: z.boolean().optional(),
    splits: z
      .array(
        z.object({
          id: idSchema.optional(),
          categoryId: z.string(),
          amount: z.string(),
          note: z.string().trim().max(2000),
        }),
      )
      .optional(),
    kind: transactionKindSchema,
    date: createTransactionSchema.shape.date,
    time: z.union([z.literal(""), transactionTimeSchema]),
    status: transactionStatusSchema,
    payee: z.string().trim().max(200),
    note: z.string().trim().max(2000),
  })
  .superRefine((values, ctx) => {
    if (!values.splitEnabled) {
      if (!idSchema.safeParse(values.categoryId).success)
        ctx.addIssue({
          code: "custom",
          path: ["categoryId"],
          message: "Choose a category.",
        });
      return;
    }
    const lines = values.splits ?? [];
    if (lines.length < 2 || lines.length > 50)
      ctx.addIssue({
        code: "custom",
        path: ["splits"],
        message: "Use 2–50 split lines.",
      });
    let total = 0n;
    for (const [index, line] of lines.entries()) {
      if (!idSchema.safeParse(line.categoryId).success)
        ctx.addIssue({
          code: "custom",
          path: ["splits", index, "categoryId"],
          message: "Choose a category.",
        });
      try {
        const text = cleanAmountText(line.amount);
        if (!/^\d+(?:\.\d{1,2})?$/.test(text) || parseMinorUnits(text) <= 0)
          throw new Error();
        total += BigInt(parseMinorUnits(text));
      } catch {
        ctx.addIssue({
          code: "custom",
          path: ["splits", index, "amount"],
          message: "Enter a positive exact USD amount.",
        });
      }
    }
    try {
      if (total !== BigInt(parseMinorUnits(values.amount)))
        ctx.addIssue({
          code: "custom",
          path: ["splits"],
          message: "Split lines must total the transaction exactly.",
        });
    } catch {
      /* Main amount reports its own error. */
    }
  });
export type TransactionFormValues = z.infer<typeof transactionFormSchema>;
export function transactionBody(values: TransactionFormValues) {
  const parsed = transactionFormSchema.parse(values);
  const cents = parseMinorUnits(parsed.amount);
  const { splitEnabled, splits, ...fields } = parsed;
  return createTransactionSchema.parse({
    ...fields,
    categoryId: splitEnabled ? null : parsed.categoryId,
    ...(splitEnabled
      ? {
          splits: (splits ?? []).map((line) => ({
            ...(line.id ? { id: line.id } : {}),
            categoryId: line.categoryId,
            amount: {
              amount:
                (parsed.kind === "expense" ? -1 : 1) *
                parseMinorUnits(cleanAmountText(line.amount)),
              currency: "USD",
            },
            note: line.note || null,
          })),
        }
      : {}),
    amount: {
      amount: parsed.kind === "expense" ? -cents : cents,
      currency: "USD",
    },
    time: parsed.time || null,
    payee: parsed.payee || null,
    note: parsed.note || null,
  });
}
const accountKey = (actorId: string, ledgerId: string) =>
  `ledgerline.last-account.${actorId}.${ledgerId}`;
export function lastActiveAccount(
  actorId: string,
  ledgerId: string,
  accounts: readonly Account[],
) {
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(accountKey(actorId, ledgerId));
  } catch {
    /* Storage may be disabled. */
  }
  return (
    accounts.find((row) => row.id === stored && !row.archivedAt)?.id ??
    accounts.find((row) => !row.archivedAt)?.id ??
    ""
  );
}
export function rememberAccount(actorId: string, ledgerId: string, id: string) {
  try {
    localStorage.setItem(accountKey(actorId, ledgerId), id);
  } catch {
    /* A preference failure must not turn a confirmed save into a retry. */
  }
}
export function transactionDefaults(
  actorId: string,
  ledgerId: string,
  accounts: readonly Account[],
): TransactionFormValues {
  return {
    amount: "",
    accountId: lastActiveAccount(actorId, ledgerId, accounts),
    categoryId: "",
    splitEnabled: false,
    splits: [],
    kind: "expense",
    date: localToday(),
    time: "",
    status: "cleared",
    payee: "",
    note: "",
  };
}

export function transactionEditDefaults(
  row: Transaction,
): TransactionFormValues {
  return {
    amount: decimalFromCents(row.amount.amount).replace(/^-/, ""),
    accountId: row.accountId,
    categoryId: row.categoryId ?? "",
    splitEnabled: row.isSplit,
    splits: row.splits.map((line) => ({
      id: line.id,
      categoryId: line.categoryId,
      amount: decimalFromCents(line.amount.amount).replace(/^-/, ""),
      note: line.note ?? "",
    })),
    kind: row.kind === "transfer" ? "expense" : row.kind,
    date: row.date,
    time: row.time ?? "",
    status: row.status,
    payee: row.payee ?? "",
    note: row.note ?? "",
  };
}
