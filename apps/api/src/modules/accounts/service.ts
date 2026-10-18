import {
  type AccountListQuery,
  type ArchiveAccount,
  accountSchema,
  type CreateAccount,
  type DeleteAccount,
  type JsonValue,
  type UpdateAccount,
} from "@ledgerline/shared";
import type {
  Database,
  DatabaseConnection,
  DatabaseTransaction,
} from "../../db/client";
import { ApiProblem } from "../../lib/problem";
import {
  lockTransactionCategories,
  validateTransactionCategory,
} from "../categories/service";
import { requireUsableCurrency } from "../currencies/service";
import { ledgerBaseCurrency, requireLedgerRead } from "../ledgers/service";
import {
  postedBalance,
  postedTransactionTotals,
} from "../transactions/balance-service";
import {
  requireNoActiveRules,
  requireNoActiveTransactions,
} from "../transactions/reference-service";
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
    inboundBonusBps: row.inboundBonusBps,
    bonusCategoryId: row.bonusCategoryId,
    feeCategoryId: row.feeCategoryId,
    defaultFee:
      row.defaultFeeAmount !== null
        ? { amount: { amount: row.defaultFeeAmount, currency: row.currency } }
        : row.defaultFeeBps !== null
          ? { basisPoints: row.defaultFeeBps }
          : null,
    contactId: row.contactId,
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
/** A client's balance account (ADR 0030) is kept by the lending actions, not edited by hand. */
function requireOwnAccount(row: AccountRow) {
  if (row.contactId)
    throw new ApiProblem(
      409,
      "Conflict",
      "This account tracks money lent to or borrowed from a client. Manage it from Clients.",
    );
  return row;
}

/** A bonus category must be an active income category of this ledger (ADR 0023). */
async function requireBonusCategory(
  tx: DatabaseTransaction,
  ledgerId: string,
  id: string | null | undefined,
) {
  if (!id) return;
  await lockTransactionCategories(tx, ledgerId);
  await validateTransactionCategory(tx, ledgerId, id, "income", true);
}

/** A fee category must be an active expense category of this ledger (ADR 0025). */
async function requireFeeCategory(
  tx: DatabaseTransaction,
  ledgerId: string,
  id: string | null | undefined,
) {
  if (!id) return;
  await lockTransactionCategories(tx, ledgerId);
  await validateTransactionCategory(tx, ledgerId, id, "expense", true);
}

/** A fixed default fee is in the account's own currency (ADR 0025). */
function requireFeeCurrency(
  currency: string,
  fee: CreateAccount["defaultFee"],
) {
  if (fee && "amount" in fee && fee.amount.currency !== currency)
    throw new ApiProblem(
      409,
      "Conflict",
      `This account uses ${currency}. Enter the fee in ${currency}.`,
      [
        {
          field: "defaultFee.amount.currency",
          message: `Use ${currency}, the account's currency.`,
        },
      ],
    );
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
    {
      ...identity,
      operation: "POST accounts",
      // Optional fields that were left out stay out of the saved request.
      request: JSON.parse(JSON.stringify(body)) as JsonValue,
    },
    async ({ tx, ledgerId, actorId }) => {
      // The opening balance's currency is the account's currency (USD or an added currency).
      await requireUsableCurrency(
        tx,
        ledgerId,
        await ledgerBaseCurrency(tx, actorId, ledgerId),
        body.openingBalance.currency,
      );
      await requireBonusCategory(tx, ledgerId, body.bonusCategoryId);
      await requireFeeCategory(tx, ledgerId, body.feeCategoryId);
      requireFeeCurrency(body.openingBalance.currency, body.defaultFee);
      return {
        status: 201,
        body: accountDto(
          requireAccount(await accountRepository(tx, ledgerId).create(body)),
        ),
      };
    },
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
        ...(body.inboundBonusBps !== undefined
          ? { inboundBonusBps: body.inboundBonusBps }
          : {}),
        ...(body.bonusCategoryId !== undefined
          ? { bonusCategoryId: body.bonusCategoryId }
          : {}),
        ...(body.feeCategoryId !== undefined
          ? { feeCategoryId: body.feeCategoryId }
          : {}),
        ...(body.defaultFee !== undefined
          ? { defaultFee: body.defaultFee }
          : {}),
      },
    },
    async ({ tx, ledgerId }) => {
      const repo = accountRepository(tx, ledgerId);
      const current = requireOwnAccount(requireAccount(await repo.find(id)));
      const version = nextVersion(current.version, body.expectedVersion);
      if (
        body.openingBalance &&
        body.openingBalance.currency !== current.currency
      )
        throw new ApiProblem(
          409,
          "Conflict",
          `This account uses ${current.currency}; its currency cannot change.`,
          [
            {
              field: "openingBalance.currency",
              message: `Use ${current.currency}, the account's currency.`,
            },
          ],
        );
      await requireBonusCategory(tx, ledgerId, body.bonusCategoryId);
      await requireFeeCategory(tx, ledgerId, body.feeCategoryId);
      requireFeeCurrency(current.currency, body.defaultFee);
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
      const current = requireOwnAccount(requireAccount(await repo.find(id)));
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
      const current = requireOwnAccount(requireAccount(await repo.find(id)));
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
      const current = requireOwnAccount(
        requireAccount(await repo.lockForAssignment(id)),
      );
      const version = nextVersion(current.version, body.expectedVersion);
      await requireNoActiveTransactions(tx, ledgerId, "accountId", id);
      await requireNoActiveRules(tx, ledgerId, "accountId", id);
      requireVersionUpdate(
        await repo.remove(id, body.expectedVersion, version),
      );
      return { status: 204, body: null };
    },
  );
}

export type { AccountRow };

/** The balance accounts of one client, by currency (ADR 0030). */
export function accountsForContact(
  db: DatabaseConnection,
  ledgerId: string,
  contactId: string,
  lock = false,
) {
  return accountRepository(db, ledgerId).forContact(contactId, lock);
}
export function createContactAccount(
  db: DatabaseConnection,
  ledgerId: string,
  input: {
    contactId: string;
    name: string;
    currency: string;
    openingBalance: number;
  },
) {
  return accountRepository(db, ledgerId).createForContact(input);
}
/** Changes the starting balance of a client's balance account. */
export function setContactAccountOpening(
  db: DatabaseConnection,
  ledgerId: string,
  id: string,
  expectedVersion: number,
  openingBalance: NonNullable<UpdateAccount["openingBalance"]>,
  version: number,
) {
  return accountRepository(db, ledgerId).update(
    id,
    { expectedVersion, openingBalance },
    version,
  );
}
/** A client's balance accounts carry the client's name. */
export function renameContactAccounts(
  db: DatabaseConnection,
  ledgerId: string,
  contactId: string,
  name: string,
) {
  return accountRepository(db, ledgerId).renameForContact(contactId, name);
}
/** Deletes a client's balance account once no entry uses it (ADR 0030). */
export async function removeContactAccount(
  db: DatabaseTransaction,
  ledgerId: string,
  id: string,
  expectedVersion: number,
  version: number,
) {
  await requireNoActiveTransactions(
    db,
    ledgerId,
    "accountId",
    id,
    "This loan still has entries. Delete them first.",
  );
  await requireNoActiveRules(db, ledgerId, "accountId", id);
  return accountRepository(db, ledgerId).remove(id, expectedVersion, version);
}
