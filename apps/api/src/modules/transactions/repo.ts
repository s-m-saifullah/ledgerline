import type {
  CreateTransaction,
  ExportTransactionsQuery,
  TransactionListQuery,
} from "@ledgerline/shared";
import {
  and,
  asc,
  desc,
  eq,
  gt,
  gte,
  inArray,
  isNull,
  lt,
  lte,
  or,
  sql,
} from "drizzle-orm";
import type { DatabaseConnection } from "../../db/client";
import {
  transactionSplits,
  transactions,
  transactionTags,
} from "../../db/schema";
import type { EntryPricing } from "./pricing";

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
      pricing: EntryPricing,
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
        currency: body.amount.currency,
        fxRate: pricing.fxRate,
        baseAmount: pricing.baseAmount,
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
            query.tagId
              ? sql`exists (select 1 from ${transactionTags} where ${transactionTags.ledgerId} = ${transactions.ledgerId} and ${transactionTags.transactionId} = ${transactions.id} and ${transactionTags.tagId} = ${query.tagId} and ${transactionTags.deletedAt} is null)`
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
    /**
     * One page of an export, oldest first, with each transfer as its outgoing leg only. The
     * filters mean what they mean on the list; an account filter also keeps a transfer that
     * arrives in that account.
     */
    exportPage: (
      query: ExportTransactionsQuery,
      after: { date: string; id: string } | null,
      limit: number,
    ) =>
      db
        .select()
        .from(transactions)
        .where(
          and(
            scope,
            sql`not (${transactions.kind} = 'transfer' and ${transactions.amount} > 0)`,
            after
              ? or(
                  gt(transactions.date, after.date),
                  and(
                    eq(transactions.date, after.date),
                    gt(transactions.id, after.id),
                  ),
                )
              : undefined,
            query.accountId
              ? or(
                  eq(transactions.accountId, query.accountId),
                  sql`(${transactions.kind} = 'transfer' and exists (select 1 from transactions i where i.ledger_id = ${ledgerId} and i.transfer_id = ${transactions.transferId} and i.amount > 0 and i.deleted_at is null and i.account_id = ${query.accountId}))`,
                )
              : undefined,
            query.categoryId
              ? or(
                  eq(transactions.categoryId, query.categoryId),
                  sql`exists (select 1 from ${transactionSplits} where ${transactionSplits.ledgerId} = ${transactions.ledgerId} and ${transactionSplits.transactionId} = ${transactions.id} and ${transactionSplits.categoryId} = ${query.categoryId} and ${transactionSplits.deletedAt} is null)`,
                )
              : undefined,
            query.tagId
              ? sql`exists (select 1 from ${transactionTags} where ${transactionTags.ledgerId} = ${transactions.ledgerId} and ${transactionTags.transactionId} = ${transactions.id} and ${transactionTags.tagId} = ${query.tagId} and ${transactionTags.deletedAt} is null)`
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
        .orderBy(asc(transactions.date), asc(transactions.id))
        .limit(limit),
    /** Live entries of one account in a date range, for spotting duplicates before an import. */
    importCandidates: (accountId: string, from: string, to: string) =>
      db
        .select({
          id: transactions.id,
          date: transactions.date,
          amount: transactions.amount,
        })
        .from(transactions)
        .where(
          and(
            scope,
            eq(transactions.accountId, accountId),
            gte(transactions.date, from),
            lte(transactions.date, to),
          ),
        ),
    /** Which of these ids are live entries of the ledger. */
    existingIds: async (ids: string[]) =>
      ids.length
        ? (
            await db
              .select({ id: transactions.id })
              .from(transactions)
              .where(and(scope, inArray(transactions.id, ids)))
          ).map((row) => row.id)
        : [],
    /** How many live entries each import still has. */
    importCounts: (batchIds: string[]) =>
      batchIds.length
        ? db
            .select({
              batchId: transactions.importBatchId,
              total: sql<string>`count(*)::text`,
            })
            .from(transactions)
            .where(and(scope, inArray(transactions.importBatchId, batchIds)))
            .groupBy(transactions.importBatchId)
        : Promise.resolve([]),
    /** The accounts that a batch's live entries are in now (an edit may have moved one). */
    importAccounts: (batchId: string) =>
      db
        .selectDistinct({ accountId: transactions.accountId })
        .from(transactions)
        .where(and(scope, eq(transactions.importBatchId, batchId))),
    /** Deletes every live entry of an import together. */
    removeImported: (batchId: string, deletedAt: Date) =>
      db
        .update(transactions)
        .set({
          deletedAt,
          version: sql`${transactions.version} + 1`,
        })
        .where(and(scope, eq(transactions.importBatchId, batchId)))
        .returning({ id: transactions.id }),
    /** The receiving legs of transfers (account, amount and currency). */
    transferIncoming: (transferIds: string[]) =>
      transferIds.length
        ? db
            .select({
              transferId: transactions.transferId,
              accountId: transactions.accountId,
              amount: transactions.amount,
              currency: transactions.currency,
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
    /** The tip income entry saved with a payment, deleted or not (ADR 0027). */
    tip: async (paymentId: string, lock = false) => {
      const query = db
        .select()
        .from(transactions)
        .where(
          and(
            eq(transactions.ledgerId, ledgerId),
            eq(transactions.tipPaymentId, paymentId),
          ),
        );
      return (await (lock ? query.for("update") : query))[0];
    },
    createTip: async (
      paymentId: string,
      input: {
        accountId: string;
        categoryId: string;
        amount: number;
        currency: string;
        date: string;
        time: string | null;
        payee: string | null;
      },
      pricing: EntryPricing,
    ) =>
      (
        await db
          .insert(transactions)
          .values({
            ledgerId,
            kind: "income",
            tipPaymentId: paymentId,
            accountId: input.accountId,
            categoryId: input.categoryId,
            amount: input.amount,
            currency: input.currency,
            fxRate: pricing.fxRate,
            baseAmount: pricing.baseAmount,
            date: input.date,
            time: input.time,
            payee: input.payee,
            status: "cleared",
          })
          .returning()
      )[0],
    /**
     * Delete a payment's tip with it, or bring it back with it. A restore only brings back a tip
     * that was deleted at the same moment, never one deleted on its own.
     */
    tipLifecycle: async (
      paymentId: string,
      change: { deletedAt: Date } | { restoreFrom: Date },
    ) =>
      db
        .update(transactions)
        .set({
          deletedAt: "deletedAt" in change ? change.deletedAt : null,
          version: sql`${transactions.version} + 1`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(transactions.ledgerId, ledgerId),
            eq(transactions.tipPaymentId, paymentId),
            "deletedAt" in change
              ? isNull(transactions.deletedAt)
              : eq(transactions.deletedAt, change.restoreFrom),
          ),
        )
        .returning(),
    create: async (
      body: CreateTransaction,
      pricing: EntryPricing,
      extra: { importBatchId?: string } = {},
    ) =>
      (
        await db
          .insert(transactions)
          .values({
            ...body,
            ...extra,
            ...(body.splits
              ? { createdAt: new Date(), updatedAt: new Date() }
              : {}),
            isSplit: !!body.splits,
            ledgerId,
            amount: body.amount.amount,
            currency: body.amount.currency,
            fxRate: pricing.fxRate,
            baseAmount: pricing.baseAmount,
          })
          .returning()
      )[0],
    update: (
      id: string,
      expectedVersion: number,
      body: CreateTransaction,
      version: number,
      pricing: EntryPricing,
    ) =>
      db
        .update(transactions)
        .set({
          ...body,
          isSplit: !!body.splits,
          amount: body.amount.amount,
          currency: body.amount.currency,
          fxRate: pricing.fxRate,
          baseAmount: pricing.baseAmount,
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
        select category_id,base_amount as amount from transactions where ledger_id=${ledgerId} and deleted_at is null and status='cleared' and not is_split and kind in ('expense','income') and date between ${from}::date and ${to}::date
        union all
        select s.category_id,s.base_amount as amount from transaction_splits s join transactions t on t.ledger_id=s.ledger_id and t.id=s.transaction_id where s.ledger_id=${ledgerId} and s.deleted_at is null and t.deleted_at is null and t.is_split and t.status='cleared' and t.date between ${from}::date and ${to}::date
      ) allocations group by category_id`),
    /** Cleared expense totals (negative) per category and YYYY-MM month, splits included. */
    expenseByCategoryMonth: (from: string, to: string) =>
      db.execute<{ categoryId: string; month: string; total: string }>(sql`
      select category_id as "categoryId",month,sum(amount)::text as total from (
        select category_id,to_char(date,'YYYY-MM') as month,base_amount as amount from transactions where ledger_id=${ledgerId} and deleted_at is null and status='cleared' and not is_split and kind='expense' and date between ${from}::date and ${to}::date
        union all
        select s.category_id,to_char(t.date,'YYYY-MM') as month,s.base_amount as amount from transaction_splits s join transactions t on t.ledger_id=s.ledger_id and t.id=s.transaction_id where s.ledger_id=${ledgerId} and s.deleted_at is null and t.deleted_at is null and t.is_split and t.kind='expense' and t.status='cleared' and t.date between ${from}::date and ${to}::date
      ) allocations group by category_id,month`),
    monthFlow: (from: string, to: string) =>
      db
        .select({
          kind: transactions.kind,
          // Frozen base-currency value, so mixed currencies add up (ADR 0022).
          total: sql<string>`sum(${transactions.baseAmount})::text`,
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
    /** Cleared income and expense base totals per YYYY-MM month (same rows as monthFlow). */
    flowByMonth: (from: string, to: string) =>
      db.execute<{ month: string; kind: string; total: string }>(sql`
      select to_char(date,'YYYY-MM') as month,kind,sum(base_amount)::text as total from transactions where ledger_id=${ledgerId} and deleted_at is null and status='cleared' and kind in ('income','expense') and date between ${from}::date and ${to}::date group by 1,2`),
    /**
     * Cleared amounts per account up to `to`: one row per account and YYYY-MM month from
     * `from` on, and one row per account (month null) for everything dated before `from`.
     */
    accountTotalsByMonth: (from: string, to: string) =>
      db.execute<{
        accountId: string;
        month: string | null;
        total: string;
      }>(sql`
      select account_id as "accountId",case when date<${from}::date then null else to_char(date,'YYYY-MM') end as month,sum(amount)::text as total from transactions where ledger_id=${ledgerId} and deleted_at is null and status='cleared' and date<=${to}::date group by 1,2`),
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
