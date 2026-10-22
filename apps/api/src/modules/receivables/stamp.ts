import type { DatabaseConnection } from "../../db/client";
import {
  receivableEvents,
  receivablePayments,
  receivables,
} from "../../db/schema";
import { tableStamp } from "../../lib/change-stamp";

/** This feature's tables, for the change marker (ADR 0044). */
export async function receivableStamps(
  db: DatabaseConnection,
  ledgerId: string,
) {
  return [
    await tableStamp(db, receivables, receivables.ledgerId, ledgerId),
    await tableStamp(
      db,
      receivablePayments,
      receivablePayments.ledgerId,
      ledgerId,
    ),
    await tableStamp(db, receivableEvents, receivableEvents.ledgerId, ledgerId),
  ];
}
