import {
  type CreateTransfer,
  type Transfer,
  transferSchema,
} from "@ledgerline/shared";
import { api, prepareFinancialWrite } from "../../lib/api";
export async function getTransfer(ledgerId: string, id: string) {
  return transferSchema.parse(
    await api(`/ledgers/${ledgerId}/transfers/${id}`),
  );
}
export function prepareTransferSave(
  ledgerId: string,
  baseline: Transfer | undefined,
  body: CreateTransfer,
) {
  const run = prepareFinancialWrite<unknown>(
    `/ledgers/${ledgerId}/transfers${baseline ? `/${baseline.id}` : ""}`,
    baseline ? "PATCH" : "POST",
    baseline ? { ...body, expectedVersion: baseline.version } : body,
  );
  return async () => transferSchema.parse(await run());
}
// A transfer result can enter the same history/Undo workspace as an ordinary entry.
export function transferLeg(row: Transfer) {
  return {
    id: row.fromTransactionId,
    ledgerId: row.ledgerId,
    accountId: row.fromAccountId,
    categoryId: null,
    kind: "transfer" as const,
    date: row.date,
    time: row.time,
    amount: { amount: -row.amount.amount, currency: "USD" as const },
    baseAmount: { amount: -row.amount.amount, currency: "USD" as const },
    fxRate: 1 as const,
    payee: null,
    note: row.note,
    status: "cleared" as const,
    transferId: row.id,
    receivablePaymentId: null,
    receivableId: null,
    isSplit: false,
    splits: [],
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
