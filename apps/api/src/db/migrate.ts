import { resolve } from "node:path";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createDatabase } from "./client";

export async function applyMigrations(url: string) {
  // No statement or idle limit: a slow migration (building an index) must never be cut off at start-up.
  const { db, pool } = createDatabase(url, {
    statementTimeoutMillis: 0,
    idleInTransactionMillis: 0,
  });
  try {
    await migrate(db, { migrationsFolder: resolve("drizzle") });
  } finally {
    await pool.end();
  }
}
if (process.argv[1]?.endsWith("migrate.ts")) {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  await applyMigrations(process.env.DATABASE_URL);
}
