import type { Database } from "../db/client";
import type { RateFetcher } from "../modules/currencies/provider";
import { purgeClearedLedgers } from "../modules/ledgers/clear";
import { purgeDeletedPeople } from "../modules/users/lifecycle";
import { refreshLedgerRates } from "./rates";
import { runRecurringRules } from "./recurring";
import type { JobLog } from "./runner";

/** Everything the hourly tick does, in order. Each step handles its own failures. */
export async function runTick(
  db: Database,
  now: Date,
  deps: { fetchRate: RateFetcher; log: JobLog },
) {
  // Rates first, so entries created in this tick can use today's rates.
  const rates = await refreshLedgerRates(db, now, deps.fetchRate, deps.log);
  const recurring = await runRecurringRules(db, now, deps.log);
  // People deleted more than 30 days ago go for good, with everything of theirs (ADR 0049).
  const purged = await purgeDeletedPeople(db, now, deps.log);
  // A cleared ledger's undo ends after 30 days too (ADR 0049).
  const clearedPurged = await purgeClearedLedgers(db, now, deps.log);
  return { rates, recurring, purged, clearedPurged };
}
