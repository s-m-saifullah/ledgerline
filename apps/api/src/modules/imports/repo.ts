import { and, desc, eq, isNull } from "drizzle-orm";
import type { DatabaseConnection } from "../../db/client";
import { importBatches } from "../../db/schema";

export type ImportBatchRow = typeof importBatches.$inferSelect;

export function importRepository(db: DatabaseConnection, ledgerId: string) {
  const scope = and(
    eq(importBatches.ledgerId, ledgerId),
    isNull(importBatches.deletedAt),
  );
  return {
    create: async (input: {
      id: string;
      createdBy: string;
      accountId: string;
      sourceName: string | null;
      rowCount: number;
    }) =>
      (
        await db
          .insert(importBatches)
          .values({ ...input, ledgerId })
          .returning()
      )[0],
    find: async (id: string, lock = false) => {
      const query = db
        .select()
        .from(importBatches)
        .where(and(scope, eq(importBatches.id, id)));
      return (await (lock ? query.for("update") : query))[0];
    },
    recent: (limit: number) =>
      db
        .select()
        .from(importBatches)
        .where(scope)
        .orderBy(desc(importBatches.createdAt), desc(importBatches.id))
        .limit(limit),
    markUndone: (id: string, expectedVersion: number, version: number) =>
      db
        .update(importBatches)
        .set({ deletedAt: new Date(), version })
        .where(
          and(
            scope,
            eq(importBatches.id, id),
            eq(importBatches.version, expectedVersion),
          ),
        )
        .returning(),
  };
}
