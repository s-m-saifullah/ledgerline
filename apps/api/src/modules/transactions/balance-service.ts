import type { DatabaseConnection } from "../../db/client";
import { ApiProblem } from "../../lib/problem";
import { transactionRepository } from "./repo";

export async function postedTransactionTotals(
  db: DatabaseConnection,
  ledgerId: string,
  ids: string[],
) {
  if (!ids.length) return new Map<string, bigint>();
  const rows = await transactionRepository(db, ledgerId).postedTotals(ids);
  return new Map(rows.map((row) => [row.accountId, BigInt(row.total)]));
}
export function postedBalance(opening: number, total: bigint = 0n) {
  const amount = BigInt(opening) + total;
  if (
    amount < BigInt(Number.MIN_SAFE_INTEGER) ||
    amount > BigInt(Number.MAX_SAFE_INTEGER)
  )
    throw new ApiProblem(
      409,
      "Conflict",
      "The posted account balance exceeds the supported exact money range.",
      [
        {
          field: "balance",
          message:
            "Adjust the amount or opening balance to keep the posted balance within the supported range.",
        },
      ],
    );
  return Number(amount);
}

/** Category totals count ordinary entries or split allocations, never both. */
export async function postedCategoryTotals(
  db: DatabaseConnection,
  ledgerId: string,
  from: string,
  to: string,
) {
  const result = await transactionRepository(db, ledgerId).categoryTotals(
    from,
    to,
  );
  return new Map(result.rows.map((row) => [row.categoryId, BigInt(row.total)]));
}
