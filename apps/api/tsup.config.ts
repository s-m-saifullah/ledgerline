import { defineConfig } from "tsup";

export default defineConfig({
  // The server, and the administrator's recovery command (dist/cli/reset-two-factor.js and dist/cli/reset-password.js).
  entry: {
    server: "src/server.ts",
    "cli/reset-two-factor": "src/cli/reset-two-factor.ts",
    "cli/reset-password": "src/cli/reset-password.ts",
  },
  format: ["esm"],
  target: "node24",
  outDir: "dist",
  clean: true,
  noExternal: ["@ledgerline/shared"],
});
