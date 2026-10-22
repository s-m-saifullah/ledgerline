import type { DatabaseConnection } from "../../db/client";
import { recurringRules, recurringRuns } from "../../db/schema";
import { tableStamp } from "../../lib/change-stamp";

/** This feature's tables, for the change marker (ADR 0044). */
export async function recurringStamps(
  db: DatabaseConnection,
  ledgerId: string,
) {
  return [
    await tableStamp(db, recurringRules, recurringRules.ledgerId, ledgerId),
    await tableStamp(db, recurringRuns, recurringRuns.ledgerId, ledgerId),
  ];
}
