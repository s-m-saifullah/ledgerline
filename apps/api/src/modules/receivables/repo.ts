import type {
  CreateReceivable,
  EventSnapshot,
  PageQuery,
  ReceivableEvent,
  ReceivableListQuery,
} from "@ledgerline/shared";
import { and, asc, desc, eq, gt, gte, isNull, lt, lte, sql } from "drizzle-orm";
import type { DatabaseConnection } from "../../db/client";
import {
  receivableEvents,
  receivablePayments,
  receivables,
} from "../../db/schema";
export type ReceivableRow = typeof receivables.$inferSelect;
export type PaymentRow = typeof receivablePayments.$inferSelect;
const received = sql<string>`(select coalesce(sum(p.amount),0)::text from receivable_payments p where p.ledger_id=${receivables.ledgerId} and p.receivable_id=${receivables.id} and p.deleted_at is null)`;
export function receivableRepository(db: DatabaseConnection, ledgerId: string) {
  const scope = eq(receivables.ledgerId, ledgerId);
  return {
    find: async (id: string, lock = false, deleted = false) => {
      const q = db
        .select()
        .from(receivables)
        .where(
          and(
            scope,
            eq(receivables.id, id),
            deleted ? undefined : isNull(receivables.deletedAt),
          ),
        );
      return (await (lock ? q.for("update") : q))[0];
    },
    list: (q: ReceivableListQuery) =>
      db
        .select()
        .from(receivables)
        .where(
          and(
            scope,
            isNull(receivables.deletedAt),
            q.cursor ? gt(receivables.id, q.cursor) : undefined,
            q.contactId ? eq(receivables.contactId, q.contactId) : undefined,
            q.from ? gte(receivables.serviceDate, q.from) : undefined,
            q.to ? lte(receivables.serviceDate, q.to) : undefined,
            q.text
              ? sql`strpos(lower(${receivables.description}),lower(${q.text}))>0`
              : undefined,
            q.status
              ? sql`(case when written_off_at is not null then 'writtenOff' when ${received}::numeric=0 then 'unpaid' when ${received}::numeric=amount then 'paid' else 'partlyPaid' end)=${q.status}`
              : undefined,
          ),
        )
        .orderBy(asc(receivables.id))
        .limit(q.limit + 1),
    create: async (body: CreateReceivable) =>
      (
        await db
          .insert(receivables)
          .values({
            ...body,
            serviceTime: body.serviceTime ?? null,
            ledgerId,
            amount: body.amount.amount,
            currency: "USD",
          })
          .returning()
      )[0],
    update: async (
      id: string,
      version: number,
      changes: Partial<typeof receivables.$inferInsert>,
    ) =>
      (
        await db
          .update(receivables)
          .set(changes)
          .where(
            and(
              scope,
              eq(receivables.id, id),
              eq(receivables.version, version),
            ),
          )
          .returning()
      )[0],
    /** Live, unwaived services with money left, oldest service date first (ties by ID). */
    openForContact: (contactId: string) =>
      db
        .select()
        .from(receivables)
        .where(
          and(
            scope,
            eq(receivables.contactId, contactId),
            isNull(receivables.deletedAt),
            isNull(receivables.writtenOffAt),
            sql`${receivables.amount} > ${received}::numeric`,
          ),
        )
        .orderBy(asc(receivables.serviceDate), asc(receivables.id)),
    received: async (id: string) =>
      (
        await db
          .select({
            total: sql<string>`coalesce(sum(${receivablePayments.amount}),0)::text`,
          })
          .from(receivablePayments)
          .where(
            and(
              eq(receivablePayments.ledgerId, ledgerId),
              eq(receivablePayments.receivableId, id),
              isNull(receivablePayments.deletedAt),
            ),
          )
      )[0]?.total ?? "0",
    summaries: () =>
      db.execute<{ contactId: string; total: string; oldest: string | null }>(
        sql`select contact_id as "contactId",coalesce(sum(amount-${received}::numeric),0)::text as total,min(service_date)::text as oldest from receivables where ledger_id=${ledgerId} and deleted_at is null and written_off_at is null and amount>${received}::numeric group by contact_id`,
      ),
    hasContact: async (id: string) =>
      (
        await db
          .select({ id: receivables.id })
          .from(receivables)
          .where(
            and(
              scope,
              eq(receivables.contactId, id),
              isNull(receivables.deletedAt),
            ),
          )
          .limit(1)
      ).length > 0,
  };
}
export function paymentRepository(
  db: DatabaseConnection,
  ledgerId: string,
  receivableId: string,
) {
  const scope = and(
    eq(receivablePayments.ledgerId, ledgerId),
    eq(receivablePayments.receivableId, receivableId),
  );
  return {
    find: async (id: string, lock = false, deleted = false) => {
      const q = db
        .select()
        .from(receivablePayments)
        .where(
          and(
            scope,
            eq(receivablePayments.id, id),
            deleted ? undefined : isNull(receivablePayments.deletedAt),
          ),
        );
      return (await (lock ? q.for("update") : q))[0];
    },
    list: (q: PageQuery) =>
      db
        .select()
        .from(receivablePayments)
        .where(
          and(
            scope,
            isNull(receivablePayments.deletedAt),
            q.cursor ? gt(receivablePayments.id, q.cursor) : undefined,
          ),
        )
        .orderBy(asc(receivablePayments.id))
        .limit(q.limit + 1),
    hasAny: async () =>
      (
        await db
          .select({ id: receivablePayments.id })
          .from(receivablePayments)
          .where(scope)
          .limit(1)
      ).length > 0,
    hasLive: async () =>
      (
        await db
          .select({ id: receivablePayments.id })
          .from(receivablePayments)
          .where(and(scope, isNull(receivablePayments.deletedAt)))
          .limit(1)
      ).length > 0,
    create: async (input: typeof receivablePayments.$inferInsert) =>
      (
        await db
          .insert(receivablePayments)
          .values({ ...input, ledgerId, receivableId })
          .returning()
      )[0],
    update: async (
      id: string,
      version: number,
      changes: Partial<typeof receivablePayments.$inferInsert>,
    ) =>
      (
        await db
          .update(receivablePayments)
          .set(changes)
          .where(
            and(
              scope,
              eq(receivablePayments.id, id),
              eq(receivablePayments.version, version),
            ),
          )
          .returning()
      )[0],
  };
}
/** Payments created together by one person-level receipt, across services. */
export function receiptPaymentRepository(
  db: DatabaseConnection,
  ledgerId: string,
  receiptId: string,
) {
  return {
    list: (deleted: boolean) =>
      db
        .select()
        .from(receivablePayments)
        .where(
          and(
            eq(receivablePayments.ledgerId, ledgerId),
            eq(receivablePayments.receiptId, receiptId),
            deleted
              ? sql`${receivablePayments.deletedAt} is not null`
              : isNull(receivablePayments.deletedAt),
          ),
        )
        .orderBy(asc(receivablePayments.id)),
  };
}
export function eventRepository(db: DatabaseConnection, ledgerId: string) {
  return {
    add: (input: {
      contactId: string;
      receivableId: string;
      paymentId: string | null;
      transactionId: string | null;
      actorId: string;
      action: ReceivableEvent["action"];
      receivableVersion: number;
      before: EventSnapshot | null;
      after: EventSnapshot;
    }) => db.insert(receivableEvents).values({ ...input, ledgerId }),
    list: (contactId: string, q: PageQuery) =>
      db
        .select()
        .from(receivableEvents)
        .where(
          and(
            eq(receivableEvents.ledgerId, ledgerId),
            eq(receivableEvents.contactId, contactId),
            isNull(receivableEvents.deletedAt),
            q.cursor ? lt(receivableEvents.id, q.cursor) : undefined,
          ),
        )
        .orderBy(desc(receivableEvents.id))
        .limit(q.limit + 1),
  };
}
