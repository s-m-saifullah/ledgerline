import { and, eq, sql } from "drizzle-orm";
import type { DatabaseTransaction } from "../../db/client";
import { writeReceipts } from "../../db/schema";

export function writeRepository(
  tx: DatabaseTransaction,
  actorId: string,
  ledgerId: string,
) {
  return {
    lock: (key: string) =>
      tx.execute(
        // PostgreSQL UUID equality ignores letter case; the lock scope must do the same.
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${JSON.stringify([actorId.toLowerCase(), ledgerId.toLowerCase(), key])}, 0))`,
      ),
    find: async (key: string) =>
      (
        await tx
          .select()
          .from(writeReceipts)
          .where(
            and(
              eq(writeReceipts.actorId, actorId),
              eq(writeReceipts.ledgerId, ledgerId),
              eq(writeReceipts.key, key),
            ),
          )
      )[0],
    save: (
      receipt: Pick<
        typeof writeReceipts.$inferInsert,
        "key" | "requestHash" | "responseStatus" | "responseBody"
      >,
    ) => tx.insert(writeReceipts).values({ ...receipt, actorId, ledgerId }),
  };
}
