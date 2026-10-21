import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import tailwind from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

const appVersion = process.env.APP_VERSION || "dev";

/** Puts the release version into the built service worker, so each release has its own cache (ADR 0041). */
function serviceWorkerVersion(): Plugin {
  let outDir = "dist";
  return {
    name: "service-worker-version",
    apply: "build",
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    closeBundle() {
      const file = resolve(outDir, "sw.js");
      const code = readFileSync(file, "utf8");
      if (!code.includes("__APP_VERSION__"))
        throw new Error("sw.js is missing its version placeholder");
      writeFileSync(file, code.replace("__APP_VERSION__", appVersion));
    },
  };
}

export default defineConfig({
  // The release workflow passes the version tag in; local builds show "dev".
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
  },
  plugins: [react(), tailwind(), serviceWorkerVersion()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: { "/api": "http://127.0.0.1:3001" },
  },
});
