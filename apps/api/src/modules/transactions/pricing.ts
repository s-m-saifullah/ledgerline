import {
  convertMinor,
  deriveRate,
  formatRate,
  type Money,
  parseRate,
} from "@ledgerline/shared";
import { ApiProblem } from "../../lib/problem";
import { lookupRate } from "../currencies/service";
import { ledgerBaseCurrency } from "../ledgers/service";
import type { WriteContext } from "../writes/service";

export type EntryPricing = {
  /** Exact decimal text: base-currency value of one unit of the entry's currency. */
  fxRate: string;
  /** The entry's frozen value in the base currency, signed like the amount. */
  baseAmount: number;
};

/** Convert, turning an out-of-range result into a clear 409 instead of a crash. */
export function convertOrConflict(
  amount: number,
  rate: string,
  from: string,
  to: string,
) {
  try {
    return convertMinor(amount, rate, from, to);
  } catch (failure) {
    if (failure instanceof RangeError)
      throw new ApiProblem(
        409,
        "Conflict",
        "This amount is too large to convert exactly.",
        [{ field: "amount", message: "Use a smaller amount." }],
      );
    throw failure;
  }
}

/**
 * Price one entry (ADR 0022). The entry must be in its account's currency. In the base
 * currency the rate is exactly 1. Otherwise the rate is, in order: one set by hand, the
 * entry's saved rate when an edit keeps its currency, or the newest stored rate on or before
 * the date. With none of those the save is blocked and a rate must be entered.
 */
export async function priceEntry(
  context: WriteContext,
  input: {
    accountCurrency: string;
    amount: Money;
    date: string;
    manualRate?: string | undefined;
    keepRate?: string | undefined;
  },
): Promise<EntryPricing> {
  const { currency } = input.amount;
  if (currency !== input.accountCurrency)
    throw new ApiProblem(
      409,
      "Conflict",
      `This account uses ${input.accountCurrency}. Enter the amount in ${input.accountCurrency}.`,
      [
        {
          field: "amount.currency",
          message: `Use ${input.accountCurrency}, the account's currency.`,
        },
      ],
    );
  const base = await ledgerBaseCurrency(
    context.tx,
    context.actorId,
    context.ledgerId,
  );
  if (currency === base) {
    if (
      input.manualRate !== undefined &&
      formatRate(parseRate(input.manualRate)) !== "1"
    )
      throw new ApiProblem(
        409,
        "Conflict",
        `${base} is the base currency; its rate is always 1.`,
        [{ field: "fxRate", message: `A ${base} entry has a rate of 1.` }],
      );
    return { fxRate: "1", baseAmount: input.amount.amount };
  }
  const rate =
    input.manualRate ??
    input.keepRate ??
    (await lookupRate(context.tx, context.ledgerId, currency, base, input.date))
      .rate;
  return {
    fxRate: formatRate(parseRate(rate)),
    baseAmount: convertOrConflict(input.amount.amount, rate, currency, base),
  };
}

export type TransferPricing = {
  /** What leaves the sending account, as a positive number of its smallest units. */
  sent: number;
  /** What arrives in the receiving account, as a positive number of its smallest units. */
  received: number;
  /** The transfer's value in the base currency; the legs carry it with opposite signs. */
  baseAbs: number;
  fromCurrency: string;
  toCurrency: string;
  fromRate: string;
  toRate: string;
};

/**
 * Price a transfer (ADR 0022). Whichever account uses the base currency fixes the base value
 * exactly (no lookup). With neither in the base currency the value comes from the sent
 * currency's rate: one set by hand, the transfer's saved rate on an edit, or the newest stored
 * rate on or before the date. The legs always net to zero in the base currency, and the rate
 * stored on a leg is the one its amounts imply.
 */
export async function priceTransfer(
  context: WriteContext,
  input: {
    from: { currency: string };
    to: { currency: string };
    amount: Money;
    receivedAmount?: Money | undefined;
    date: string;
    manualRate?: string | undefined;
    keepRate?: string | undefined;
  },
): Promise<TransferPricing> {
  const fromCurrency = input.from.currency;
  const toCurrency = input.to.currency;
  if (input.amount.currency !== fromCurrency)
    throw new ApiProblem(
      409,
      "Conflict",
      `The sending account uses ${fromCurrency}. Enter the amount in ${fromCurrency}.`,
      [
        {
          field: "amount.currency",
          message: `Use ${fromCurrency}, the sending account's currency.`,
        },
      ],
    );
  let received = input.amount.amount;
  if (fromCurrency === toCurrency) {
    if (
      input.receivedAmount &&
      (input.receivedAmount.currency !== toCurrency ||
        input.receivedAmount.amount !== input.amount.amount)
    )
      throw new ApiProblem(
        409,
        "Conflict",
        "Both accounts use the same currency, so the same amount arrives.",
        [
          {
            field: "receivedAmount",
            message: "Leave this out, or use the same amount.",
          },
        ],
      );
  } else {
    if (!input.receivedAmount)
      throw new ApiProblem(
        409,
        "Conflict",
        `Enter how much arrives in ${toCurrency}.`,
        [
          {
            field: "receivedAmount",
            message: `Enter the amount received in ${toCurrency}.`,
          },
        ],
      );
    if (input.receivedAmount.currency !== toCurrency)
      throw new ApiProblem(
        409,
        "Conflict",
        `The receiving account uses ${toCurrency}.`,
        [
          {
            field: "receivedAmount.currency",
            message: `Use ${toCurrency}, the receiving account's currency.`,
          },
        ],
      );
    received = input.receivedAmount.amount;
  }
  const base = await ledgerBaseCurrency(
    context.tx,
    context.actorId,
    context.ledgerId,
  );
  if (
    input.manualRate !== undefined &&
    (fromCurrency === base || toCurrency === base)
  )
    throw new ApiProblem(
      409,
      "Conflict",
      `A rate is only needed when neither account uses ${base}.`,
      [
        {
          field: "fxRate",
          message: `Leave the rate out; ${base} sets the value.`,
        },
      ],
    );
  let baseAbs: number;
  let usedRate: string | undefined;
  if (fromCurrency === base) baseAbs = input.amount.amount;
  else if (toCurrency === base) baseAbs = received;
  else {
    usedRate = formatRate(
      parseRate(
        input.manualRate ??
          input.keepRate ??
          (
            await lookupRate(
              context.tx,
              context.ledgerId,
              fromCurrency,
              base,
              input.date,
            )
          ).rate,
      ),
    );
    baseAbs = convertOrConflict(
      input.amount.amount,
      usedRate,
      fromCurrency,
      base,
    );
  }
  const fromRate =
    fromCurrency === base
      ? "1"
      : (usedRate ??
        deriveRate(baseAbs, input.amount.amount, fromCurrency, base));
  const toRate =
    toCurrency === base
      ? "1"
      : fromCurrency === toCurrency && usedRate
        ? usedRate
        : deriveRate(baseAbs, received, toCurrency, base);
  return {
    sent: input.amount.amount,
    received,
    baseAbs,
    fromCurrency,
    toCurrency,
    fromRate,
    toRate,
  };
}
