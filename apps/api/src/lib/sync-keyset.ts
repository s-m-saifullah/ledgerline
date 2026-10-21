import {
  and,
  eq,
  getTableColumns,
  type InferSelectModel,
  sql,
} from "drizzle-orm";
import type { AnyPgColumn, PgTable } from "drizzle-orm/pg-core";
import type { DatabaseConnection } from "../db/client";

/** Where a table's pull stopped: the last row's update time (to the microsecond, as text) and id. */
export type SyncPosition = { at: string; id: string };

/** A page of rows with the position to continue from; `more` says the table has rows beyond it. */
export type SyncPage<Row> = {
  rows: Row[];
  last: SyncPosition | null;
  more: boolean;
};

type Syncable = PgTable & {
  ledgerId: AnyPgColumn;
  updatedAt: AnyPgColumn;
  id: AnyPgColumn;
};

const microseconds = (column: AnyPgColumn) =>
  sql<string>`to_char(${column} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

/**
 * Every row of one ledger changed after `after` (all of them when null), deleted rows included, oldest change
 * first, in pages of `limit` (ADR 0042). Ordered by the update time and then the id, so the keyset is stable
 * and a cursor never repeats a row it has passed. The time is compared as text to the microsecond: a
 * JavaScript date would round it to a millisecond and a page of rows from one millisecond could repeat for ever.
 */
export async function changedRows<T extends Syncable>(
  db: DatabaseConnection,
  table: T,
  ledgerId: string,
  after: SyncPosition | null,
  limit: number,
) {
  const found = await db
    .select({ row: getTableColumns(table), at: microseconds(table.updatedAt) })
    .from(table as PgTable)
    .where(
      and(
        eq(table.ledgerId, ledgerId),
        after
          ? sql`(${table.updatedAt}, ${table.id}) > (${after.at}::timestamptz, ${after.id}::uuid)`
          : undefined,
      ),
    )
    .orderBy(table.updatedAt, table.id)
    .limit(limit + 1);
  const more = found.length > limit;
  const kept = found.slice(0, limit);
  const lastRow = kept[kept.length - 1];
  return {
    rows: kept.map((item) => item.row as InferSelectModel<T>),
    last: lastRow
      ? { at: lastRow.at, id: (lastRow.row as { id: string }).id }
      : null,
    more,
  };
}

/** The same page with each row turned into its wire shape. */
export function mapPage<Row, Wire>(
  page: SyncPage<Row>,
  map: (row: Row) => Wire,
): SyncPage<Wire> {
  return { rows: page.rows.map(map), last: page.last, more: page.more };
}

export const iso = (date: Date | null) => (date ? date.toISOString() : null);
