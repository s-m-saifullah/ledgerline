import {
  type AccountListQuery,
  type ArchiveAccount,
  accountSchema,
  type CreateAccount,
  type DeleteAccount,
  type UpdateAccount,
} from "@ledgerline/shared";
import type {
  Database,
  DatabaseConnection,
  DatabaseTransaction,
} from "../../db/client";
import { ApiProblem } from "../../lib/problem";
import { requireLedgerRead } from "../ledgers/service";
import {
  postedBalance,
  postedTransactionTotals,
} from "../transactions/balance-service";
import { requireNoActiveTransactions } from "../transactions/reference-service";
import { runFinancialWrite, type WriteIdentity } from "../writes/service";
import { nextVersion, requireVersionUpdate } from "../writes/version";
import { type AccountRow, accountRepository } from "./repo";

function accountDto(row: AccountRow, total = 0n) {
  return accountSchema.parse({
    id: row.id,
    ledgerId: row.ledgerId,
    name: row.name,
    type: row.type,
    currency: row.currency,
    openingBalance: { amount: row.openingBalance, currency: row.currency },
    balance: {
      amount: postedBalance(row.openingBalance, total),
      currency: row.currency,
    },
    archivedAt: row.archivedAt?.toISOString() ?? null,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
}
function requireAccount(row: AccountRow | undefined) {
  if (!row) throw new ApiProblem(404, "Not found", "Account not found.");
  return row;
}

export async function listAccounts(
  db: Database,
  actorId: string,
  ledgerId: string,
  query: AccountListQuery,
) {
  return db.transaction(
    async (tx) => {
      await requireLedgerRead(tx, actorId, ledgerId);
      const rows = await accountRepository(tx, ledgerId).list(query);
      const page = rows.slice(0, query.limit);
      const totals = await postedTransactionTotals(
        tx,
        ledgerId,
        page.map((row) => row.id),
      );
      return {
        items: page.map((row) => accountDto(row, totals.get(row.id))),
        nextCursor:
          rows.length > query.limit ? (page.at(-1)?.id ?? null) : null,
      };
    },
    { isolationLevel: "repeatable read" },
  );
}
export async function getAccount(
  db: Database,
  actorId: string,
  ledgerId: string,
  id: string,
) {
  return db.transaction(
    async (tx) => {
      await requireLedgerRead(tx, actorId, ledgerId);
      return accountWithBalance(
        tx,
        ledgerId,
        requireAccount(await accountRepository(tx, ledgerId).find(id)),
      );
    },
    { isolationLevel: "repeatable read" },
  );
}
export function createAccount(
  db: Database,
  identity: WriteIdentity,
  body: CreateAccount,
) {
  return runFinancialWrite(
    db,
    { ...identity, operation: "POST accounts", request: body },
    async ({ tx, ledgerId }) => ({
      status: 201,
      body: accountDto(
        requireAccount(await accountRepository(tx, ledgerId).create(body)),
      ),
    }),
  );
}
export function updateAccount(
  db: Database,
  identity: WriteIdentity,
  id: string,
  body: UpdateAccount,
) {
  return runFinancialWrite(
    db,
    {
      ...identity,
      operation: `PATCH accounts/${id}`,
      request: {
        expectedVersion: body.expectedVersion,
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.type !== undefined ? { type: body.type } : {}),
        ...(body.openingBalance !== undefined
          ? { openingBalance: body.openingBalance }
          : {}),
      },
    },
    async ({ tx, ledgerId }) => {
      const repo = accountRepository(tx, ledgerId);
      const current = requireAccount(await repo.find(id));
      const version = nextVersion(current.version, body.expectedVersion);
      const updated = requireVersionUpdate(
        await repo.update(id, body, version),
      );
      return {
        status: 200,
        body: await accountWithBalance(tx, ledgerId, updated),
      };
    },
  );
}
export function archiveAccount(
  db: Database,
  identity: WriteIdentity,
  id: string,
  body: ArchiveAccount,
) {
  return runFinancialWrite(
    db,
    { ...identity, operation: `POST accounts/${id}/archive`, request: body },
    async ({ tx, ledgerId }) => {
      const repo = accountRepository(tx, ledgerId);
      const current = requireAccount(await repo.find(id));
      const version = nextVersion(current.version, body.expectedVersion);
      if (current.archivedAt)
        throw new ApiProblem(
          409,
          "Conflict",
          "This account is already archived.",
        );
      const archived = requireVersionUpdate(
        await repo.archive(id, body.expectedVersion, version),
      );
      return {
        status: 200,
        body: await accountWithBalance(tx, ledgerId, archived),
      };
    },
  );
}

export function unarchiveAccount(
  db: Database,
  identity: WriteIdentity,
  id: string,
  body: ArchiveAccount,
) {
  return runFinancialWrite(
    db,
    { ...identity, operation: `POST accounts/${id}/unarchive`, request: body },
    async ({ tx, ledgerId }) => {
      const repo = accountRepository(tx, ledgerId);
      const current = requireAccount(await repo.find(id));
      const version = nextVersion(current.version, body.expectedVersion);
      if (!current.archivedAt)
        throw new ApiProblem(409, "Conflict", "This account is not archived.");
      const restored = requireVersionUpdate(
        await repo.unarchive(id, body.expectedVersion, version),
      );
      return {
        status: 200,
        body: await accountWithBalance(tx, ledgerId, restored),
      };
    },
  );
}

async function accountWithBalance(
  db: DatabaseConnection,
  ledgerId: string,
  row: AccountRow,
) {
  const totals = await postedTransactionTotals(db, ledgerId, [row.id]);
  return accountDto(row, totals.get(row.id));
}
/** Lock account rows in sorted order inside a financial transaction to serialize archive and balance changes. */
export async function lockTransactionAccounts(
  tx: DatabaseTransaction,
  ledgerId: string,
  ids: string[],
) {
  const rows: AccountRow[] = [];
  for (const id of [...new Set(ids.map((id) => id.toLowerCase()))].sort())
    rows.push(
      requireAccount(
        await accountRepository(tx, ledgerId).lockForAssignment(id),
      ),
    );
  return rows;
}

export function deleteAccount(
  db: Database,
  identity: WriteIdentity,
  id: string,
  body: DeleteAccount,
) {
  return runFinancialWrite(
    db,
    {
      ...identity,
      operation: `DELETE accounts/${id.toLowerCase()}`,
      request: body,
    },
    async ({ tx, ledgerId }) => {
      const repo = accountRepository(tx, ledgerId);
      const current = requireAccount(await repo.lockForAssignment(id));
      const version = nextVersion(current.version, body.expectedVersion);
      await requireNoActiveTransactions(tx, ledgerId, "accountId", id);
      requireVersionUpdate(
        await repo.remove(id, body.expectedVersion, version),
      );
      return { status: 204, body: null };
    },
  );
}
