import { readConfig } from "../config";
import { createDatabase } from "../db/client";
import { resetTwoFactor } from "../modules/auth/reset-two-factor";

// Run on the server (see infra/scripts/reset-two-factor.sh). Without --confirm it only says what it would do.
const config = readConfig();
if (!process.argv.includes("--confirm")) {
  console.log(
    "This turns off two-factor for the owner account and signs out every session. Run it again with --confirm.",
  );
  process.exit(1);
}
const { db, pool } = createDatabase(config.DATABASE_URL);
try {
  const result = await resetTwoFactor(db, config.OWNER_EMAIL);
  if (!result) {
    console.log("The configured owner account was not found; nothing changed.");
    process.exitCode = 1;
  } else {
    console.log(
      `Two-factor is off for the owner. Secrets removed: ${result.secretsRemoved}; sessions ended: ${result.sessionsEnded}. Sign in with the password, then set two-factor up again.`,
    );
  }
} finally {
  await pool.end();
}
