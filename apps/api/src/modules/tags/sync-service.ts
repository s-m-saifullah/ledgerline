import { syncTagSchema } from "@ledgerline/shared";
import type { DatabaseConnection } from "../../db/client";
import { tags } from "../../db/schema";
import {
  changedRows,
  iso,
  mapPage,
  type SyncPosition,
} from "../../lib/sync-keyset";

/** Tags changed after `after`, deleted ones included, as the sync wire shape (ADR 0042). */
export async function syncTags(
  db: DatabaseConnection,
  ledgerId: string,
  after: SyncPosition | null,
  limit: number,
) {
  return mapPage(await changedRows(db, tags, ledgerId, after, limit), (row) =>
    syncTagSchema.parse({
      id: row.id,
      version: row.version,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      deletedAt: iso(row.deletedAt),
      name: row.name,
      archivedAt: iso(row.archivedAt),
    }),
  );
}
