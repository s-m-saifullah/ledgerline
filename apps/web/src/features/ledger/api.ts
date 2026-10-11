import { type Ledger, ledgerSchema } from "@ledgerline/shared";
import { prepareFinancialWrite } from "../../lib/api";

export function prepareLedgerTimeZone(ledger: Ledger, timeZone: string) {
  const run = prepareFinancialWrite<unknown>(`/ledgers/${ledger.id}`, "PATCH", {
    timeZone,
    expectedVersion: ledger.version,
  });
  return async (): Promise<Ledger> => ledgerSchema.parse(await run());
}
