import { defineConfig, devices } from "@playwright/test";
import { appEnv, BASE_URL, MOCK_DENI_API_PORT } from "./e2e/env";

/**
 * End-to-end tests (`pnpm test:e2e`): a production build of the app against an
 * empty Postgres database (`E2E_DATABASE_URL`, migrated in global setup) and a
 * mock Deni AI API (`e2e/mock-deni-api.ts`). See e2e/README.md.
 */
const isCI = Boolean(process.env.CI);
// `E2E_SKIP_BUILD=1` reuses the last test build in .output (only when nothing changed).
const startApp = "node .output/server/index.mjs";
const appCommand = process.env.E2E_SKIP_BUILD ? startApp : `pnpm exec vite build && ${startApp}`;

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.spec.ts",
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  workers: isCI ? 2 : undefined,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: isCI ? [["github"], ["html", { open: "never" }]] : [["list"]],
  use: {
    baseURL: BASE_URL,
    locale: "en-US",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "node e2e/mock-deni-api.ts",
      url: `http://127.0.0.1:${MOCK_DENI_API_PORT}/health`,
      env: { MOCK_DENI_API_PORT: String(MOCK_DENI_API_PORT) },
      reuseExistingServer: false,
      stdout: "ignore",
    },
    {
      command: appCommand,
      url: `${BASE_URL}/api/status/models`,
      env: appEnv(),
      reuseExistingServer: false,
      // The production build takes a few minutes on a cold cache.
      timeout: 10 * 60_000,
      stdout: isCI ? "pipe" : "ignore",
      stderr: "pipe",
    },
  ],
});
