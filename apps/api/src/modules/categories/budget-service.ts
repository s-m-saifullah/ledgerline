import type { DatabaseConnection } from "../../db/client";
import { categoryRepository } from "./repo";

/** Every non-deleted expense category, for budget screens and rollups. */
export async function expenseCategoryOverview(
  db: DatabaseConnection,
  ledgerId: string,
) {
  const rows = await categoryRepository(db, ledgerId).all();
  return rows
    .filter((row) => row.kind === "expense")
    .map((row) => ({
      id: row.id,
      parentId: row.parentId,
      name: row.name,
      icon: row.icon,
      color: row.color,
      sortOrder: row.sortOrder,
      archived: row.archivedAt !== null,
    }));
}
