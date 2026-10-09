import type { CategoryListQuery, CreateCategory } from "@ledgerline/shared";
import {
  and,
  asc,
  eq,
  getTableColumns,
  gt,
  inArray,
  isNotNull,
  isNull,
  sql,
} from "drizzle-orm";
import type { DatabaseConnection } from "../../db/client";
import { categories } from "../../db/schema";

export type CategoryRow = typeof categories.$inferSelect;
export function categoryRepository(db: DatabaseConnection, ledgerId: string) {
  const scope = and(
    eq(categories.ledgerId, ledgerId),
    isNull(categories.deletedAt),
  );
  return {
    mergeRows: () =>
      db
        .select({
          ...getTableColumns(categories),
          normalizedName: sql<string>`lower(btrim(${categories.name}))`,
        })
        .from(categories)
        .where(eq(categories.ledgerId, ledgerId))
        .orderBy(asc(categories.id)),
    lockRows: (ids: string[]) =>
      db
        .select()
        .from(categories)
        .where(and(scope, inArray(categories.id, ids)))
        .orderBy(asc(categories.id))
        .for("update"),
    // All category mutations take this transaction lock before inspecting the tree.
    // Normalize UUID casing so distinct requests cannot bypass the same ledger lock.
    lock: () =>
      db.execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${`categories:${ledgerId.toLowerCase()}`}, 0))`,
      ),
    all: () =>
      db.select().from(categories).where(scope).orderBy(asc(categories.id)),
    list: (query: CategoryListQuery) =>
      db
        .select()
        .from(categories)
        .where(
          and(
            scope,
            query.cursor ? gt(categories.id, query.cursor) : undefined,
            query.kind ? eq(categories.kind, query.kind) : undefined,
            query.status === "active"
              ? isNull(categories.archivedAt)
              : query.status === "archived"
                ? isNotNull(categories.archivedAt)
                : undefined,
          ),
        )
        .orderBy(asc(categories.id))
        .limit(query.limit + 1),
    find: async (id: string) =>
      (
        await db
          .select()
          .from(categories)
          .where(and(scope, eq(categories.id, id)))
      )[0],
    duplicate: async (
      kind: string,
      parentId: string | null,
      name: string,
      exceptId?: string,
    ) =>
      (
        await db
          .select({ id: categories.id })
          .from(categories)
          .where(
            and(
              scope,
              eq(categories.kind, kind as CategoryRow["kind"]),
              parentId
                ? eq(categories.parentId, parentId)
                : isNull(categories.parentId),
              sql`lower(btrim(${categories.name})) = lower(btrim(${name}))`,
              exceptId ? sql`${categories.id} <> ${exceptId}` : undefined,
            ),
          )
      )[0],
    create: async (body: CreateCategory, sortOrder: number) =>
      (
        await db
          .insert(categories)
          .values({ ...body, ledgerId, sortOrder })
          .returning()
      )[0],
    update: (
      id: string,
      expectedVersion: number,
      values: Partial<
        Pick<
          CategoryRow,
          | "name"
          | "parentId"
          | "icon"
          | "color"
          | "sortOrder"
          | "archivedAt"
          | "deletedAt"
        >
      >,
      version: number,
    ) =>
      db
        .update(categories)
        .set({ ...values, version })
        .where(
          and(
            scope,
            eq(categories.id, id),
            eq(categories.version, expectedVersion),
          ),
        )
        .returning(),
  };
}
