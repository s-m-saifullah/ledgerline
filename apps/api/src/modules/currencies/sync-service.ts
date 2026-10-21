import {
  formatRate,
  parseRate,
  syncCurrencySchema,
  syncRateSchema,
} from "@ledgerline/shared";
import type { DatabaseConnection } from "../../db/client";
import { currencies, exchangeRates } from "../../db/schema";
import {
  changedRows,
  iso,
  mapPage,
  type SyncPosition,
} from "../../lib/sync-keyset";

/** Pinned currencies changed after `after`, deleted ones included, as the sync wire shape (ADR 0042). */
export async function syncCurrencies(
  db: DatabaseConnection,
  ledgerId: string,
  after: SyncPosition | null,
  limit: number,
) {
  return mapPage(
    await changedRows(db, currencies, ledgerId, after, limit),
    (row) =>
      syncCurrencySchema.parse({
        id: row.id,
        version: row.version,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
        deletedAt: iso(row.deletedAt),
        code: row.code,
      }),
  );
}

/** Stored exchange rates changed after `after`, deleted ones included, as the sync wire shape. */
export async function syncExchangeRates(
  db: DatabaseConnection,
  ledgerId: string,
  after: SyncPosition | null,
  limit: number,
) {
  return mapPage(
    await changedRows(db, exchangeRates, ledgerId, after, limit),
    (row) =>
      syncRateSchema.parse({
        id: row.id,
        version: row.version,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
        deletedAt: iso(row.deletedAt),
        code: row.code,
        date: row.date,
        rate: formatRate(parseRate(row.rate)),
        source: row.source,
      }),
  );
}
