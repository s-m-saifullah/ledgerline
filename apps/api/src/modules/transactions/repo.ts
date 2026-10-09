import type {
  CreateTransaction,
  TransactionListQuery,
} from "@ledgerline/shared";
import {
  and,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  lt,
  lte,
  or,
  sql,
} from "drizzle-orm";
import type { DatabaseConnection } from "../../db/client";
import { transactionSplits, transactions } from "../../db/schema";

export type TransactionRow = typeof transactions.$inferSelect;
export function transactionRepository(
  db: DatabaseConnection,
  ledgerId: string,
) {
  const scope = and(
    eq(transactions.ledgerId, ledgerId),
    isNull(transactions.deletedAt),
  );
  return {
    categoryMergeRows: (sourceId: string) =>
      db
        .select()
        .from(transactions)
        .where(
          and(
            eq(transactions.ledgerId, ledgerId),
            or(
              eq(transactions.categoryId, sourceId),
              sql`exists (select 1 from ${transactionSplits} where ${transactionSplits.ledgerId} = ${transactions.ledgerId} and ${transactionSplits.transactionId} = ${transactions.id} and ${transactionSplits.categoryId} = ${sourceId})`,
            ),
          ),
        )
        .orderBy(transactions.id),
    recategorize: (
      id: string,
      expectedVersion: number,
      categoryId: string | null,
      version: number,
      updatedAt: Date,
    ) =>
      db
        .update(transactions)
        .set({ categoryId, version, updatedAt })
        .where(
          and(
            scope,
            eq(transactions.id, id),
            eq(transactions.version, expectedVersion),
          ),
        )
        .returning(),
    saveLinked: async (
      id: string,
      expectedVersion: number | undefined,
      body: CreateTransaction,
      link: {
        paymentId: string;
        receivableId: string;
        version: number;
        deletedAt: Date | null;
      },
    ) => {
      const fields = {
        accountId: body.accountId,
        categoryId: body.categoryId,
        kind: "income" as const,
        date: body.date,
        time: body.time ?? null,
        amount: body.amount.amount,
        currency: "USD",
        baseAmount: body.amount.amount,
        status: "cleared" as const,
        payee: body.payee,
        note: body.note,
        receivablePaymentId: link.paymentId,
        receivableId: link.receivableId,
        version: link.version,
        deletedAt: link.deletedAt,
      };
      return expectedVersion === undefined
        ? (
            await db
              .insert(transactions)
              .values({ ...fields, id, ledgerId })
              .returning()
          )[0]
        : (
            await db
              .update(transactions)
              .set(fields)
              .where(
                and(
                  eq(transactions.ledgerId, ledgerId),
                  eq(transactions.id, id),
                  eq(transactions.version, expectedVersion),
                ),
              )
              .returning()
          )[0];
    },
    list: (query: TransactionListQuery) => {
      const [date, id] = query.cursor?.split("_") ?? [];
      // Parameterized literal substring search: % and _ are ordinary user text.
      return db
        .select()
        .from(transactions)
        .where(
          and(
            scope,
            date && id
              ? or(
                  lt(transactions.date, date),
                  and(eq(transactions.date, date), lt(transactions.id, id)),
                )
              : undefined,
            query.accountId
              ? eq(transactions.accountId, query.accountId)
              : undefined,
            query.categoryId
              ? or(
                  eq(transactions.categoryId, query.categoryId),
                  sql`exists (select 1 from ${transactionSplits} where ${transactionSplits.ledgerId} = ${transactions.ledgerId} and ${transactionSplits.transactionId} = ${transactions.id} and ${transactionSplits.categoryId} = ${query.categoryId} and ${transactionSplits.deletedAt} is null)`,
                )
              : undefined,
            query.from ? gte(transactions.date, query.from) : undefined,
            query.to ? lte(transactions.date, query.to) : undefined,
            query.status ? eq(transactions.status, query.status) : undefined,
            query.kind ? eq(transactions.kind, query.kind) : undefined,
            query.text
              ? sql`(strpos(lower(coalesce(${transactions.payee}, '')), lower(${query.text})) > 0 OR strpos(lower(coalesce(${transactions.note}, '')), lower(${query.text})) > 0)`
              : undefined,
          ),
        )
        .orderBy(desc(transactions.date), desc(transactions.id))
        .limit(query.limit + 1);
    },
    find: async (id: string, lock = false, includeDeleted = false) => {
      const query = db
        .select()
        .from(transactions)
        .where(
          and(
            eq(transactions.ledgerId, ledgerId),
            includeDeleted ? undefined : isNull(transactions.deletedAt),
            eq(transactions.id, id),
          ),
        );
      return (await (lock ? query.for("update") : query))[0];
    },
    create: async (body: CreateTransaction) =>
      (
        await db
          .insert(transactions)
          .values({
            ...body,
            ...(body.splits
              ? { createdAt: new Date(), updatedAt: new Date() }
              : {}),
            isSplit: !!body.splits,
            ledgerId,
            amount: body.amount.amount,
            currency: body.amount.currency,
            baseAmount: body.amount.amount,
          })
          .returning()
      )[0],
    update: (
      id: string,
      expectedVersion: number,
      body: CreateTransaction,
      version: number,
    ) =>
      db
        .update(transactions)
        .set({
          ...body,
          isSplit: !!body.splits,
          amount: body.amount.amount,
          currency: body.amount.currency,
          baseAmount: body.amount.amount,
          version,
        })
        .where(
          and(
            scope,
            eq(transactions.id, id),
            eq(transactions.version, expectedVersion),
          ),
        )
        .returning(),
    remove: (id: string, expectedVersion: number, version: number) =>
      db
        .update(transactions)
        .set({ deletedAt: new Date(), version })
        .where(
          and(
            scope,
            eq(transactions.id, id),
            eq(transactions.version, expectedVersion),
          ),
        )
        .returning(),
    restore: (id: string, expectedVersion: number, version: number) =>
      db
        .update(transactions)
        .set({ deletedAt: null, version })
        .where(
          and(
            eq(transactions.ledgerId, ledgerId),
            eq(transactions.id, id),
            eq(transactions.version, expectedVersion),
            sql`${transactions.deletedAt} IS NOT NULL`,
          ),
        )
        .returning(),
    hasActiveReference: async (field: "accountId" | "categoryId", id: string) =>
      (
        await db
          .select({ id: transactions.id })
          .from(transactions)
          .where(and(scope, eq(transactions[field], id)))
          .limit(1)
      ).length > 0,
    categoryTotals: (from: string, to: string) =>
      db.execute<{ categoryId: string; total: string }>(sql`
      select category_id as "categoryId",sum(amount)::text as total from (
        select category_id,amount from transactions where ledger_id=${ledgerId} and deleted_at is null and status='cleared' and not is_split and kind in ('expense','income') and date between ${from}::date and ${to}::date
        union all
        select s.category_id,s.amount from transaction_splits s join transactions t on t.ledger_id=s.ledger_id and t.id=s.transaction_id where s.ledger_id=${ledgerId} and s.deleted_at is null and t.deleted_at is null and t.is_split and t.status='cleared' and t.date between ${from}::date and ${to}::date
      ) allocations group by category_id`),
    monthFlow: (from: string, to: string) =>
      db
        .select({
          kind: transactions.kind,
          total: sql<string>`sum(${transactions.amount})::text`,
        })
        .from(transactions)
        .where(
          and(
            scope,
            eq(transactions.status, "cleared"),
            inArray(transactions.kind, ["income", "expense"]),
            gte(transactions.date, from),
            lte(transactions.date, to),
          ),
        )
        .groupBy(transactions.kind),
    pendingCount: async () =>
      Number(
        (
          await db
            .select({ n: sql<string>`count(*)::text` })
            .from(transactions)
            .where(and(scope, eq(transactions.status, "pending")))
        )[0]?.n ?? 0,
      ),
    /** List order, with each transfer shown once (its outgoing leg). */
    latest: (limit: number) =>
      db
        .select()
        .from(transactions)
        .where(
          and(
            scope,
            sql`not (${transactions.kind} = 'transfer' and ${transactions.amount} > 0)`,
          ),
        )
        .orderBy(desc(transactions.date), desc(transactions.id))
        .limit(limit),
    transferDestinations: (transferIds: string[]) =>
      transferIds.length
        ? db
            .select({
              transferId: transactions.transferId,
              accountId: transactions.accountId,
            })
            .from(transactions)
            .where(
              and(
                scope,
                inArray(transactions.transferId, transferIds),
                sql`${transactions.amount} > 0`,
              ),
            )
        : Promise.resolve([]),
    postedTotals: (accountIds: string[]) =>
      db
        .select({
          accountId: transactions.accountId,
          total: sql<string>`sum(${transactions.amount})::text`,
        })
        .from(transactions)
        .where(
          and(
            scope,
            eq(transactions.status, "cleared"),
            inArray(transactions.accountId, accountIds),
          ),
        )
        .groupBy(transactions.accountId),
  };
}
