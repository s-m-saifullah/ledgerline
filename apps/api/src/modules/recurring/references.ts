import type { DatabaseConnection } from "../../db/client";
import { recurringRepository } from "./repo";

/** Whether an active recurring rule still uses this account or category. */
export function hasActiveRuleReference(
  db: DatabaseConnection,
  ledgerId: string,
  field: "accountId" | "categoryId",
  id: string,
) {
  return recurringRepository(db, ledgerId).hasActiveReference(field, id);
}
