import { writeFile } from "node:fs/promises";
import { buildApp } from "./app";
import { readConfig } from "./config";
import { createDatabase } from "./db/client";

const config = readConfig({
  ...process.env,
  NODE_ENV: "test",
  DATABASE_URL: "postgresql://localhost/unused",
  APP_URL: "http://localhost:5173",
  BETTER_AUTH_SECRET: "openapi-generation-no-real-secret-00000000",
  OWNER_EMAIL: "spec@example.com",
  OWNER_PASSWORD: "unused-spec-password",
});
const { db, pool } = createDatabase(config.DATABASE_URL);
const app = await buildApp(db, config);
await app.ready();
await writeFile(
  new URL("../../../docs/openapi.json", import.meta.url),
  `${JSON.stringify(app.swagger(), null, 2)}\n`,
);
await app.close();
await pool.end();
