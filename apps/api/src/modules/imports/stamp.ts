import type { DatabaseConnection } from "../../db/client";
import { importBatches } from "../../db/schema";
import { tableStamp } from "../../lib/change-stamp";

/** This feature's tables, for the change marker (ADR 0044). */
export async function importStamps(db: DatabaseConnection, ledgerId: string) {
  return [
    await tableStamp(db, importBatches, importBatches.ledgerId, ledgerId),
  ];
}
