import { defineConfig, devices } from "@playwright/test";

const PORT = 3100;
const PORT_SWITCH_OFF = 3101;
const PORT_LIVE_SITE = 3102;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    // Locally the sandbox browser path can be supplied; in CI the installed Chromium is used.
    launchOptions: process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {},
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  // Tests run against the production build, so run `npm run build` first.
  webServer: [
    {
      command: `npx next start -p ${PORT}`,
      url: `http://localhost:${PORT}/api/dashboard`,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      env: {
        // The browser tests replace /api/dashboard with sample data, so no database is touched.
        CCS_ALLOW_SAMPLE_DATA: "1",
        // The member area's clock stands still at 1 pm Pacific on Wed Oct 28, 2026, so the tests never depend on the time of day.
        CCS_CLUB_NOW: "2026-10-28T20:00:00Z",
      },
    },
    {
      // A production build with the sample-data switch off, like the live site by default.
      // The member area and the "act as this test member" picker must not exist here.
      command: `npx next start -p ${PORT_SWITCH_OFF}`,
      url: `http://localhost:${PORT_SWITCH_OFF}/favicon.ico`,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      env: { CCS_ALLOW_SAMPLE_DATA: "", VERCEL_ENV: "" },
    },
    {
      // The worst mistake: the sample-data switch is on, but this is the live production site.
      command: `npx next start -p ${PORT_LIVE_SITE}`,
      url: `http://localhost:${PORT_LIVE_SITE}/favicon.ico`,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      env: { CCS_ALLOW_SAMPLE_DATA: "1", VERCEL_ENV: "production" },
    },
  ],
});
