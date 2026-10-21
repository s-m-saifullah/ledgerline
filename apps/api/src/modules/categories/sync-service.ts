import { syncCategorySchema } from "@ledgerline/shared";
import type { DatabaseConnection } from "../../db/client";
import { categories } from "../../db/schema";
import {
  changedRows,
  iso,
  mapPage,
  type SyncPosition,
} from "../../lib/sync-keyset";

/** Categories changed after `after`, deleted ones included, as the sync wire shape (ADR 0042). */
export async function syncCategories(
  db: DatabaseConnection,
  ledgerId: string,
  after: SyncPosition | null,
  limit: number,
) {
  return mapPage(
    await changedRows(db, categories, ledgerId, after, limit),
    (row) =>
      syncCategorySchema.parse({
        id: row.id,
        version: row.version,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
        deletedAt: iso(row.deletedAt),
        parentId: row.parentId,
        name: row.name,
        kind: row.kind,
        icon: row.icon,
        color: row.color,
        sortOrder: row.sortOrder,
        archivedAt: iso(row.archivedAt),
      }),
  );
}
