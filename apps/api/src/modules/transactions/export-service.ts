import type { ExportTransactionsQuery } from "@ledgerline/shared";
import type { DatabaseConnection } from "../../db/client";
import { transactionRepository } from "./repo";
import { splitRepository } from "./split-repo";

export const EXPORT_PAGE_SIZE = 1000;

/** One page of an export: entries oldest first, with their split lines and transfer receiving legs. */
export async function exportTransactionPage(
  db: DatabaseConnection,
  ledgerId: string,
  query: ExportTransactionsQuery,
  after: { date: string; id: string } | null,
) {
  const repo = transactionRepository(db, ledgerId);
  const rows = await repo.exportPage(query, after, EXPORT_PAGE_SIZE);
  const lines = rows.some((row) => row.isSplit)
    ? await splitRepository(db, ledgerId).list(
        rows.filter((row) => row.isSplit).map((row) => row.id),
      )
    : [];
  const incoming = new Map(
    (
      await repo.transferIncoming(
        rows.flatMap((row) => (row.transferId ? [row.transferId] : [])),
      )
    ).map((row) => [row.transferId, row]),
  );
  return {
    rows,
    full: rows.length === EXPORT_PAGE_SIZE,
    linesOf: (id: string) =>
      lines
        .filter((line) => line.transactionId === id)
        .sort((a, b) => a.position - b.position),
    incomingLeg: (transferId: string | null) =>
      transferId ? incoming.get(transferId) : undefined,
  };
}
