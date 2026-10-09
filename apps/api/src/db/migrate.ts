import { resolve } from "node:path";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createDatabase } from "./client";

export async function applyMigrations(url: string) {
  const { db, pool } = createDatabase(url);
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
