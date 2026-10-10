import { and, asc, desc, eq, isNull, lte, sql } from "drizzle-orm";
import type { DatabaseConnection } from "../../db/client";
import { currencies, exchangeRates } from "../../db/schema";

export type CurrencyRow = typeof currencies.$inferSelect;
export type RateRow = typeof exchangeRates.$inferSelect;

export function currencyRepository(db: DatabaseConnection, ledgerId: string) {
  const scope = and(
    eq(currencies.ledgerId, ledgerId),
    isNull(currencies.deletedAt),
  );
  return {
    lock: () =>
      db.execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${`currencies:${ledgerId.toLowerCase()}`}, 0))`,
      ),
    list: () =>
      db.select().from(currencies).where(scope).orderBy(asc(currencies.code)),
    find: async (id: string) =>
      (
        await db
          .select()
          .from(currencies)
          .where(and(scope, eq(currencies.id, id)))
      )[0],
    findByCode: async (code: string) =>
      (
        await db
          .select()
          .from(currencies)
          .where(and(scope, eq(currencies.code, code)))
      )[0],
    create: async (code: string) =>
      (await db.insert(currencies).values({ ledgerId, code }).returning())[0],
    update: (
      id: string,
      expectedVersion: number,
      values: Partial<Pick<CurrencyRow, "deletedAt">>,
      version: number,
    ) =>
      db
        .update(currencies)
        .set({ ...values, version })
        .where(
          and(
            scope,
            eq(currencies.id, id),
            eq(currencies.version, expectedVersion),
          ),
        )
        .returning(),
  };
}

export function rateRepository(db: DatabaseConnection, ledgerId: string) {
  const scope = and(
    eq(exchangeRates.ledgerId, ledgerId),
    isNull(exchangeRates.deletedAt),
  );
  return {
    lock: () =>
      db.execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${`rates:${ledgerId.toLowerCase()}`}, 0))`,
      ),
    list: (code: string, limit: number) =>
      db
        .select()
        .from(exchangeRates)
        .where(and(scope, eq(exchangeRates.code, code)))
        .orderBy(desc(exchangeRates.date))
        .limit(limit),
    latest: async (code: string) =>
      (
        await db
          .select()
          .from(exchangeRates)
          .where(and(scope, eq(exchangeRates.code, code)))
          .orderBy(desc(exchangeRates.date))
          .limit(1)
      )[0],
    /** The newest rate on or before the date (weekends and holidays use the day before). */
    onOrBefore: async (code: string, date: string) =>
      (
        await db
          .select()
          .from(exchangeRates)
          .where(
            and(
              scope,
              eq(exchangeRates.code, code),
              lte(exchangeRates.date, date),
            ),
          )
          .orderBy(desc(exchangeRates.date))
          .limit(1)
      )[0],
    find: async (id: string) =>
      (
        await db
          .select()
          .from(exchangeRates)
          .where(and(scope, eq(exchangeRates.id, id)))
      )[0],
    findForDate: async (code: string, date: string) =>
      (
        await db
          .select()
          .from(exchangeRates)
          .where(
            and(
              scope,
              eq(exchangeRates.code, code),
              eq(exchangeRates.date, date),
            ),
          )
      )[0],
    create: async (values: {
      code: string;
      date: string;
      rate: string;
      source: "api" | "manual";
    }) =>
      (
        await db
          .insert(exchangeRates)
          .values({ ledgerId, ...values })
          .returning()
      )[0],
    update: (
      id: string,
      expectedVersion: number,
      values: Partial<Pick<RateRow, "rate" | "source" | "deletedAt">>,
      version: number,
    ) =>
      db
        .update(exchangeRates)
        .set({ ...values, version })
        .where(
          and(
            scope,
            eq(exchangeRates.id, id),
            eq(exchangeRates.version, expectedVersion),
          ),
        )
        .returning(),
  };
}
