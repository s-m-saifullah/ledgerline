import type { DatabaseConnection } from "../../db/client";
import { accounts } from "../../db/schema";
import { tableStamp } from "../../lib/change-stamp";

/** This feature's tables, for the change marker (ADR 0044). */
export async function accountStamps(db: DatabaseConnection, ledgerId: string) {
  return [await tableStamp(db, accounts, accounts.ledgerId, ledgerId)];
}
