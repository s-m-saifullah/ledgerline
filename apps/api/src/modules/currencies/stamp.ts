import type { DatabaseConnection } from "../../db/client";
import { currencies, exchangeRates } from "../../db/schema";
import { tableStamp } from "../../lib/change-stamp";

/** This feature's tables, for the change marker (ADR 0044). */
export async function currencyStamps(db: DatabaseConnection, ledgerId: string) {
  return [
    await tableStamp(db, currencies, currencies.ledgerId, ledgerId),
    await tableStamp(db, exchangeRates, exchangeRates.ledgerId, ledgerId),
  ];
}
