import type { UpdateLedger } from "@ledgerline/shared";
import type {
  Database,
  DatabaseConnection,
  DatabaseTransaction,
} from "../../db/client";
import { ApiProblem } from "../../lib/problem";
import { runFinancialWrite, type WriteIdentity } from "../writes/service";
import { nextVersion, requireVersionUpdate } from "../writes/version";
import { ledgerRepository } from "./repo";

export const ledgerService = (db: DatabaseConnection, userId: string) =>
  ledgerRepository(db, userId);

export async function requireLedgerRead(
  db: DatabaseConnection,
  actorId: string,
  ledgerId: string,
) {
  const ledger = await ledgerRepository(db, actorId).find(ledgerId);
  if (!ledger) throw new ApiProblem(404, "Not found", "Ledger not found.");
  return ledger;
}

export async function requireLedgerWrite(
  tx: DatabaseTransaction,
  actorId: string,
  ledgerId: string,
) {
  const ledger = await ledgerRepository(tx, actorId).findAndLock(ledgerId);
  if (!ledger) throw new ApiProblem(404, "Not found", "Ledger not found.");
  if (ledger.role !== "owner" && ledger.role !== "editor")
    throw new ApiProblem(403, "Forbidden", "This ledger is read-only.");
  return ledger;
}

/** The ledger's base currency, for services that price entries. */
export async function ledgerBaseCurrency(
  db: DatabaseConnection,
  actorId: string,
  ledgerId: string,
) {
  return (await requireLedgerRead(db, actorId, ledgerId)).baseCurrency;
}

/** Only the owner changes ledger settings; the new version is returned like any editable record. */
export function updateLedger(
  db: Database,
  identity: WriteIdentity,
  body: UpdateLedger,
) {
  return runFinancialWrite(
    db,
    {
      ...identity,
      operation: `PATCH ledgers/${identity.ledgerId.toLowerCase()}`,
      request: body,
    },
    async ({ tx, actorId, ledgerId }) => {
      const ledger = await requireLedgerWrite(tx, actorId, ledgerId);
      if (ledger.role !== "owner")
        throw new ApiProblem(
          403,
          "Forbidden",
          "Only the owner can change ledger settings.",
        );
      const version = nextVersion(ledger.version, body.expectedVersion);
      requireVersionUpdate(
        await ledgerRepository(tx, actorId).setTimeZone(
          ledgerId,
          body.expectedVersion,
          body.timeZone,
          version,
        ),
      );
      const { role: _role, ...rest } = ledger;
      return {
        status: 200,
        body: { ...rest, timeZone: body.timeZone, version, role: ledger.role },
      };
    },
  );
}
