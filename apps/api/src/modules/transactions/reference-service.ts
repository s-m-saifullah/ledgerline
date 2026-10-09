import type { DatabaseConnection } from "../../db/client";
import { ApiProblem } from "../../lib/problem";
import { transactionRepository } from "./repo";
import { splitRepository } from "./split-repo";
/** Caller must hold the account assignment lock or category ledger lock. */
export async function requireNoActiveTransactions(
  db: DatabaseConnection,
  ledgerId: string,
  field: "accountId" | "categoryId",
  id: string,
) {
  if (
    (await transactionRepository(db, ledgerId).hasActiveReference(field, id)) ||
    (field === "categoryId" &&
      (await splitRepository(db, ledgerId).hasCategory(id)))
  )
    throw new ApiProblem(
      409,
      "Conflict",
      "Delete the connected transactions first, or archive this item to keep its history.",
    );
}
