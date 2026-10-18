import {
  type Contact,
  currencyDigits,
  type Receipt,
  type Receivable,
  type ReceivablePayment,
} from "@ledgerline/shared";
import { decimalFromCents } from "../../../lib/money";
import { localToday } from "../../../lib/time";
export type ClientOperation =
  | { kind: "contact"; client?: Contact }
  | { kind: "service"; client: Contact; service?: Receivable }
  | {
      kind: "payment";
      service: Receivable;
      client?: Contact;
      payment?: ReceivablePayment;
    }
  | { kind: "receipt"; client: Contact; receipt?: Receipt; receiptId?: string }
  | {
      kind: "action";
      action:
        | "archive"
        | "unarchive"
        | "deleteContact"
        | "deleteService"
        | "restoreService"
        | "writeOff"
        | "reopen"
        | "deletePayment"
        | "restorePayment"
        | "deleteReceipt"
        | "restoreReceipt";
      receipt?: Receipt;
      receiptId?: string;
      client?: Contact;
      reason?: string | null;
      service?: Receivable;
      payment?: ReceivablePayment;
    };
export type Fields = {
  name: string;
  phone: string;
  email: string;
  note: string;
  description: string;
  serviceDate: string;
  serviceTime: string;
  dueDate: string;
  amount: string;
  // Money owed in other currencies (ADR 0022).
  currency: string;
  receiptCurrency: string;
  receivedAmount: string;
  // Extra money received on top of what is owed (ADR 0027).
  tipAmount: string;
  tipCategoryId: string;
  fxRate: string;
  accountId: string;
  categoryId: string;
  date: string;
  time: string;
  contactId: string;
  reason: string;
};
export const empty = (): Fields => ({
  name: "",
  phone: "",
  email: "",
  note: "",
  description: "",
  serviceDate: localToday(),
  serviceTime: "",
  dueDate: "",
  amount: "",
  currency: "USD",
  receiptCurrency: "USD",
  receivedAmount: "",
  tipAmount: "",
  tipCategoryId: "",
  fxRate: "",
  accountId: "",
  categoryId: "",
  date: localToday(),
  time: "",
  contactId: "",
  reason: "",
});
export function fieldsFor(op: ClientOperation): Fields {
  const f = empty();
  if (op.kind === "contact" && op.client)
    Object.assign(f, {
      name: op.client.name,
      phone: op.client.phone ?? "",
      email: op.client.email ?? "",
      note: op.client.note ?? "",
    });
  if (op.kind === "service")
    Object.assign(f, {
      contactId: op.client.id,
      ...(op.service
        ? {
            description: op.service.description,
            serviceDate: op.service.serviceDate,
            serviceTime: op.service.serviceTime ?? "",
            dueDate: op.service.dueDate ?? "",
            currency: op.service.amount.currency,
            amount: decimalFromCents(
              op.service.amount.amount,
              currencyDigits(op.service.amount.currency),
            ),
          }
        : {}),
    });
  if (op.kind === "payment")
    Object.assign(f, {
      amount: decimalFromCents(
        op.payment?.amount.amount ?? op.service.outstanding.amount,
        currencyDigits(op.service.amount.currency),
      ),
      ...(op.payment
        ? {
            // What arrived, when the account's currency is not the service's.
            receivedAmount:
              op.payment.transaction.amount.currency !==
              op.service.amount.currency
                ? decimalFromCents(
                    op.payment.transaction.amount.amount,
                    currencyDigits(op.payment.transaction.amount.currency),
                  )
                : "",
            accountId: op.payment.transaction.accountId,
            categoryId: op.payment.transaction.categoryId ?? "",
            date: op.payment.transaction.date,
            time: op.payment.transaction.time ?? "",
            note: op.payment.transaction.note ?? "",
          }
        : {}),
    });
  if (op.kind === "receipt") {
    const first = op.receipt?.payments[0]?.transaction;
    const owed = op.client.openBalances;
    Object.assign(f, {
      receiptCurrency: op.receipt
        ? op.receipt.amount.currency
        : ((owed.find((b) => b.currency === "USD") ?? owed[0])?.currency ??
          "USD"),
      ...(op.receipt
        ? {
            amount: decimalFromCents(
              op.receipt.amount.amount,
              currencyDigits(op.receipt.amount.currency),
            ),
            receivedAmount:
              first && first.amount.currency !== op.receipt.amount.currency
                ? decimalFromCents(
                    op.receipt.payments.reduce(
                      (sum, p) => sum + p.transaction.amount.amount,
                      0,
                    ),
                    currencyDigits(first.amount.currency),
                  )
                : "",
          }
        : {}),
      ...(first
        ? {
            accountId: first.accountId,
            categoryId: first.categoryId ?? "",
            date: first.date,
            time: first.time ?? "",
            note: first.note ?? "",
          }
        : {}),
    });
  }
  if (op.kind === "action")
    f.reason = op.reason ?? op.service?.writeOffReason ?? "";
  return f;
}
export const names = {
  archive: "Archive client",
  unarchive: "Unarchive client",
  deleteContact: "Delete client",
  deleteService: "Delete service",
  restoreService: "Undo service deletion",
  writeOff: "Write off remainder",
  reopen: "Reopen service",
  deletePayment: "Delete payment",
  restorePayment: "Undo payment deletion",
  deleteReceipt: "Delete receipt",
  restoreReceipt: "Undo receipt deletion",
};
/** Concurrency tokens a receipt change must echo back, optionally after a version bump. */
export function expectedPayments(receipt: Receipt, bump = 0) {
  return receipt.payments.map((p) => ({
    paymentId: p.id,
    expectedVersion: p.version + bump,
    expectedReceivableVersion: p.receivable.version + bump,
  }));
}
export function bumped(receipt: Receipt): Receipt {
  return {
    ...receipt,
    payments: receipt.payments.map((p) => ({
      ...p,
      version: p.version + 1,
      receivable: { ...p.receivable, version: p.receivable.version + 1 },
    })),
  };
}
export const isPaymentOperation = (op: ClientOperation | null) =>
  op?.kind === "payment" || op?.kind === "receipt";

/** What a client owes in one currency (0 when nothing is open in it). */
export function owedInCurrency(client: Contact, currency: string) {
  return client.openBalances.find((b) => b.currency === currency)?.amount ?? 0;
}
