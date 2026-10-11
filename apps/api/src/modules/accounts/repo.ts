import type {
  AccountListQuery,
  CreateAccount,
  UpdateAccount,
} from "@ledgerline/shared";
import { and, asc, eq, gt, isNotNull, isNull } from "drizzle-orm";
import type { DatabaseConnection } from "../../db/client";
import { accounts } from "../../db/schema";

export type AccountRow = typeof accounts.$inferSelect;

/** The two stored columns behind one default fee: a fixed amount or basis points (ADR 0025). */
function defaultFeeColumns(fee: CreateAccount["defaultFee"]) {
  return {
    defaultFeeAmount: fee && "amount" in fee ? fee.amount.amount : null,
    defaultFeeBps: fee && "basisPoints" in fee ? fee.basisPoints : null,
  };
}

export function accountRepository(db: DatabaseConnection, ledgerId: string) {
  const scope = and(
    eq(accounts.ledgerId, ledgerId),
    isNull(accounts.deletedAt),
  );
  return {
    list: (query: AccountListQuery) =>
      db
        .select()
        .from(accounts)
        .where(
          and(
            scope,
            query.cursor ? gt(accounts.id, query.cursor) : undefined,
            query.status === "active"
              ? isNull(accounts.archivedAt)
              : query.status === "archived"
                ? isNotNull(accounts.archivedAt)
                : undefined,
          ),
        )
        .orderBy(asc(accounts.id))
        .limit(query.limit + 1),
    all: () =>
      db.select().from(accounts).where(scope).orderBy(asc(accounts.id)),
    find: async (id: string) =>
      (
        await db
          .select()
          .from(accounts)
          .where(and(scope, eq(accounts.id, id)))
      )[0],
    lockForAssignment: async (id: string) =>
      (
        await db
          .select()
          .from(accounts)
          .where(and(scope, eq(accounts.id, id)))
          .for("update")
      )[0],
    create: async (body: CreateAccount) =>
      (
        await db
          .insert(accounts)
          .values({
            ledgerId,
            name: body.name,
            type: body.type,
            currency: body.openingBalance.currency,
            openingBalance: body.openingBalance.amount,
            inboundBonusBps: body.inboundBonusBps ?? null,
            bonusCategoryId: body.bonusCategoryId ?? null,
            feeCategoryId: body.feeCategoryId ?? null,
            ...defaultFeeColumns(body.defaultFee ?? null),
          })
          .returning()
      )[0],
    update: (id: string, body: UpdateAccount, version: number) =>
      db
        .update(accounts)
        .set({
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.type !== undefined ? { type: body.type } : {}),
          ...(body.openingBalance !== undefined
            ? { openingBalance: body.openingBalance.amount }
            : {}),
          ...(body.inboundBonusBps !== undefined
            ? { inboundBonusBps: body.inboundBonusBps }
            : {}),
          ...(body.bonusCategoryId !== undefined
            ? { bonusCategoryId: body.bonusCategoryId }
            : {}),
          ...(body.feeCategoryId !== undefined
            ? { feeCategoryId: body.feeCategoryId }
            : {}),
          ...(body.defaultFee !== undefined
            ? defaultFeeColumns(body.defaultFee)
            : {}),
          version,
        })
        .where(
          and(
            scope,
            eq(accounts.id, id),
            eq(accounts.version, body.expectedVersion),
          ),
        )
        .returning(),
    remove: (id: string, expectedVersion: number, version: number) =>
      db
        .update(accounts)
        .set({ deletedAt: new Date(), version })
        .where(
          and(
            scope,
            eq(accounts.id, id),
            eq(accounts.version, expectedVersion),
          ),
        )
        .returning(),
    archive: (id: string, expectedVersion: number, version: number) =>
      db
        .update(accounts)
        .set({ archivedAt: new Date(), version })
        .where(
          and(
            scope,
            eq(accounts.id, id),
            eq(accounts.version, expectedVersion),
            isNull(accounts.archivedAt),
          ),
        )
        .returning(),
    unarchive: (id: string, expectedVersion: number, version: number) =>
      db
        .update(accounts)
        .set({ archivedAt: null, version })
        .where(
          and(
            scope,
            eq(accounts.id, id),
            eq(accounts.version, expectedVersion),
            isNotNull(accounts.archivedAt),
          ),
        )
        .returning(),
  };
}
