import type { DatabaseConnection } from "../../db/client";
import { ApiProblem } from "../../lib/problem";
import { accountRepository } from "./repo";

/**
 * The account an import writes into: one of the owner's own, active accounts. Accounts that stand
 * for a client's loan balance are managed from Loans and never take imported entries.
 */
export async function importTargetAccount(
  db: DatabaseConnection,
  ledgerId: string,
  id: string,
) {
  const row = await accountRepository(db, ledgerId).find(id.toLowerCase());
  if (!row) throw new ApiProblem(404, "Not found", "Account not found.");
  if (row.archivedAt || row.contactId)
    throw new ApiProblem(409, "Conflict", "Choose an active account.", [
      { field: "accountId", message: "Choose an active account." },
    ]);
  return { id: row.id, currency: row.currency };
}
