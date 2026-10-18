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
