import { transactionListSchema } from "@ledgerline/shared";
import { api } from "./api";

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
