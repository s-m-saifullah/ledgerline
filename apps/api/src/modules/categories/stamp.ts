import type { DatabaseConnection } from "../../db/client";
import { categories } from "../../db/schema";
import { tableStamp } from "../../lib/change-stamp";

/** This feature's tables, for the change marker (ADR 0044). */
export async function categoryStamps(db: DatabaseConnection, ledgerId: string) {
  return [await tableStamp(db, categories, categories.ledgerId, ledgerId)];
}
