import type { ClearLedger, UpdateLedger } from "@ledgerline/shared";
import type {
  Database,
  DatabaseConnection,
  DatabaseTransaction,
} from "../../db/client";
import { ApiProblem } from "../../lib/problem";
import { runFinancialWrite, type WriteIdentity } from "../writes/service";
import { nextVersion, requireVersionUpdate } from "../writes/version";
import { clearLedgerRows, restoreClearedRows } from "./clear";
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

/** The ledger as the person sees it now, after a clear or a restore. */
async function ledgerNow(
  tx: DatabaseTransaction,
  actorId: string,
  ledgerId: string,
) {
  const ledger = await ledgerRepository(tx, actorId).find(ledgerId);
  if (!ledger) throw new ApiProblem(404, "Not found", "Ledger not found.");
  return ledger;
}

/** Only the owner empties or restores a ledger; the one who runs it holds the ledger alone while it runs. */
function ownerOnly(role: string, what: string) {
  if (role !== "owner")
    throw new ApiProblem(403, "Forbidden", `Only the owner can ${what}.`);
}

/** Clears the ledger so the person can start fresh; it can be restored for 30 days (ADR 0049). */
export function clearLedger(
  db: Database,
  identity: WriteIdentity,
  body: ClearLedger,
) {
  return runFinancialWrite(
    db,
    {
      ...identity,
      operation: `POST ledgers/${identity.ledgerId.toLowerCase()}/clear`,
      request: body,
      exclusive: true,
    },
    async ({ tx, actorId, ledgerId }) => {
      ownerOnly(
        (await requireLedgerWrite(tx, actorId, ledgerId)).role,
        "clear the ledger",
      );
      await clearLedgerRows(tx, ledgerId);
      return { status: 200, body: await ledgerNow(tx, actorId, ledgerId) };
    },
  );
}

/** Brings back what the last clear removed (ADR 0049). */
export function restoreLedger(db: Database, identity: WriteIdentity) {
  return runFinancialWrite(
    db,
    {
      ...identity,
      operation: `POST ledgers/${identity.ledgerId.toLowerCase()}/restore`,
      request: {},
      exclusive: true,
    },
    async ({ tx, actorId, ledgerId }) => {
      ownerOnly(
        (await requireLedgerWrite(tx, actorId, ledgerId)).role,
        "restore the ledger",
      );
      await restoreClearedRows(tx, ledgerId);
      return { status: 200, body: await ledgerNow(tx, actorId, ledgerId) };
    },
  );
}
