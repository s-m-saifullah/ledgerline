import tailwind from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  // The release workflow passes the version tag in; local builds show "dev".
  define: {
    __APP_VERSION__: JSON.stringify(process.env.APP_VERSION || "dev"),
  },
  plugins: [react(), tailwind()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: { "/api": "http://127.0.0.1:3001" },
  },
});
