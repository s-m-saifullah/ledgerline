import type { DatabaseConnection } from "../../db/client";
import {
  postedBalance,
  postedTransactionTotals,
} from "../transactions/balance-service";
import { accountRepository } from "./repo";

/** Every non-deleted account (archived included) with its computed posted balance. */
export async function accountBalanceOverview(
  db: DatabaseConnection,
  ledgerId: string,
) {
  const rows = await accountRepository(db, ledgerId).all();
  const totals = await postedTransactionTotals(
    db,
    ledgerId,
    rows.map((row) => row.id),
  );
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    type: row.type,
    archived: row.archivedAt !== null,
    balance: postedBalance(row.openingBalance, totals.get(row.id)),
  }));
}
