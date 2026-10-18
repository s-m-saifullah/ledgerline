import {
  type Account,
  createTransferSchema,
  currencyDigits,
  parseMinorUnits,
  type Transfer,
} from "@ledgerline/shared";
import { parseFee } from "../fee";
import type { Values } from "./schema";

/** The request body for a new or edited transfer, built from the form values. */
export function buildTransferBody(
  values: Values,
  accounts: readonly Account[],
  baseline: Transfer | undefined,
) {
  const currencyOf = (id: string) =>
    accounts.find((row) => row.id === id)?.currency ?? "USD";
  const from = currencyOf(values.fromAccountId);
  const to = currencyOf(values.toAccountId);
  const {
    receivedAmount,
    fxRate,
    bonusOn: withBonus,
    bonusAmount,
    bonusCategoryId,
    feeText: typedFee,
    feeCategoryId: feeCategory,
    ...fields
  } = values;
  const fee = parseFee(typedFee, from);
  return createTransferSchema.parse({
    ...fields,
    amount: {
      amount: parseMinorUnits(values.amount, currencyDigits(from)),
      currency: from,
    },
    ...(from !== to
      ? {
          receivedAmount: {
            amount: parseMinorUnits(receivedAmount, currencyDigits(to)),
            currency: to,
          },
        }
      : {}),
    // A hand-set rate only matters when neither account is in the base currency.
    ...(fxRate && from !== "USD" && to !== "USD" ? { fxRate } : {}),
    ...(withBonus && !baseline
      ? {
          bonus: {
            amount: {
              amount: parseMinorUnits(bonusAmount, currencyDigits(to)),
              currency: to,
            },
            categoryId: bonusCategoryId,
          },
        }
      : {}),
    ...(!baseline && fee.kind === "fixed"
      ? {
          fee: {
            amount: { amount: fee.minor, currency: from },
            categoryId: feeCategory,
          },
        }
      : {}),
    ...(!baseline && fee.kind === "percent"
      ? { fee: { basisPoints: fee.bps, categoryId: feeCategory } }
      : {}),
    time: values.time || null,
    note: values.note || null,
  });
}
