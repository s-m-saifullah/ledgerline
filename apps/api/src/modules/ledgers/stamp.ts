import type { DatabaseConnection } from "../../db/client";
import { ledgerMembers, ledgers } from "../../db/schema";
import { tableStamp } from "../../lib/change-stamp";

/** The ledger's own settings and its members, for the change marker (ADR 0044). */
export async function ledgerStamps(db: DatabaseConnection, ledgerId: string) {
  return [
    await tableStamp(db, ledgers, ledgers.id, ledgerId),
    await tableStamp(db, ledgerMembers, ledgerMembers.ledgerId, ledgerId),
  ];
}
