import type { DatabaseConnection } from "../../db/client";
import { ApiProblem } from "../../lib/problem";
import type { WriteContext } from "../writes/service";
import { nextVersion, requireVersionUpdate } from "../writes/version";
import { transactionRepository } from "./repo";
import { splitRepository } from "./split-repo";

/** Caller holds the category-ledger lock. Repositories remain owned by transactions. */
export async function categoryMergeReferences(
  db: DatabaseConnection,
  ledgerId: string,
  sourceId: string,
) {
  const transactions = await transactionRepository(
    db,
    ledgerId,
  ).categoryMergeRows(sourceId);
  const refs = await splitRepository(db, ledgerId).categoryMergeReferences(
    sourceId,
  );
  const parents = transactions.filter(
    (row) =>
      !row.deletedAt &&
      row.isSplit &&
      refs.some((line) => !line.deletedAt && line.transactionId === row.id),
  );
  const lines = parents.length
    ? await splitRepository(db, ledgerId).list(parents.map((row) => row.id))
    : [];
  lines.sort(
    (a, b) =>
      a.transactionId.localeCompare(b.transactionId) ||
      a.position - b.position ||
      a.id.localeCompare(b.id),
  );
  const direct = transactions.filter(
    (row) => row.categoryId === sourceId && !row.deletedAt,
  );
  return {
    ordinary: direct.filter((row) => !row.receivablePaymentId),
    linked: direct.filter((row) => !!row.receivablePaymentId),
    parents,
    lines,
    excludedTransactions: transactions.filter((row) => row.deletedAt),
    excludedLines: refs.filter(
      (row) =>
        row.deletedAt ||
        transactions.some(
          (parent) => parent.id === row.transactionId && parent.deletedAt,
        ),
    ),
  };
}
export type CategoryMergeReferences = Awaited<
  ReturnType<typeof categoryMergeReferences>
>;

/** Category-only updates preserve all financial fields; each split parent advances once. */
export async function mergeUnlinkedCategoryReferences(
  c: WriteContext,
  sourceId: string,
  destinationId: string,
  refs: CategoryMergeReferences,
) {
  const repo = transactionRepository(c.tx, c.ledgerId),
    split = splitRepository(c.tx, c.ledgerId);
  for (const row of [...refs.ordinary, ...refs.parents].sort((a, b) =>
    a.id.localeCompare(b.id),
  )) {
    const current = await repo.find(row.id, true);
    if (
      !current ||
      current.version !== row.version ||
      current.receivablePaymentId ||
      current.transferId
    )
      throw new ApiProblem(
        409,
        "Conflict",
        "Reload the category merge preview.",
      );
    const updated = requireVersionUpdate(
      await repo.recategorize(
        row.id,
        row.version,
        row.isSplit ? null : destinationId,
        nextVersion(row.version, row.version),
        new Date(),
      ),
    );
    if (row.isSplit) {
      const changed = await split.recategorize(
        updated,
        sourceId,
        destinationId,
      );
      if (
        changed.length !==
        refs.lines.filter((line) => line.transactionId === row.id).length
      )
        throw new ApiProblem(
          409,
          "Conflict",
          "Reload the category merge preview.",
        );
    }
  }
}

/** Receivables owns the parent/payment locks and invokes this hook for one live pair. */
export async function mergePaymentCategory(
  c: WriteContext,
  input: {
    transactionId: string;
    paymentId: string;
    receivableId: string;
    expectedVersion: number;
    sourceId: string;
    destinationId: string;
  },
) {
  const repo = transactionRepository(c.tx, c.ledgerId),
    row = await repo.find(input.transactionId, true);
  if (
    !row ||
    row.receivablePaymentId !== input.paymentId ||
    row.receivableId !== input.receivableId ||
    row.categoryId !== input.sourceId ||
    row.isSplit ||
    row.kind !== "income"
  )
    throw new ApiProblem(409, "Conflict", "Reload the category merge preview.");
  requireVersionUpdate(
    await repo.recategorize(
      row.id,
      input.expectedVersion,
      input.destinationId,
      nextVersion(row.version, input.expectedVersion),
      new Date(),
    ),
  );
}
