import { buildApp } from "./app";
import { readConfig } from "./config";
import { createDatabase } from "./db/client";
import { applyMigrations } from "./db/migrate";
import { startJobRunner } from "./jobs/runner";
import { runTick } from "./jobs/tick";
import { provisionOwner } from "./modules/auth/owner";
import { rateFetcherFor } from "./modules/currencies/provider";

const config = readConfig();
await applyMigrations(config.DATABASE_URL);
const { db, pool } = createDatabase(config.DATABASE_URL);
await provisionOwner(db, config);
// The routes choose their own rate source from the config (buildApp's default, tested); the hourly tick gets the same
// choice and, with rates off, skips the step as well, so no single wrong line here can reach the network.
const fetchRate = rateFetcherFor(config.RATES_ENABLED);
const app = await buildApp(db, config);
const jobs = config.JOBS_ENABLED
  ? await startJobRunner({
      connectionString: config.DATABASE_URL,
      log: app.log,
      tick: (now) =>
        runTick(db, now, {
          fetchRate,
          log: app.log,
          ratesEnabled: config.RATES_ENABLED,
        }),
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
