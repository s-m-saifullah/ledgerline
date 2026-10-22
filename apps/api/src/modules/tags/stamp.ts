import type { DatabaseConnection } from "../../db/client";
import { tags } from "../../db/schema";
import { tableStamp } from "../../lib/change-stamp";

/** This feature's tables, for the change marker (ADR 0044). */
export async function tagStamps(db: DatabaseConnection, ledgerId: string) {
  return [await tableStamp(db, tags, tags.ledgerId, ledgerId)];
}
