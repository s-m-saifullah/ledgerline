import type { DatabaseConnection } from "../../db/client";
import { transactionRepository } from "./repo";

/** Cleared income and spending (positive cents) per YYYY-MM month for a date range. */
export async function cashFlowByMonth(
  db: DatabaseConnection,
  ledgerId: string,
  from: string,
  to: string,
) {
  const result = await transactionRepository(db, ledgerId).flowByMonth(
    from,
    to,
  );
  return result.rows.map((row) => ({
    month: row.month,
    kind: row.kind === "income" ? ("income" as const) : ("expense" as const),
    total: row.kind === "income" ? BigInt(row.total) : -BigInt(row.total),
  }));
}

/**
 * Each account's cleared total before `from` (`before`) and per YYYY-MM month from `from`
 * through `to` (`months`), as bigints. Deleted and pending entries are left out.
 */
export async function accountTotalsByMonth(
  db: DatabaseConnection,
  ledgerId: string,
  from: string,
  to: string,
) {
  const result = await transactionRepository(db, ledgerId).accountTotalsByMonth(
    from,
    to,
  );
  const before = new Map<string, bigint>();
  const months = new Map<string, Map<string, bigint>>();
  for (const row of result.rows) {
    if (row.month === null) before.set(row.accountId, BigInt(row.total));
    else {
      const byMonth = months.get(row.accountId) ?? new Map<string, bigint>();
      byMonth.set(row.month, BigInt(row.total));
      months.set(row.accountId, byMonth);
    }
  }
  return { before, months };
}

/** The YYYY-MM month of the ledger's oldest live entry, or null when it has none. */
export async function firstEntryMonth(
  db: DatabaseConnection,
  ledgerId: string,
) {
  const result = await transactionRepository(db, ledgerId).firstEntryMonth();
  return result.rows[0]?.month ?? null;
}
