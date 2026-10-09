import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

if (!existsSync(".env")) {
  console.error("Run pnpm setup first.");
  process.exit(1);
}
const database = spawnSync("pnpm", ["db:up"], { stdio: "inherit" });
if (database.status !== 0) process.exit(database.status ?? 1);
const apps = spawn("pnpm", ["dev:apps"], { stdio: "inherit" });
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => apps.kill(signal));
apps.on("exit", (code) => {
  process.exitCode = code ?? 0;
});
