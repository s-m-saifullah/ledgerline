import { and, asc, eq, isNull, lte, sql } from "drizzle-orm";
import type { DatabaseConnection } from "../../db/client";
import { budgets } from "../../db/schema";

export type BudgetRow = typeof budgets.$inferSelect;
/** The database stores a month as its first day. */
export const monthStart = (month: string) => `${month}-01`;

export function budgetRepository(db: DatabaseConnection, ledgerId: string) {
  const scope = and(eq(budgets.ledgerId, ledgerId), isNull(budgets.deletedAt));
  return {
    // Budget writes take this transaction lock so edits, copies and deletes never interleave.
    lock: () =>
      db.execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${`budgets:${ledgerId.toLowerCase()}`}, 0))`,
      ),
    /** Every live budget up to and including the month, oldest first, for rollover chains. */
    upTo: (month: string) =>
      db
        .select()
        .from(budgets)
        .where(and(scope, lte(budgets.month, monthStart(month))))
        .orderBy(asc(budgets.categoryId), asc(budgets.month)),
    inMonth: (month: string) =>
      db
        .select()
        .from(budgets)
        .where(and(scope, eq(budgets.month, monthStart(month))))
        .orderBy(asc(budgets.categoryId)),
    find: async (id: string) =>
      (
        await db
          .select()
          .from(budgets)
          .where(and(scope, eq(budgets.id, id)))
      )[0],
    findForMonth: async (categoryId: string, month: string) =>
      (
        await db
          .select()
          .from(budgets)
          .where(
            and(
              scope,
              eq(budgets.categoryId, categoryId),
              eq(budgets.month, monthStart(month)),
            ),
          )
      )[0],
    create: async (values: {
      categoryId: string;
      month: string;
      amount: number;
      rollover: boolean;
    }) =>
      (
        await db
          .insert(budgets)
          .values({
            ledgerId,
            categoryId: values.categoryId,
            month: monthStart(values.month),
            amount: values.amount,
            rollover: values.rollover,
          })
          .returning()
      )[0],
    update: (
      id: string,
      expectedVersion: number,
      values: Partial<Pick<BudgetRow, "amount" | "rollover" | "deletedAt">>,
      version: number,
    ) =>
      db
        .update(budgets)
        .set({ ...values, version })
        .where(
          and(scope, eq(budgets.id, id), eq(budgets.version, expectedVersion)),
        )
        .returning(),
  };
}
