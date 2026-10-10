import { type CreateTransfer, newId } from "@ledgerline/shared";
import { and, asc, eq, isNull } from "drizzle-orm";
import type { DatabaseConnection } from "../../db/client";
import { transactions } from "../../db/schema";
import type { TransferPricing } from "./pricing";
export function transferRepository(db: DatabaseConnection, ledgerId: string) {
  const scope = (id: string) =>
    and(eq(transactions.ledgerId, ledgerId), eq(transactions.transferId, id));
  const values = (body: CreateTransfer) => ({
    date: body.date,
    time: body.time,
    note: body.note,
    kind: "transfer" as const,
    categoryId: null,
    payee: null,
    status: "cleared" as const,
  });
  return {
    find: async (id: string, lock = false, deleted = false) => {
      const query = db
        .select()
        .from(transactions)
        .where(
          and(scope(id), deleted ? undefined : isNull(transactions.deletedAt)),
        )
        .orderBy(asc(transactions.id));
      return lock ? query.for("update") : query;
    },
    create: (body: CreateTransfer, pricing: TransferPricing) => {
      const transferId = newId(),
        now = new Date();
      return db
        .insert(transactions)
        .values([
          {
            ...values(body),
            ledgerId,
            transferId,
            accountId: body.fromAccountId,
            amount: -pricing.sent,
            currency: pricing.fromCurrency,
            fxRate: pricing.fromRate,
            baseAmount: -pricing.baseAbs,
            createdAt: now,
            updatedAt: now,
          },
          {
            ...values(body),
            ledgerId,
            transferId,
            accountId: body.toAccountId,
            amount: pricing.received,
            currency: pricing.toCurrency,
            fxRate: pricing.toRate,
            baseAmount: pricing.baseAbs,
            createdAt: now,
            updatedAt: now,
          },
        ])
        .returning();
    },
    update: async (
      id: string,
      body: CreateTransfer,
      version: number,
      pricing: TransferPricing,
    ) => {
      const now = new Date();
      // Direction remains tied to the leg identity, including when accounts are swapped.
      const rows = await db.select().from(transactions).where(scope(id));
      for (const row of rows) {
        const outgoing = row.amount < 0;
        await db
          .update(transactions)
          .set({
            ...values(body),
            accountId: outgoing ? body.fromAccountId : body.toAccountId,
            amount: outgoing ? -pricing.sent : pricing.received,
            currency: outgoing ? pricing.fromCurrency : pricing.toCurrency,
            fxRate: outgoing ? pricing.fromRate : pricing.toRate,
            baseAmount: outgoing ? -pricing.baseAbs : pricing.baseAbs,
            version,
            updatedAt: now,
          })
          .where(and(scope(id), eq(transactions.id, row.id)));
      }
      return db.select().from(transactions).where(scope(id));
    },
    lifecycle: (id: string, deletedAt: Date | null, version: number) =>
      db
        .update(transactions)
        .set({ deletedAt, version, updatedAt: new Date() })
        .where(scope(id))
        .returning(),
  };
}
