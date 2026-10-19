import type { TagListQuery } from "@ledgerline/shared";
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
import { tags } from "../../db/schema";

export type TagRow = typeof tags.$inferSelect;
export function tagRepository(db: DatabaseConnection, ledgerId: string) {
  const scope = and(eq(tags.ledgerId, ledgerId), isNull(tags.deletedAt));
  return {
    list: (query: TagListQuery) =>
      db
        .select()
        .from(tags)
        .where(
          and(
            scope,
            query.cursor ? gt(tags.id, query.cursor) : undefined,
            query.status === "active"
              ? isNull(tags.archivedAt)
              : query.status === "archived"
                ? isNotNull(tags.archivedAt)
                : undefined,
          ),
        )
        .orderBy(asc(tags.id))
        .limit(query.limit + 1),
    find: async (id: string) =>
      (
        await db
          .select()
          .from(tags)
          .where(and(scope, eq(tags.id, id)))
      )[0],
    /** Live tags with these ids, archived ones included. */
    byIds: (ids: string[]) =>
      ids.length
        ? db
            .select()
            .from(tags)
            .where(and(scope, inArray(tags.id, ids)))
        : Promise.resolve([] as TagRow[]),
    /** Live tags whose name matches any of these, ignoring case and surrounding spaces. */
    byNames: (keys: string[]) =>
      keys.length
        ? db
            .select()
            .from(tags)
            .where(
              and(
                scope,
                sql`lower(btrim(${tags.name})) in (${sql.join(
                  keys.map((key) => sql`${key}`),
                  sql`, `,
                )})`,
              ),
            )
        : Promise.resolve([] as TagRow[]),
    byName: async (name: string, exceptId?: string) =>
      (
        await db
          .select({ ...getTableColumns(tags) })
          .from(tags)
          .where(
            and(
              scope,
              sql`lower(btrim(${tags.name})) = lower(btrim(${name}))`,
              exceptId ? sql`${tags.id} <> ${exceptId}` : undefined,
            ),
          )
      )[0],
    create: async (name: string) =>
      (await db.insert(tags).values({ ledgerId, name }).returning())[0],
    update: (
      id: string,
      expectedVersion: number,
      values: Partial<Pick<TagRow, "name" | "archivedAt" | "deletedAt">>,
      version: number,
    ) =>
      db
        .update(tags)
        .set({ ...values, version })
        .where(and(scope, eq(tags.id, id), eq(tags.version, expectedVersion)))
        .returning(),
  };
}
