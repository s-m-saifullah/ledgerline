import type { Account } from "@ledgerline/shared";
import { amountMinor } from "../../transactions/form";
import { positiveMoney, splitExtra } from "../form";
import {
  type ClientOperation,
  type Fields,
  isPaymentOperation,
  owedInCurrency,
} from "./types";

/** What the payment and receipt forms work out from the operation, the fields and the accounts. */
export function derivePayment(
  op: ClientOperation | null,
  values: Fields,
  accounts: Account[] | undefined,
) {
  const paymentMode = isPaymentOperation(op);
  // The currency a payment settles in, and what the chosen account uses (ADR 0022).
  const itemCurrency =
    op?.kind === "payment"
      ? op.service.amount.currency
      : op?.kind === "receipt"
        ? op.receipt
          ? op.receipt.amount.currency
          : values.receiptCurrency
        : "USD";
  const accountCurrency =
    accounts?.find((a) => a.id === values.accountId)?.currency ?? null;
  const needsReceived =
    paymentMode && !!accountCurrency && accountCurrency !== itemCurrency;
  const rateSettable =
    paymentMode &&
    !!accountCurrency &&
    accountCurrency !== "USD" &&
    itemCurrency !== "USD";
  const receiptCreate = op?.kind === "receipt" && !op.receipt ? op : null;
  // Money received above what is owed settles the balance and the rest is a tip (ADR 0027).
  const creatingPayment =
    (op?.kind === "payment" && !op.payment) || !!receiptCreate;
  const outstanding =
    op?.kind === "payment"
      ? op.service.outstanding.amount
      : receiptCreate
        ? owedInCurrency(receiptCreate.client, values.receiptCurrency)
        : 0;
  const extra =
    creatingPayment && !needsReceived
      ? splitExtra(values.amount, itemCurrency, outstanding)
      : null;
  const tipMinor = !creatingPayment
    ? 0
    : needsReceived
      ? accountCurrency
        ? (amountMinor(values.tipAmount, accountCurrency) ?? 0)
        : 0
      : (extra?.tip ?? 0);
  const previewCents = (() => {
    if (!receiptCreate) return null;
    if (extra) return extra.settle;
    try {
      return positiveMoney(values.amount, values.receiptCurrency).amount;
    } catch {
      return null;
    }
  })();
  return {
    paymentMode,
    itemCurrency,
    accountCurrency,
    needsReceived,
    rateSettable,
    receiptCreate,
    creatingPayment,
    outstanding,
    extra,
    tipMinor,
    previewCents,
  };
}
export type PaymentDerived = ReturnType<typeof derivePayment>;
