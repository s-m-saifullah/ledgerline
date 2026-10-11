import { buildApp } from "./app";
import { readConfig } from "./config";
import { createDatabase } from "./db/client";
import { applyMigrations } from "./db/migrate";
import { startJobRunner } from "./jobs/runner";
import { runTick } from "./jobs/tick";
import { provisionOwner } from "./modules/auth/owner";
import { createRateProvider } from "./modules/currencies/provider";

const config = readConfig();
await applyMigrations(config.DATABASE_URL);
const { db, pool } = createDatabase(config.DATABASE_URL);
await provisionOwner(db, config);
const fetchRate = createRateProvider();
const app = await buildApp(db, config, { fetchRate });
const jobs = config.JOBS_ENABLED
  ? await startJobRunner({
      connectionString: config.DATABASE_URL,
      log: app.log,
      tick: (now) => runTick(db, now, { fetchRate, log: app.log }),
    })
  : undefined;
const close = async () => {
  await jobs?.stop();
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
