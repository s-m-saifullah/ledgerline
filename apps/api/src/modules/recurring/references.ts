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

/** Deleting a tag takes it off the rules that carry it, so no rule keeps a tag that is gone (ADR 0035). */
export function removeTagFromRules(
  db: DatabaseConnection,
  ledgerId: string,
  tagId: string,
) {
  return recurringRepository(db, ledgerId).removeTag(tagId);
}
