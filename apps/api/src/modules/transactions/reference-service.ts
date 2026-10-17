import type { DatabaseConnection } from "../../db/client";
import { ApiProblem } from "../../lib/problem";
import { hasActiveRuleReference } from "../recurring/references";
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
/** A recurring rule still using an account or category blocks deleting it (archiving stays possible). */
export async function requireNoActiveRules(
  db: DatabaseConnection,
  ledgerId: string,
  field: "accountId" | "categoryId",
  id: string,
) {
  if (await hasActiveRuleReference(db, ledgerId, field, id))
    throw new ApiProblem(
      409,
      "Conflict",
      "Delete the recurring rules that use this item first, or archive it to keep its history.",
    );
}
