import {
  type CreateTransaction,
  type JsonValue,
  type Transaction,
  transactionListSchema,
  transactionSchema,
  transferSchema,
} from "@ledgerline/shared";
import { api, prepareFinancialWrite } from "../../lib/api";
import { transferLeg } from "./transfers";
export function prepareTransactionCreate(
  ledgerId: string,
  body: CreateTransaction,
) {
  const { time, ...fields } = body;
  const run = prepareFinancialWrite<unknown>(
    `/ledgers/${ledgerId}/transactions`,
    "POST",
    JSON.parse(
      JSON.stringify(time === undefined ? fields : { ...fields, time }),
    ) as JsonValue,
  );
  return async () => transactionSchema.parse(await run());
}
export function prepareTransactionUndo(
  ledgerId: string,
  transaction: Transaction,
  options: { deleteBonus?: boolean; deleteFee?: boolean } = {},
) {
  return prepareFinancialWrite<void>(
    `/ledgers/${ledgerId}/${transaction.transferId ? `transfers/${transaction.transferId}` : `transactions/${transaction.id}`}`,
    "DELETE",
    {
      expectedVersion: transaction.version,
      // A transfer's bonus entry goes with it only when asked (ADR 0023).
      ...(transaction.transferId && options.deleteBonus
        ? { deleteBonus: true }
        : {}),
      // Likewise its fee entry (ADR 0025).
      ...(transaction.transferId && options.deleteFee
        ? { deleteFee: true }
        : {}),
    },
  );
}
export async function getTransactions(
  ledgerId: string,
  filters: Record<string, string | boolean | undefined>,
  cursor: string | null,
  signal?: AbortSignal,
) {
  const query = new URLSearchParams({ limit: "50" });
  for (const [key, value] of Object.entries(filters))
    if (value) query.set(key, String(value));
  if (cursor) query.set("cursor", cursor);
  return transactionListSchema.parse(
    await api(`/ledgers/${ledgerId}/transactions?${query}`, {
      ...(signal ? { signal } : {}),
    }),
  );
}
export async function getTransaction(ledgerId: string, id: string) {
  return transactionSchema.parse(
    await api(`/ledgers/${ledgerId}/transactions/${id}`),
  );
}
export function prepareTransactionEdit(
  ledgerId: string,
  transaction: Transaction,
  body: CreateTransaction,
) {
  const { time, ...fields } = body;
  const run = prepareFinancialWrite<unknown>(
    `/ledgers/${ledgerId}/transactions/${transaction.id}`,
    "PATCH",
    JSON.parse(
      JSON.stringify({
        ...fields,
        ...(time === undefined ? {} : { time }),
        // An empty list clears the entry's tags.
        tagIds: fields.tagIds ?? [],
        // Explicit null converts a split back to a single-category entry.
        ...(transaction.isSplit && !body.splits ? { splits: null } : {}),
        expectedVersion: transaction.version,
      }),
    ) as JsonValue,
  );
  return async () => transactionSchema.parse(await run());
}
export function prepareTransactionRestore(
  ledgerId: string,
  transaction: Transaction,
) {
  const run = prepareFinancialWrite<unknown>(
    `/ledgers/${ledgerId}/${transaction.transferId ? `transfers/${transaction.transferId}` : `transactions/${transaction.id}`}/restore`,
    "POST",
    { expectedVersion: transaction.version + 1 },
  );
  return async () => {
    const row = await run();
    return transaction.transferId
      ? transferLeg(transferSchema.parse(row))
      : transactionSchema.parse(row);
  };
}
