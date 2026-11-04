import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import type { DatabaseConnection } from "../../db/client";
import { ledgerMembers, ledgers } from "../../db/schema";

/**
 * When each person's own ledger was cleared (ADR 0049), as an ISO date or null. A date only, so the admin's routes can
 * say it without ever reading what is in a ledger. A person's own ledger is the live one they own, the earliest first.
 */
export async function ledgerClearedAtFor(
  db: DatabaseConnection,
  userIds: string[],
) {
  const result = new Map<string, string | null>(
    userIds.map((id) => [id, null]),
  );
  if (!userIds.length) return result;
  const rows = await db
    .select({ userId: ledgerMembers.userId, clearedAt: ledgers.clearedAt })
    .from(ledgerMembers)
    .innerJoin(ledgers, eq(ledgers.id, ledgerMembers.ledgerId))
    .where(
      and(
        inArray(ledgerMembers.userId, userIds),
        eq(ledgerMembers.role, "owner"),
        isNull(ledgerMembers.deletedAt),
        isNull(ledgers.deletedAt),
      ),
    )
    .orderBy(asc(ledgerMembers.createdAt), asc(ledgerMembers.id));
  const seen = new Set<string>();
  for (const row of rows) {
    if (seen.has(row.userId)) continue;
    seen.add(row.userId);
    result.set(row.userId, row.clearedAt ? row.clearedAt.toISOString() : null);
  }
  return result;
}
