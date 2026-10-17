import { localDate } from "@ledgerline/shared";
import type { Database } from "../db/client";
import type { RateFetcher } from "../modules/currencies/provider";
import { currencyRepository } from "../modules/currencies/repo";
import { refreshRates } from "../modules/currencies/service";
import { listLedgerOwners } from "../modules/ledgers/repo";
import { writeRepository } from "../modules/writes/repo";
import type { JobLog } from "./runner";

/**
 * Fetches rates once per ledger-local day for every ledger that has pinned currencies. The day's
 * Idempotency-Key makes later ticks of the same day replay instead of fetching again, and manual
 * rates are kept by refreshRates itself. Only counts are logged.
 */
export async function refreshLedgerRates(
  db: Database,
  now: Date,
  fetchRate: RateFetcher,
  log: JobLog,
) {
  const summary = { ledgers: 0, fetched: 0, failed: 0 };
  for (const ledger of await listLedgerOwners(db)) {
    const pinned = await currencyRepository(db, ledger.id).list();
    if (pinned.length === 0) continue;
    summary.ledgers++;
    const identity = {
      actorId: ledger.ownerId,
      ledgerId: ledger.id,
      key: `rates-${localDate(now, ledger.timeZone)}`,
    };
    try {
      // refreshRates calls the rate source before it writes, so check the day's receipt first:
      // a day that is already done must not reach the network again.
      const done = await db.transaction((tx) =>
        writeRepository(tx, identity.actorId, identity.ledgerId).find(
          identity.key,
        ),
      );
      if (done) continue;
      await refreshRates(db, identity, {}, fetchRate);
      summary.fetched++;
    } catch {
      summary.failed++;
    }
  }
  if (summary.fetched || summary.failed)
    log.info(summary, "Daily rate refresh finished");
  return summary;
}
