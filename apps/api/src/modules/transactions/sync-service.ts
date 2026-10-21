import {
  formatRate,
  parseRate,
  syncSplitSchema,
  syncTransactionSchema,
  syncTransactionTagSchema,
} from "@ledgerline/shared";
import { and, eq, inArray } from "drizzle-orm";
import type { DatabaseConnection } from "../../db/client";
import {
  transactionSplits,
  transactions,
  transactionTags,
} from "../../db/schema";
import {
  changedRows,
  iso,
  mapPage,
  type SyncPosition,
} from "../../lib/sync-keyset";

/** Entries changed after `after`, deleted ones included, as the sync wire shape (ADR 0042). */
export async function syncTransactions(
  db: DatabaseConnection,
  ledgerId: string,
  after: SyncPosition | null,
  limit: number,
) {
  return mapPage(
    await changedRows(db, transactions, ledgerId, after, limit),
    (row) =>
      syncTransactionSchema.parse({
        id: row.id,
        version: row.version,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
        deletedAt: iso(row.deletedAt),
        accountId: row.accountId,
        categoryId: row.categoryId,
        kind: row.kind,
        isSplit: row.isSplit,
        date: row.date,
        time: row.time,
        amount: { amount: row.amount, currency: row.currency },
        payee: row.payee,
        note: row.note,
        transferId: row.transferId,
        relatedTransferId: row.relatedTransferId,
        feeTransferId: row.feeTransferId,
        tipPaymentId: row.tipPaymentId,
        importBatchId: row.importBatchId,
        receivablePaymentId: row.receivablePaymentId,
        receivableId: row.receivableId,
        status: row.status,
        fxRate: formatRate(parseRate(row.fxRate)),
        // The base currency is USD for every ledger today (ADR 0020).
        baseAmount: { amount: row.baseAmount, currency: "USD" },
      }),
  );
}

/** Split lines changed after `after`, in their entry's currency, as the sync wire shape. */
export async function syncSplits(
  db: DatabaseConnection,
  ledgerId: string,
  after: SyncPosition | null,
  limit: number,
) {
  const page = await changedRows(db, transactionSplits, ledgerId, after, limit);
  // A line is in its entry's currency; the entry may itself be deleted, so look it up by id regardless.
  const parents = page.rows.length
    ? await db
        .select({ id: transactions.id, currency: transactions.currency })
        .from(transactions)
        .where(
          and(
            eq(transactions.ledgerId, ledgerId),
            inArray(transactions.id, [
              ...new Set(page.rows.map((row) => row.transactionId)),
            ]),
          ),
        )
    : [];
  const currencyOf = new Map(parents.map((row) => [row.id, row.currency]));
  return mapPage(page, (row) => {
    const currency = currencyOf.get(row.transactionId);
    if (!currency) throw new Error("A split line has no entry.");
    return syncSplitSchema.parse({
      id: row.id,
      version: row.version,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      deletedAt: iso(row.deletedAt),
      transactionId: row.transactionId,
      categoryId: row.categoryId,
      kind: row.kind,
      amount: { amount: row.amount, currency },
      baseAmount: { amount: row.baseAmount, currency: "USD" },
      note: row.note,
      position: row.position,
    });
  });
}

/** Tags on entries changed after `after` (a removed tag shows as a tombstone), as the sync wire shape. */
export async function syncTransactionTags(
  db: DatabaseConnection,
  ledgerId: string,
  after: SyncPosition | null,
  limit: number,
) {
  return mapPage(
    await changedRows(db, transactionTags, ledgerId, after, limit),
    (row) =>
      syncTransactionTagSchema.parse({
        id: row.id,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
        deletedAt: iso(row.deletedAt),
        transactionId: row.transactionId,
        tagId: row.tagId,
      }),
  );
}
