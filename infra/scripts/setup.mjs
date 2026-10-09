import { randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline/promises";

try {
  await readFile(".env");
  console.log(".env already exists; keeping your settings.");
  process.exit(0);
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
const automated = process.argv.includes("--local");
const input = createInterface({ input: process.stdin, output: process.stdout });
const email = automated
  ? "owner@example.com"
  : await input.question("Owner email: ");
input.close();
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
  throw new Error("Enter a valid email address");
const dbPassword = randomBytes(24).toString("hex");
const secret = randomBytes(48).toString("hex");
const password = randomBytes(24).toString("base64url");
await writeFile(
  ".env",
  `NODE_ENV=development\nAPP_URL=http://localhost:5173\nHOST=127.0.0.1\nPORT=3001\nPOSTGRES_USER=ledgerline\nPOSTGRES_PASSWORD=${dbPassword}\nPOSTGRES_DB=ledgerline\nPOSTGRES_PORT=5433\nDATABASE_URL=postgresql://ledgerline:${dbPassword}@127.0.0.1:5433/ledgerline\nTEST_DATABASE_URL=postgresql://ledgerline:${dbPassword}@127.0.0.1:5433/ledgerline_test\nBETTER_AUTH_SECRET=${secret}\nOWNER_EMAIL=${email}\nOWNER_NAME=Owner\nOWNER_PASSWORD=${password}\n`,
  { mode: 0o600, flag: "wx" },
);
console.log(
  "Created private .env. Read OWNER_PASSWORD in your editor to sign in, or replace it before the first pnpm dev. Existing accounts are never reset by startup.",
);
