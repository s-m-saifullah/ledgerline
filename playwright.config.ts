import { defineConfig, devices } from "@playwright/test";

const storageState = "tests/e2e/.auth/owner.json";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://localhost:5173",
    trace: "off",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    {
      name: "desktop",
      dependencies: ["setup"],
      use: { ...devices["Desktop Chrome"], storageState },
    },
    {
      name: "mobile",
      dependencies: ["setup"],
      use: {
        ...devices["iPhone 13"],
        defaultBrowserType: "chromium",
        storageState,
      },
    },
  ],
  webServer: {
    command: "pnpm dev:apps",
    // Wait for the API too (through the web proxy): it creates the owner before it listens.
    url: "http://localhost:5173/api/health",
    reuseExistingServer: !process.env.CI,
    timeout: 60000,
  },
});
