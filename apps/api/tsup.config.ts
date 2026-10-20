import { defineConfig } from "tsup";

export default defineConfig({
  // The server, and the administrator's recovery command (dist/cli/reset-two-factor.js).
  entry: {
    server: "src/server.ts",
    "cli/reset-two-factor": "src/cli/reset-two-factor.ts",
  },
  format: ["esm"],
  target: "node24",
  outDir: "dist",
  clean: true,
  noExternal: ["@ledgerline/shared"],
});
