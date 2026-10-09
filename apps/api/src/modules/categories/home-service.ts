import type { DatabaseConnection } from "../../db/client";
import { categoryRepository } from "./repo";

/** Display labels ("Parent / Name") for every non-deleted category, and whether any is active. */
export async function categoryLabelOverview(
  db: DatabaseConnection,
  ledgerId: string,
) {
  const rows = await categoryRepository(db, ledgerId).all();
  const byId = new Map(rows.map((row) => [row.id, row]));
  const labels = new Map(
    rows.map((row) => {
      const parent = row.parentId ? byId.get(row.parentId) : undefined;
      return [
        row.id,
        `${parent ? `${parent.name} / ` : ""}${row.name}${row.archivedAt ? " (archived)" : ""}`,
      ] as const;
    }),
  );
  return { labels, hasActive: rows.some((row) => !row.archivedAt) };
}
