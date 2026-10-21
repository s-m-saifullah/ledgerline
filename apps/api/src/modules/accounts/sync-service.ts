import { syncAccountSchema } from "@ledgerline/shared";
import type { DatabaseConnection } from "../../db/client";
import { accounts } from "../../db/schema";
import {
  changedRows,
  iso,
  mapPage,
  type SyncPosition,
} from "../../lib/sync-keyset";

/** Accounts changed after `after`, deleted ones included, as the sync wire shape (ADR 0042). */
export async function syncAccounts(
  db: DatabaseConnection,
  ledgerId: string,
  after: SyncPosition | null,
  limit: number,
) {
  return mapPage(
    await changedRows(db, accounts, ledgerId, after, limit),
    (row) =>
      syncAccountSchema.parse({
        id: row.id,
        version: row.version,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
        deletedAt: iso(row.deletedAt),
        name: row.name,
        type: row.type,
        currency: row.currency,
        openingBalance: { amount: row.openingBalance, currency: row.currency },
        inboundBonusBps: row.inboundBonusBps,
        bonusCategoryId: row.bonusCategoryId,
        feeCategoryId: row.feeCategoryId,
        defaultFeeAmount:
          row.defaultFeeAmount === null
            ? null
            : { amount: row.defaultFeeAmount, currency: row.currency },
        defaultFeeBps: row.defaultFeeBps,
        contactId: row.contactId,
        archivedAt: iso(row.archivedAt),
      }),
  );
}
