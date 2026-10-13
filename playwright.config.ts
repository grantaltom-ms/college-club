import { defineConfig, devices } from "@playwright/test";

const PORT = 3100;
export const E2E_PASSWORD = "e2e-test-password";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    httpCredentials: { username: "ccs", password: E2E_PASSWORD },
    trace: "retain-on-failure",
    // Locally the sandbox browser path can be supplied; in CI the installed Chromium is used.
    launchOptions: process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {},
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  // Tests run against the production build, so run `npm run build` first.
  webServer: {
    command: `npx next start -p ${PORT}`,
    url: `http://localhost:${PORT}/api/dashboard`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    env: {
      DASHBOARD_PASSWORD: E2E_PASSWORD,
      // The browser tests replace /api/dashboard with sample data, so no database is touched.
      CCS_ALLOW_SAMPLE_DATA: "1",
    },
  },
});
