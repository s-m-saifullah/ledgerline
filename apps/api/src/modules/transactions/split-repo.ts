import {
  allocateBaseAmounts,
  newId,
  type TransactionSplit,
} from "@ledgerline/shared";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { DatabaseConnection } from "../../db/client";
import { transactionSplits } from "../../db/schema";
import type { TransactionRow } from "./repo";
export type SplitRow = typeof transactionSplits.$inferSelect;
export function splitRepository(db: DatabaseConnection, ledgerId: string) {
  const scoped = eq(transactionSplits.ledgerId, ledgerId);
  return {
    categoryMergeReferences: (categoryId: string) =>
      db
        .select()
        .from(transactionSplits)
        .where(and(scoped, eq(transactionSplits.categoryId, categoryId)))
        .orderBy(transactionSplits.id),
    recategorize: (
      parent: TransactionRow,
      sourceId: string,
      destinationId: string,
    ) =>
      db
        .update(transactionSplits)
        .set({
          categoryId: sql`CASE WHEN ${transactionSplits.categoryId} = ${sourceId} THEN ${destinationId}::uuid ELSE ${transactionSplits.categoryId} END`,
          version: parent.version,
          updatedAt: parent.updatedAt,
        })
        .where(
          and(
            scoped,
            eq(transactionSplits.transactionId, parent.id),
            isNull(transactionSplits.deletedAt),
          ),
        )
        .returning(),
    list: (ids: string[]) =>
      db
        .select()
        .from(transactionSplits)
        .where(
          and(
            scoped,
            inArray(transactionSplits.transactionId, ids),
            isNull(transactionSplits.deletedAt),
          ),
        )
        .orderBy(asc(transactionSplits.position)),
    forParent: (parent: TransactionRow) =>
      db
        .select()
        .from(transactionSplits)
        .where(
          and(
            scoped,
            eq(transactionSplits.transactionId, parent.id),
            parent.deletedAt
              ? and(
                  eq(transactionSplits.deletedAt, parent.deletedAt),
                  eq(transactionSplits.version, parent.version),
                )
              : isNull(transactionSplits.deletedAt),
          ),
        )
        .orderBy(asc(transactionSplits.position)),
    replace: async (
      parent: TransactionRow,
      lines: {
        id?: string | undefined;
        categoryId: string;
        amount: { amount: number };
        note: string | null;
      }[],
      current: SplitRow[],
    ) => {
      const now = parent.updatedAt;
      // Each line carries its share of the parent's base amount, exact to the unit.
      const bases = lines.length
        ? allocateBaseAmounts(
            parent.amount,
            parent.baseAmount,
            lines.map((line) => line.amount.amount),
          )
        : [];
      if (current.length)
        await db
          .update(transactionSplits)
          .set({ deletedAt: now, updatedAt: now, version: parent.version })
          .where(
            and(
              scoped,
              inArray(
                transactionSplits.id,
                current.map((row) => row.id),
              ),
            ),
          );
      for (const [position, line] of lines.entries()) {
        const values = {
          categoryId: line.categoryId,
          amount: line.amount.amount,
          baseAmount: bases[position] as number,
          note: line.note,
          kind: parent.kind as "expense" | "income",
          position,
          version: parent.version,
          updatedAt: now,
          deletedAt: null,
        };
        if (line.id)
          await db
            .update(transactionSplits)
            .set(values)
            .where(
              and(
                scoped,
                eq(transactionSplits.transactionId, parent.id),
                eq(transactionSplits.id, line.id),
              ),
            );
        else
          await db.insert(transactionSplits).values({
            ...values,
            id: newId(),
            ledgerId,
            transactionId: parent.id,
            createdAt: now,
          });
      }
    },
    tombstone: (
      parent: TransactionRow,
      lines: SplitRow[],
      deletedAt: Date | null,
    ) =>
      lines.length
        ? db
            .update(transactionSplits)
            .set({
              deletedAt,
              version: parent.version,
              updatedAt: parent.updatedAt,
            })
            .where(
              and(
                scoped,
                inArray(
                  transactionSplits.id,
                  lines.map((row) => row.id),
                ),
              ),
            )
        : Promise.resolve(),
    hasCategory: async (id: string) =>
      (
        await db
          .select({ id: transactionSplits.id })
          .from(transactionSplits)
          .where(
            and(
              scoped,
              eq(transactionSplits.categoryId, id),
              isNull(transactionSplits.deletedAt),
            ),
          )
          .limit(1)
      ).length > 0,
  };
}
/** A split line is always in its parent entry's currency. */
export function splitDto(row: SplitRow, currency: string): TransactionSplit {
  return {
    id: row.id,
    categoryId: row.categoryId,
    amount: { amount: row.amount, currency },
    note: row.note,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
