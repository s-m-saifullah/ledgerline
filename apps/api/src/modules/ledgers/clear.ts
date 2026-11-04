import { getTableColumns, getTableName, sql } from "drizzle-orm";
import type { Database, DatabaseConnection } from "../../db/client";
import type { JobLog } from "../../jobs/runner";
import { ApiProblem } from "../../lib/problem";
import { PURGE_ORDER, PURGED_TABLES, RETENTION_DAYS } from "../users/lifecycle";

// ADR 0049: clearing a ledger soft-deletes every live row of its tables with ONE moment and records it in
// `ledgers.cleared_at`; restoring revives the rows that carry that moment; the hourly job removes a batch for good
// 30 days after it. The ledger itself, its name, its currency and its memberships stay. Nothing here returns a row.

const DAY_MS = 24 * 60 * 60 * 1000;

/** Every table of a ledger's rows, children first, except the memberships (a clear leaves the person in the ledger). */
export const CLEARED_TABLES: readonly string[] = PURGED_TABLES.filter(
  (name) => name !== "ledger_members",
);
/** The tables with a `version`: the phone applies a row only when its version is higher, so a clear must raise it. */
const VERSIONED = new Set<string>(
  PURGE_ORDER.filter((table) => "version" in getTableColumns(table)).map(
    (table) => getTableName(table),
  ),
);
/**
 * Rows that a person did not make: the saved answers to retried writes. They are cleared with the rest (an old key
 * must not write into the emptied ledger), but they do not count as something in the ledger.
 */
const NOT_DATA = new Set(["write_receipts"]);

/** A column as an ISO text (the driver hands raw timestamps back as text, so a Date is never assumed). */
const isoOf = (column: string) =>
  sql.raw(
    `to_char(${column} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`,
  );
/** The moment the ledger was cleared, read by the database itself so rows are matched on the exact stored value. */
const batchOf = (ledgerId: string) =>
  sql`(SELECT cleared_at FROM ledgers WHERE id = ${ledgerId})`;
const instant = (date: Date) => sql`${date.toISOString()}::timestamptz`;
const closesAt = (clearedAt: Date) =>
  new Date(clearedAt.getTime() + RETENTION_DAYS * DAY_MS);

/** The ledger's row, locked, so a clear, a restore and the hourly removal queue up. */
async function lock(tx: DatabaseConnection, ledgerId: string) {
  const found = await tx.execute<{ cleared_at: string | null }>(
    sql`SELECT ${isoOf("cleared_at")} AS cleared_at FROM ledgers WHERE id = ${ledgerId} AND deleted_at IS NULL FOR UPDATE`,
  );
  const row = found.rows[0];
  if (!row) throw new ApiProblem(404, "Not found", "Ledger not found.");
  return { clearedAt: row.cleared_at ? new Date(row.cleared_at) : null };
}

/** Whether a person has anything live in the ledger. */
async function hasLiveRows(tx: DatabaseConnection, ledgerId: string) {
  const tables = CLEARED_TABLES.filter((name) => !NOT_DATA.has(name));
  const found = await tx.execute<{ live: boolean }>(
    sql`SELECT (${sql.join(
      tables.map(
        (name) =>
          sql`EXISTS (SELECT 1 FROM ${sql.identifier(name)} WHERE ledger_id = ${ledgerId} AND deleted_at IS NULL)`,
      ),
      sql` OR `,
    )}) AS live`,
  );
  return found.rows[0]?.live === true;
}

/**
 * Removes a batch for good: every row of the ledger deleted at that moment or before it. The rows deleted earlier
 * go too, because a live row they point at is in the batch, and nothing made after the clear can point at them.
 */
async function removeBatch(tx: DatabaseConnection, ledgerId: string) {
  for (const name of CLEARED_TABLES)
    await tx.execute(
      sql`DELETE FROM ${sql.identifier(name)} WHERE ledger_id = ${ledgerId} AND deleted_at <= ${batchOf(ledgerId)}`,
    );
}

/**
 * Clears a ledger in the caller's transaction. Does nothing when nothing is live (so a second press never throws away
 * the undo). An older batch is removed first: there is one undo slot. Every row's version goes up by one, as for any
 * delete, so a phone takes the change.
 */
export async function clearLedgerRows(
  tx: DatabaseConnection,
  ledgerId: string,
  now = new Date(),
) {
  const ledger = await lock(tx, ledgerId);
  if (!(await hasLiveRows(tx, ledgerId))) return;
  if (ledger.clearedAt) await removeBatch(tx, ledgerId);
  for (const name of CLEARED_TABLES)
    await tx.execute(
      sql`UPDATE ${sql.identifier(name)} SET deleted_at = ${instant(now)}, updated_at = ${instant(now)}${
        VERSIONED.has(name) ? sql`, version = version + 1` : sql``
      } WHERE ledger_id = ${ledgerId} AND deleted_at IS NULL`,
    );
  await tx.execute(
    sql`UPDATE ledgers SET cleared_at = ${instant(now)}, updated_at = ${instant(now)}, version = version + 1 WHERE id = ${ledgerId}`,
  );
}

/**
 * Brings back what the last clear removed, in the caller's transaction: only while the 30 days are not over (to the
 * millisecond) and only while nothing live is in the ledger, so it never mixes two sets of data.
 */
export async function restoreClearedRows(
  tx: DatabaseConnection,
  ledgerId: string,
  now = new Date(),
) {
  const { clearedAt } = await lock(tx, ledgerId);
  if (!clearedAt || closesAt(clearedAt).getTime() <= now.getTime())
    throw new ApiProblem(409, "Conflict", "There is nothing to restore.");
  if (await hasLiveRows(tx, ledgerId))
    throw new ApiProblem(409, "Conflict", "Clear what is there now first.");
  for (const name of CLEARED_TABLES)
    await tx.execute(
      sql`UPDATE ${sql.identifier(name)} SET deleted_at = NULL, updated_at = ${instant(now)}${
        VERSIONED.has(name) ? sql`, version = version + 1` : sql``
      } WHERE ledger_id = ${ledgerId} AND deleted_at = ${batchOf(ledgerId)}`,
    );
  await tx.execute(
    sql`UPDATE ledgers SET cleared_at = NULL, updated_at = ${instant(now)}, version = version + 1 WHERE id = ${ledgerId}`,
  );
}

/**
 * The hourly job's part: removes every batch whose 30 days are over, one transaction per ledger, so one that cannot
 * be removed is left whole and the others still go. Counts only are logged, never a name or an id.
 */
export async function purgeClearedLedgers(
  db: Database,
  now: Date,
  log: JobLog,
) {
  const closed = new Date(now.getTime() - RETENTION_DAYS * DAY_MS);
  const due = await db.execute<{ id: string }>(
    sql`SELECT id FROM ledgers WHERE cleared_at <= ${instant(closed)} ORDER BY id`,
  );
  let purged = 0;
  let failed = 0;
  for (const { id } of due.rows) {
    try {
      const done = await db.transaction(async (tx) => {
        // Looked at again under the lock: a restore that got there first wins.
        const found = await tx.execute<{ id: string }>(
          sql`SELECT id FROM ledgers WHERE id = ${id} AND cleared_at <= ${instant(closed)} FOR UPDATE`,
        );
        if (!found.rows[0]) return false;
        await removeBatch(tx, id);
        await tx.execute(
          sql`UPDATE ledgers SET cleared_at = NULL, updated_at = ${instant(now)} WHERE id = ${id}`,
        );
        return true;
      });
      if (done) purged += 1;
    } catch {
      failed += 1;
    }
  }
  if (purged) log.info({ purged }, "Removed cleared ledgers");
  if (failed) log.error({ failed }, "Could not remove cleared ledgers");
  return { purged, failed };
}
