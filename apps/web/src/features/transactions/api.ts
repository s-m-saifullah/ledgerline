import {
  type Account,
  type CreateTransaction,
  type JsonValue,
  type Transaction,
  transactionListSchema,
  transactionSchema,
  transferSchema,
} from "@ledgerline/shared";
import { api, prepareFinancialWrite } from "../../lib/api";
import { getAccounts } from "../accounts/api";
import { transferLeg } from "./transfers";
export async function getActiveAccounts(
  ledgerId: string,
  signal?: AbortSignal,
) {
  const items: Account[] = [],
    visited = new Set<string>();
  let cursor: string | null = null;
  do {
    const page = await getAccounts(ledgerId, "active", cursor, signal);
    items.push(...page.items);
    cursor = page.nextCursor;
    if (cursor && visited.has(cursor))
      throw new Error("Account pagination did not advance");
    if (cursor) visited.add(cursor);
  } while (cursor);
  return items;
}
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
) {
  return prepareFinancialWrite<void>(
    `/ledgers/${ledgerId}/${transaction.transferId ? `transfers/${transaction.transferId}` : `transactions/${transaction.id}`}`,
    "DELETE",
    { expectedVersion: transaction.version },
  );
}

export async function getAllAccounts(ledgerId: string, signal?: AbortSignal) {
  const items: Account[] = [],
    visited = new Set<string>();
  let cursor: string | null = null;
  do {
    const page = await getAccounts(ledgerId, "all", cursor, signal);
    items.push(...page.items);
    cursor = page.nextCursor;
    if (cursor && visited.has(cursor))
      throw new Error("Account pagination did not advance");
    if (cursor) visited.add(cursor);
  } while (cursor);
  return items;
}
export async function getTransactions(
  ledgerId: string,
  filters: Record<string, string | undefined>,
  cursor: string | null,
  signal?: AbortSignal,
) {
  const query = new URLSearchParams({ limit: "50" });
  for (const [key, value] of Object.entries(filters))
    if (value) query.set(key, value);
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
