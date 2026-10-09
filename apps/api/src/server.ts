import { buildApp } from "./app";
import { readConfig } from "./config";
import { createDatabase } from "./db/client";
import { applyMigrations } from "./db/migrate";
import { provisionOwner } from "./modules/auth/owner";

const config = readConfig();
await applyMigrations(config.DATABASE_URL);
const { db, pool } = createDatabase(config.DATABASE_URL);
await provisionOwner(db, config);
const app = await buildApp(db, config);
const close = async () => {
  await app.close();
  await pool.end();
};
process.once("SIGINT", () => {
  void close();
});
process.once("SIGTERM", () => {
  void close();
});
await app.listen({ host: config.HOST, port: config.PORT });
