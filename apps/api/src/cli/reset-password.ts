import { randomBytes } from "node:crypto";
import { readConfig } from "../config";
import { createDatabase } from "../db/client";
import { resetPassword } from "../modules/auth/reset-password";

// Run on the server (see infra/scripts/reset-password.sh). Without --confirm it only says what it would do.
const config = readConfig();
if (!process.argv.includes("--confirm")) {
  console.log(
    "This sets a new temporary password for the admin account and signs out every session. Run it again with --confirm.",
  );
  process.exit(1);
}
const temporary = randomBytes(15).toString("base64url");
const { db, pool } = createDatabase(config.DATABASE_URL);
try {
  const result = await resetPassword(db, config.OWNER_EMAIL, temporary);
  if (!result) {
    console.log("The configured admin account was not found; nothing changed.");
    process.exitCode = 1;
  } else {
    // Printed once, to the administrator's own terminal: it is the only way to learn it.
    console.log(
      `Temporary password for the admin: ${temporary}\nSessions ended: ${result.sessionsEnded}. Sign in with it; you will be asked to choose a new one.`,
    );
  }
} finally {
  await pool.end();
}
