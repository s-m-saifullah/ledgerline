import type { DatabaseConnection } from "../../db/client";
import {
  transactionSplits,
  transactions,
  transactionTags,
} from "../../db/schema";
import { tableStamp } from "../../lib/change-stamp";

/** This feature's tables, for the change marker (ADR 0044). */
export async function transactionStamps(
  db: DatabaseConnection,
  ledgerId: string,
) {
  return [
    await tableStamp(db, transactions, transactions.ledgerId, ledgerId),
    await tableStamp(
      db,
      transactionSplits,
      transactionSplits.ledgerId,
      ledgerId,
    ),
    await tableStamp(db, transactionTags, transactionTags.ledgerId, ledgerId),
  ];
}
