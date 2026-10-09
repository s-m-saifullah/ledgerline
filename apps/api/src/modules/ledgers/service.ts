import type { DatabaseConnection, DatabaseTransaction } from "../../db/client";
import { ApiProblem } from "../../lib/problem";
import { ledgerRepository } from "./repo";

export const ledgerService = (db: DatabaseConnection, userId: string) =>
  ledgerRepository(db, userId);

export async function requireLedgerRead(
  db: DatabaseConnection,
  actorId: string,
  ledgerId: string,
) {
  const ledger = await ledgerRepository(db, actorId).find(ledgerId);
  if (!ledger) throw new ApiProblem(404, "Not found", "Ledger not found.");
  return ledger;
}

export async function requireLedgerWrite(
  tx: DatabaseTransaction,
  actorId: string,
  ledgerId: string,
) {
  const ledger = await ledgerRepository(tx, actorId).findAndLock(ledgerId);
  if (!ledger) throw new ApiProblem(404, "Not found", "Ledger not found.");
  if (ledger.role !== "owner" && ledger.role !== "editor")
    throw new ApiProblem(403, "Forbidden", "This ledger is read-only.");
  return ledger;
}
