import { type SyncResponse, syncResponseSchema } from "@ledgerline/shared";
import { sql } from "drizzle-orm";
import type { Database } from "../../db/client";
import type { SyncPage } from "../../lib/sync-keyset";
import { syncAccounts } from "../accounts/sync-service";
import { syncCategories } from "../categories/sync-service";
import { syncCurrencies, syncExchangeRates } from "../currencies/sync-service";
import { requireLedgerRead } from "../ledgers/service";
import { syncTags } from "../tags/sync-service";
import {
  syncSplits,
  syncTransactions,
  syncTransactionTags,
} from "../transactions/sync-service";
import {
  decodeCursor,
  encodeCursor,
  type SyncPositions,
  type SyncTable,
} from "./cursor";

/** A table whose pull is finished is read again from this far behind the snapshot, so a late commit is not missed. */
const overlapMinutes = 2;
const zeroId = "00000000-0000-0000-0000-000000000000";

/**
 * One page of changes for the phone's mirror (ADR 0042): every table's rows changed after the cursor, deleted
 * rows included, read in one repeatable-read snapshot. A table with more rows than `limit` continues from its
 * last row; a finished table continues from a little before the snapshot, so a change that commits late is
 * sent again (the phone applies rows by id and ignores any that are not newer).
 */
export async function getSyncPage(
  db: Database,
  actorId: string,
  ledgerId: string,
  cursor: string | undefined,
  limit: number,
): Promise<SyncResponse> {
  const from = decodeCursor(cursor);
  return db.transaction(
    async (tx) => {
      await requireLedgerRead(tx, actorId, ledgerId);
      const clock = (
        await tx.execute<{ now: string; behind: string }>(sql`
          select to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as now,
                 to_char((now() - make_interval(mins => ${overlapMinutes})) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as behind`)
      ).rows[0];
      if (!clock) throw new Error("The database gave no time.");
      const pages = {
        accounts: await syncAccounts(
          tx,
          ledgerId,
          from.accounts ?? null,
          limit,
        ),
        categories: await syncCategories(
          tx,
          ledgerId,
          from.categories ?? null,
          limit,
        ),
        tags: await syncTags(tx, ledgerId, from.tags ?? null, limit),
        currencies: await syncCurrencies(
          tx,
          ledgerId,
          from.currencies ?? null,
          limit,
        ),
        exchangeRates: await syncExchangeRates(
          tx,
          ledgerId,
          from.exchangeRates ?? null,
          limit,
        ),
        transactions: await syncTransactions(
          tx,
          ledgerId,
          from.transactions ?? null,
          limit,
        ),
        transactionSplits: await syncSplits(
          tx,
          ledgerId,
          from.transactionSplits ?? null,
          limit,
        ),
        transactionTags: await syncTransactionTags(
          tx,
          ledgerId,
          from.transactionTags ?? null,
          limit,
        ),
      } satisfies Record<SyncTable, SyncPage<unknown>>;
      const next: SyncPositions = {};
      let hasMore = false;
      for (const [name, page] of Object.entries(pages) as [
        SyncTable,
        SyncPage<unknown>,
      ][]) {
        if (page.more && page.last) {
          next[name] = page.last;
          hasMore = true;
        } else next[name] = { at: clock.behind, id: zeroId };
      }
      return syncResponseSchema.parse({
        changes: Object.fromEntries(
          Object.entries(pages).map(([name, page]) => [name, page.rows]),
        ),
        cursor: encodeCursor(next),
        hasMore,
        serverTime: clock.now,
      });
    },
    { isolationLevel: "repeatable read" },
  );
}
