import { eq, sql } from "drizzle-orm";
import type { AnyPgColumn, PgTable } from "drizzle-orm/pg-core";
import type { DatabaseConnection } from "../db/client";

type Stampable = PgTable & { updatedAt: AnyPgColumn };

/**
 * One table's share of a ledger's change marker (ADR 0044): how many rows it holds and its newest update, to the
 * microsecond. An insert raises the count, every update and soft delete moves `updated_at`, and a hard delete
 * lowers the count, so any change to the rows changes the stamp. Reads only the two aggregates.
 */
export async function tableStamp(
  db: DatabaseConnection,
  table: Stampable,
  scope: AnyPgColumn,
  ledgerId: string,
): Promise<string> {
  const [row] = await db
    .select({
      count: sql<string>`count(*)::text`,
      newest: sql<
        string | null
      >`to_char(max(${table.updatedAt}) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US')`,
    })
    .from(table)
    .where(eq(scope, ledgerId));
  return `${row?.count ?? "0"}@${row?.newest ?? "-"}`;
}
