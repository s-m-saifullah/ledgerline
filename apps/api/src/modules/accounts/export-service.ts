import type { DatabaseConnection } from "../../db/client";
import { accountRepository } from "./repo";

/** Every non-deleted account (archived included) as an export needs it, oldest first. */
export async function accountExportRows(
  db: DatabaseConnection,
  ledgerId: string,
) {
  const rows = await accountRepository(db, ledgerId).all();
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    type: row.type,
    currency: row.currency,
    openingBalance: row.openingBalance,
    archived: row.archivedAt !== null,
  }));
}
