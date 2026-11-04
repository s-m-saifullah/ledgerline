import { type Ledger, ledgerSchema } from "@ledgerline/shared";
import { prepareFinancialWrite } from "../../lib/api";

export function prepareLedgerTimeZone(ledger: Ledger, timeZone: string) {
  const run = prepareFinancialWrite<unknown>(`/ledgers/${ledger.id}`, "PATCH", {
    timeZone,
    expectedVersion: ledger.version,
  });
  return async (): Promise<Ledger> => ledgerSchema.parse(await run());
}

/** Empties the ledger so the owner can start fresh; it can be restored for 30 days. Built once per press, so a retry reuses its key. */
export function prepareClearLedger(ledger: Ledger) {
  const run = prepareFinancialWrite<unknown>(
    `/ledgers/${ledger.id}/clear`,
    "POST",
    { confirm: "CLEAR" },
  );
  return async (): Promise<Ledger> => ledgerSchema.parse(await run());
}

/** Brings back what the last clear removed, while the ledger is still empty and the 30 days have not passed. */
export function prepareRestoreLedger(ledger: Ledger) {
  const run = prepareFinancialWrite<unknown>(
    `/ledgers/${ledger.id}/restore`,
    "POST",
    {},
  );
  return async (): Promise<Ledger> => ledgerSchema.parse(await run());
}
