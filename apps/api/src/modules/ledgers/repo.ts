import { and, eq, isNull } from "drizzle-orm";
import type { DatabaseConnection } from "../../db/client";
import { ledgerMembers, ledgers } from "../../db/schema";

export function ledgerRepository(db: DatabaseConnection, userId: string) {
  const scope = and(
    eq(ledgerMembers.userId, userId),
    isNull(ledgerMembers.deletedAt),
    isNull(ledgers.deletedAt),
  );
  const select = () =>
    db
      .select({
        id: ledgers.id,
        name: ledgers.name,
        baseCurrency: ledgers.baseCurrency,
        timeZone: ledgers.timeZone,
        version: ledgers.version,
        role: ledgerMembers.role,
      })
      .from(ledgers)
      .innerJoin(ledgerMembers, eq(ledgers.id, ledgerMembers.ledgerId));
  return {
    list: () => select().where(scope),
    find: async (ledgerId: string) =>
      (await select().where(and(scope, eq(ledgers.id, ledgerId))))[0],
    setTimeZone: async (
      ledgerId: string,
      expectedVersion: number,
      timeZone: string,
      version: number,
    ) =>
      db
        .update(ledgers)
        .set({ timeZone, version })
        .where(
          and(
            eq(ledgers.id, ledgerId),
            isNull(ledgers.deletedAt),
            eq(ledgers.version, expectedVersion),
          ),
        )
        .returning({ id: ledgers.id }),
    findAndLock: async (ledgerId: string) =>
      (
        await select()
          .where(and(scope, eq(ledgers.id, ledgerId)))
          .for("share", { of: [ledgers, ledgerMembers] })
      )[0],
  };
}
