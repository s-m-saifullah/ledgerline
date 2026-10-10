import { formatRate, parseRate, transactionSchema } from "@ledgerline/shared";
import type { TransactionRow } from "./repo";
import { type SplitRow, splitDto } from "./split-repo";

/** The one place a saved entry becomes its API shape; `lines` are its live split lines. */
export function transactionDto(row: TransactionRow, lines: SplitRow[] = []) {
  return transactionSchema.parse({
    ...row,
    splits: lines.map((line) => splitDto(line, row.currency)),
    amount: { amount: row.amount, currency: row.currency },
    fxRate: formatRate(parseRate(row.fxRate)),
    // The base currency is USD for every ledger today (ADR 0020).
    baseAmount: { amount: row.baseAmount, currency: "USD" },
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
}
