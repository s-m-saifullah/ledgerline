import type { DatabaseConnection } from "../../db/client";
import { transactionDto } from "./dto";
import { transactionRepository } from "./repo";
import { splitRepository } from "./split-repo";

/** Cleared income/expense for a calendar range, pending count and the latest rows. */
export async function homeTransactionOverview(
  db: DatabaseConnection,
  ledgerId: string,
  from: string,
  to: string,
  latestLimit: number,
) {
  const repo = transactionRepository(db, ledgerId);
  const flow = await repo.monthFlow(from, to);
  const sum = (kind: string) =>
    BigInt(flow.find((row) => row.kind === kind)?.total ?? "0");
  const rows = await repo.latest(latestLimit);
  const splits = rows.length
    ? await splitRepository(db, ledgerId).list(rows.map((row) => row.id))
    : [];
  const destinations = new Map(
    (
      await repo.transferDestinations(
        rows.flatMap((row) => (row.transferId ? [row.transferId] : [])),
      )
    ).map((row) => [row.transferId, row.accountId]),
  );
  return {
    income: sum("income"),
    spending: -sum("expense"),
    pendingCount: await repo.pendingCount(),
    latest: rows.map((row) => ({
      destinationAccountId: row.transferId
        ? (destinations.get(row.transferId) ?? null)
        : null,
      transaction: transactionDto(
        row,
        splits.filter((line) => line.transactionId === row.id),
      ),
    })),
  };
}
