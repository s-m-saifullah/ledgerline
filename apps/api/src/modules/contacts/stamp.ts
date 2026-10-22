import type { DatabaseConnection } from "../../db/client";
import { contacts } from "../../db/schema";
import { tableStamp } from "../../lib/change-stamp";

/** This feature's tables, for the change marker (ADR 0044). */
export async function contactStamps(db: DatabaseConnection, ledgerId: string) {
  return [await tableStamp(db, contacts, contacts.ledgerId, ledgerId)];
}
