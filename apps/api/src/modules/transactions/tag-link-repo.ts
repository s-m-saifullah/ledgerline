import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type { DatabaseConnection } from "../../db/client";
import { transactionTags } from "../../db/schema";

/**
 * Which tags sit on which entries (ADR 0035). The links belong to the entries: a deleted entry
 * keeps its links, so Undo brings its tags back with it.
 */
export function tagLinkRepository(db: DatabaseConnection, ledgerId: string) {
  const live = and(
    eq(transactionTags.ledgerId, ledgerId),
    isNull(transactionTags.deletedAt),
  );
  return {
    /** Entry id to its live tag ids. */
    forEntries: async (entryIds: string[]) => {
      const byEntry = new Map<string, string[]>();
      if (!entryIds.length) return byEntry;
      const rows = await db
        .select({
          entryId: transactionTags.transactionId,
          tagId: transactionTags.tagId,
        })
        .from(transactionTags)
        .where(and(live, inArray(transactionTags.transactionId, entryIds)))
        .orderBy(transactionTags.id);
      for (const row of rows)
        byEntry.set(row.entryId, [
          ...(byEntry.get(row.entryId) ?? []),
          row.tagId,
        ]);
      return byEntry;
    },
    /** Make each entry carry exactly these tags: drop the others, add the missing ones. */
    replace: async (entryIds: string[], tagIds: string[]) => {
      const wanted = tagIds.map((id) => id.toLowerCase());
      const existing = await db
        .select({
          id: transactionTags.id,
          entryId: transactionTags.transactionId,
          tagId: transactionTags.tagId,
        })
        .from(transactionTags)
        .where(and(live, inArray(transactionTags.transactionId, entryIds)));
      const stale = existing.filter((row) => !wanted.includes(row.tagId));
      if (stale.length)
        await db
          .update(transactionTags)
          .set({ deletedAt: new Date() })
          .where(
            inArray(
              transactionTags.id,
              stale.map((row) => row.id),
            ),
          );
      const missing = entryIds.flatMap((entryId) =>
        wanted
          .filter(
            (tagId) =>
              !existing.some(
                (row) => row.entryId === entryId && row.tagId === tagId,
              ),
          )
          .map((tagId) => ({ ledgerId, transactionId: entryId, tagId })),
      );
      if (missing.length) await db.insert(transactionTags).values(missing);
    },
    /** Live entries (not deleted ones) per tag. */
    usage: async (tagIds: string[]) => {
      const counts = new Map<string, number>();
      if (!tagIds.length) return counts;
      const rows = await db.execute<{ tagId: string; total: string }>(sql`
        select l.tag_id as "tagId", count(distinct coalesce(t.transfer_id, t.id))::text as total
        from transaction_tags l join transactions t on t.ledger_id = l.ledger_id and t.id = l.transaction_id
        where l.ledger_id = ${ledgerId} and l.deleted_at is null and t.deleted_at is null
          and l.tag_id in (${sql.join(
            tagIds.map((id) => sql`${id}::uuid`),
            sql`, `,
          )})
        group by l.tag_id`);
      for (const row of rows.rows) counts.set(row.tagId, Number(row.total));
      return counts;
    },
    /** Remove a tag from every entry, deleted ones included (the tag itself is being deleted). */
    detach: (tagId: string) =>
      db
        .update(transactionTags)
        .set({ deletedAt: new Date() })
        .where(and(live, eq(transactionTags.tagId, tagId))),
  };
}
