import {
  type Account,
  createTransferSchema,
  currencyDigits,
  feeFromBps,
  rateSchema,
  type Transfer,
} from "@ledgerline/shared";
import { z } from "zod";
import { cleanAmountText, decimalFromCents } from "../../../lib/money";
import { localToday } from "../../../lib/time";
import { parseFee } from "../fee";
import {
  amountMessage,
  amountMinor,
  isPositiveAmount,
  lastActiveAccount,
  transactionFormSchema,
} from "../form";

/** The transfer form's rules depend on the two accounts' currencies, so they are built per list. */
export function makeSchema(accounts: readonly Account[]) {
  const currencyOf = (id: string) =>
    accounts.find((row) => row.id === id)?.currency ?? "USD";
  return z
    .object({
      amount: z.string().trim().transform(cleanAmountText),
      // Only used when the two accounts have different currencies.
      receivedAmount: z.string().trim().transform(cleanAmountText),
      // A rate set by hand ("" means use the stored one); only for transfers between two
      // non-USD currencies.
      fxRate: z.string(),
      fromAccountId: createTransferSchema.shape.fromAccountId,
      toAccountId: createTransferSchema.shape.toAccountId,
      date: createTransferSchema.shape.date,
      time: transactionFormSchema.shape.time,
      note: transactionFormSchema.shape.note,
      // An optional bonus on the received amount (ADR 0023); only sent when switched on.
      bonusOn: z.boolean(),
      bonusAmount: z.string().trim().transform(cleanAmountText),
      bonusCategoryId: z.string(),
      // An optional fee on the sending account (ADR 0025): "2" is fixed, "2%" is a percentage.
      feeText: z.string(),
      feeCategoryId: z.string(),
    })
    .superRefine((row, ctx) => {
      const from = currencyOf(row.fromAccountId);
      const to = currencyOf(row.toAccountId);
      if (row.fromAccountId === row.toAccountId)
        ctx.addIssue({
          code: "custom",
          path: ["toAccountId"],
          message: "Choose two different accounts.",
        });
      if (!isPositiveAmount(row.amount, from))
        ctx.addIssue({
          code: "custom",
          path: ["amount"],
          message: amountMessage(from),
        });
      if (from !== to && !isPositiveAmount(row.receivedAmount, to))
        ctx.addIssue({
          code: "custom",
          path: ["receivedAmount"],
          message: `Enter how much arrives in ${to}.`,
        });
      if (row.bonusOn) {
        if (!isPositiveAmount(row.bonusAmount, to))
          ctx.addIssue({
            code: "custom",
            path: ["bonusAmount"],
            message: `Enter the bonus in ${to}, or switch it off.`,
          });
        if (!row.bonusCategoryId)
          ctx.addIssue({
            code: "custom",
            path: ["bonusCategoryId"],
            message: "Choose a category for the bonus.",
          });
      }
      const fee = parseFee(row.feeText, from);
      if (fee.kind === "invalid")
        ctx.addIssue({
          code: "custom",
          path: ["feeText"],
          message: fee.message,
        });
      else if (fee.kind !== "none") {
        const sent = amountMinor(row.amount, from);
        if (
          fee.kind === "percent" &&
          sent !== null &&
          feeFromBps(sent, fee.bps) < 1
        )
          ctx.addIssue({
            code: "custom",
            path: ["feeText"],
            message: "That fee comes to less than the smallest unit.",
          });
        if (!row.feeCategoryId)
          ctx.addIssue({
            code: "custom",
            path: ["feeCategoryId"],
            message: "Choose a category for the fee.",
          });
      }
      if (row.fxRate !== "" && !rateSchema.safeParse(row.fxRate).success)
        ctx.addIssue({
          code: "custom",
          path: ["fxRate"],
          message: "Enter a valid exchange rate.",
        });
    });
}
export type Values = z.infer<ReturnType<typeof makeSchema>>;
export function defaults(
  row: Transfer | undefined,
  accounts: readonly Account[],
  actorId: string,
  ledgerId: string,
): Values {
  const from = lastActiveAccount(actorId, ledgerId, accounts);
  return row
    ? {
        amount: decimalFromCents(
          row.amount.amount,
          currencyDigits(row.amount.currency),
        ),
        receivedAmount:
          row.receivedAmount.currency === row.amount.currency
            ? ""
            : decimalFromCents(
                row.receivedAmount.amount,
                currencyDigits(row.receivedAmount.currency),
              ),
        // The transfer keeps its saved rate unless one is set here.
        fxRate: "",
        fromAccountId: row.fromAccountId,
        toAccountId: row.toAccountId,
        date: row.date,
        time: row.time ?? "",
        note: row.note ?? "",
        bonusOn: false,
        bonusAmount: "",
        bonusCategoryId: "",
        feeText: "",
        feeCategoryId: "",
      }
    : {
        amount: "",
        receivedAmount: "",
        fxRate: "",
        fromAccountId: from,
        toAccountId:
          accounts.find((account) => !account.archivedAt && account.id !== from)
            ?.id ?? "",
        date: localToday(),
        time: "",
        note: "",
        bonusOn: false,
        bonusAmount: "",
        bonusCategoryId: "",
        feeText: "",
        feeCategoryId: "",
      };
}
