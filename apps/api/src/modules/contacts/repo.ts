import type {
  ClientListQuery,
  CreateContact,
  UpdateContact,
} from "@ledgerline/shared";
import { and, asc, eq, gt, isNotNull, isNull, sql } from "drizzle-orm";
import type { DatabaseConnection } from "../../db/client";
import { contacts } from "../../db/schema";
export type ContactRow = typeof contacts.$inferSelect;
export function contactRepository(db: DatabaseConnection, ledgerId: string) {
  const scope = eq(contacts.ledgerId, ledgerId);
  return {
    list: (q: ClientListQuery) =>
      db
        .select()
        .from(contacts)
        .where(
          and(
            scope,
            isNull(contacts.deletedAt),
            q.cursor ? gt(contacts.id, q.cursor) : undefined,
            q.status === "active"
              ? isNull(contacts.archivedAt)
              : q.status === "archived"
                ? isNotNull(contacts.archivedAt)
                : undefined,
            q.text
              ? sql`strpos(lower(${contacts.name}),lower(${q.text})) > 0`
              : undefined,
            // Clients: created as clients, or already given a service (ADR 0030).
            q.kind === "clients"
              ? sql`(${contacts.origin} = 'client' OR EXISTS (SELECT 1 FROM receivables r WHERE r.ledger_id = ${contacts.ledgerId} AND r.contact_id = ${contacts.id} AND r.deleted_at IS NULL))`
              : undefined,
          ),
        )
        .orderBy(asc(contacts.id))
        .limit(q.limit + 1),
    find: async (id: string, lock = false) => {
      const query = db
        .select()
        .from(contacts)
        .where(and(scope, eq(contacts.id, id), isNull(contacts.deletedAt)));
      return (await (lock ? query.for("update") : query))[0];
    },
    create: async (body: CreateContact) =>
      (
        await db
          .insert(contacts)
          .values({ ...body, ledgerId })
          .returning()
      )[0],
    update: async (
      id: string,
      expectedVersion: number,
      changes: Partial<UpdateContact> & {
        archivedAt?: Date | null;
        deletedAt?: Date;
        version: number;
      },
    ) =>
      (
        await db
          .update(contacts)
          .set(changes)
          .where(
            and(
              scope,
              eq(contacts.id, id),
              isNull(contacts.deletedAt),
              eq(contacts.version, expectedVersion),
            ),
          )
          .returning()
      )[0],
  };
}
