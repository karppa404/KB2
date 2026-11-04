import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/browser",
  testMatch: "**/*.pw.ts",
  use: { baseURL: "http://127.0.0.1:31849", headless: true },
  webServer: {
    command: "bun run dashboard", url: "http://127.0.0.1:31849", reuseExistingServer: false,
    env: { DASHBOARD_PORT: "31849", KALSHI_API_ID: "", KALSHI_PRIVATE_KEY: "", KALSHI_PRIVATE_KEY_PEM: "" },
  },
});
