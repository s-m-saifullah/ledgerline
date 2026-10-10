import type { DatabaseConnection } from "../../db/client";
import { transactionRepository } from "./repo";

/** Cleared spending (positive cents) per category and YYYY-MM month for a date range. */
export async function spendingByCategoryMonth(
  db: DatabaseConnection,
  ledgerId: string,
  from: string,
  to: string,
) {
  const result = await transactionRepository(
    db,
    ledgerId,
  ).expenseByCategoryMonth(from, to);
  return result.rows.map((row) => ({
    categoryId: row.categoryId,
    month: row.month,
    spent: -BigInt(row.total),
  }));
}
