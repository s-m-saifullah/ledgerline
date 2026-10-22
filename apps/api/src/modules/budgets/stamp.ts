import type { DatabaseConnection } from "../../db/client";
import { budgets } from "../../db/schema";
import { tableStamp } from "../../lib/change-stamp";

/** This feature's tables, for the change marker (ADR 0044). */
export async function budgetStamps(db: DatabaseConnection, ledgerId: string) {
  return [await tableStamp(db, budgets, budgets.ledgerId, ledgerId)];
}
