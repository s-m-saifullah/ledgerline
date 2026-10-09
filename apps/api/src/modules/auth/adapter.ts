import { drizzleAdapter } from "better-auth/adapters/drizzle";
import type { Database } from "../../db/client";
import * as schema from "../../db/schema";

type Adapter = ReturnType<ReturnType<typeof drizzleAdapter>>;

function hasDeletedUser(row: unknown): boolean {
  if (!row || typeof row !== "object" || !("user" in row)) return false;
  const user = row.user;
  return (
    !!user &&
    typeof user === "object" &&
    "deletedAt" in user &&
    user.deletedAt != null
  );
}

/** Better Auth's logical deletes must keep tombstones, just like financial rows. */
function withSoftDeletes(adapter: Adapter): Adapter {
  const active = (where: Parameters<Adapter["findOne"]>[0]["where"] = []) => [
    ...where,
    {
      field: "deletedAt",
      operator: "eq" as const,
      value: null,
      connector: "AND" as const,
    },
  ];
  return {
    ...adapter,
    findOne: async <T>(
      input: Parameters<Adapter["findOne"]>[0],
    ): Promise<T | null> => {
      const row = await adapter.findOne<T>({
        ...input,
        where: active(input.where),
      });
      // Better Auth joins the user when loading a session. The primary-row
      // deletedAt predicate does not filter that joined user.
      return hasDeletedUser(row) ? null : row;
    },
    findMany: async <T>(
      input: Parameters<Adapter["findMany"]>[0],
    ): Promise<T[]> =>
      (
        await adapter.findMany<T>({ ...input, where: active(input.where) })
      ).filter((row) => !hasDeletedUser(row)),
    count: (input) => adapter.count({ ...input, where: active(input.where) }),
    update: (input) => adapter.update({ ...input, where: active(input.where) }),
    updateMany: (input) =>
      adapter.updateMany({ ...input, where: active(input.where) }),
    incrementOne: (input) =>
      adapter.incrementOne({ ...input, where: active(input.where) }),
    delete: async (input) => {
      await adapter.updateMany({
        ...input,
        where: active(input.where),
        update: { deletedAt: new Date(), updatedAt: new Date() },
      });
    },
    deleteMany: (input) =>
      adapter.updateMany({
        ...input,
        where: active(input.where),
        update: { deletedAt: new Date(), updatedAt: new Date() },
      }),
    consumeOne: async <T>(
      input: Parameters<Adapter["consumeOne"]>[0],
    ): Promise<T | null> => {
      const row = await adapter.findOne<{ id: string }>({
        ...input,
        where: active(input.where),
      });
      if (!row) return null;
      return adapter.update<T>({
        model: input.model,
        where: active([{ field: "id", value: row.id }]),
        update: { deletedAt: new Date(), updatedAt: new Date() },
      });
    },
    transaction: (callback) =>
      adapter.transaction((tx) =>
        callback(withSoftDeletes({ ...tx, transaction: adapter.transaction })),
      ),
  };
}

export function authAdapter(db: Database) {
  const factory = drizzleAdapter(db, {
    provider: "pg",
    schema,
    transaction: true,
  });
  return (options: Parameters<typeof factory>[0]) =>
    withSoftDeletes(factory(options));
}
