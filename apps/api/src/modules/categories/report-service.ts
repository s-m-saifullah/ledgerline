import type { DatabaseConnection } from "../../db/client";
import { categoryRepository } from "./repo";

/** Every non-deleted category with what a report or an export needs to name and group it. */
export async function categoryReportRows(
  db: DatabaseConnection,
  ledgerId: string,
) {
  const rows = await categoryRepository(db, ledgerId).all();
  return rows.map((row) => ({
    id: row.id,
    parentId: row.parentId,
    name: row.name,
    kind: row.kind,
    color: row.color,
    archived: row.archivedAt !== null,
  }));
}
