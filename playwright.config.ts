import { defineConfig, devices } from "@playwright/test";

const PORT = 3100;
const PORT_SWITCH_OFF = 3101;
const PORT_LIVE_SITE = 3102;
const PORT_POSTGRES = 3103;
const PORT_DEMO_GATE = 3104;
const PORT_LIVE_DEMO_LINK = 3105;

// The booking specs also run against a server whose records live in Postgres. That needs a local or throwaway
// Postgres (CLUB_TEST_DATABASE_URL, which CI always sets); without one, only the in-memory run happens.
const ADMIN_DB = process.env.CLUB_TEST_DATABASE_URL;
const E2E_DB = ADMIN_DB ? Object.assign(new URL(ADMIN_DB), { pathname: "/club_e2e" }).toString() : null;

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
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    ...(E2E_DB
      ? [
          {
            name: "postgres",
            testMatch: /club(-booking|-classes|-events|-staff|-checkin|-signin|-details|-import|-billing|-history|-resignations|-tours|-equipment-import|-equipment-edit|-private-boats|-pools|-damage|-practices|-incidents|-snacks|-start)?\.spec\.ts/,
            use: { ...devices["Desktop Chrome"], baseURL: `http://localhost:${PORT_POSTGRES}` },
          },
        ]
      : []),
  ],
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
        // Test-only; makes the emailed RSVP links work on this server.
        CLUB_LINK_SECRET: "playwright-only-link-secret-0001",
        // Test-only; gives the front-desk iPad a fixed private address on this server.
        CLUB_IPAD_SECRET: "playwright-only-ipad-secret-0001",
        // Test-only; invented staff who can sign in by email link on this server.
        CLUB_STAFF_LOGINS: "alex.staffer@example.org=Alex Staffer; sam.deskwell@example.org=Sam Deskwell",
        // Test-only; the board's shared password for the Financials page.
        DASHBOARD_FINANCIALS_PASSWORD: "playwright-only-financials-0001",
        // Test-only and fake; a test build must keep using the test outbox even when the real sender's settings are present,
        // so the sign-in tests fail if it ever tries to email through Resend instead.
        RESEND_API_KEY: "re_playwright_only_fake_key_0001",
        CLUB_MAIL_FROM: "Playwright Club <no-reply@example.org>",
      },
    },
    {
      // A production build with the sample-data switch off, like the live site by default.
      // The member area and the "act as this test member" picker must not exist here.
      command: `npx next start -p ${PORT_SWITCH_OFF}`,
      url: `http://localhost:${PORT_SWITCH_OFF}/favicon.ico`,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      // The iPad secret is set on purpose: even with the right secret there must be no iPad here.
      // The demo password is set on purpose too: where invented data is not allowed the keypad must not exist.
      env: { CCS_ALLOW_SAMPLE_DATA: "", VERCEL_ENV: "", CLUB_IPAD_SECRET: "playwright-only-ipad-secret-0001", CLUB_STAFF_LOGINS: "alex.staffer@example.org=Alex Staffer", CCS_DEMO_PASSWORD: "playwright-only-demo-0001" },
    },
    {
      // The worst mistake: the sample-data switch is on, but this is the live production site.
      command: `npx next start -p ${PORT_LIVE_SITE}`,
      url: `http://localhost:${PORT_LIVE_SITE}/favicon.ico`,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      // The demo password is set on purpose too: on the live site the keypad must not exist either, so nothing redirects to it.
      env: { CCS_ALLOW_SAMPLE_DATA: "1", VERCEL_ENV: "production", CLUB_IPAD_SECRET: "playwright-only-ipad-secret-0001", CLUB_STAFF_LOGINS: "alex.staffer@example.org=Alex Staffer", CCS_DEMO_PASSWORD: "playwright-only-demo-0001" },
    },
    {
      // A test build with the demo keypad on: the invented club and the public-site preview are locked behind the demo password.
      command: `npx next start -p ${PORT_DEMO_GATE}`,
      url: `http://localhost:${PORT_DEMO_GATE}/api/nav-extras`,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      env: {
        CCS_ALLOW_SAMPLE_DATA: "1",
        CCS_CLUB_NOW: "2026-10-28T20:00:00Z",
        CLUB_IPAD_SECRET: "playwright-only-ipad-secret-0003",
        CLUB_LINK_SECRET: "playwright-only-link-secret-0003",
        CLUB_STAFF_LOGINS: "alex.staffer@example.org=Alex Staffer",
        CCS_DEMO_PASSWORD: "playwright-only-demo-0001",
        RESEND_API_KEY: "re_playwright_only_fake_key_0003",
        CLUB_MAIL_FROM: "Playwright Club <no-reply@example.org>",
      },
    },
    {
      // The live site with the demo's address set: the dashboard menu links to the demo, and nothing of the reservation system runs here.
      // The sample switch is on by mistake and the password is set, on purpose, to show neither changes what the live site answers.
      command: `npx next start -p ${PORT_LIVE_DEMO_LINK}`,
      url: `http://localhost:${PORT_LIVE_DEMO_LINK}/favicon.ico`,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      env: { CCS_ALLOW_SAMPLE_DATA: "1", VERCEL_ENV: "production", CLUB_IPAD_SECRET: "playwright-only-ipad-secret-0001", CCS_DEMO_PASSWORD: "playwright-only-demo-0001", CCS_DEMO_URL: "https://demo.example.org" },
    },
    ...(E2E_DB
      ? [
          {
            // The member area on the Postgres store: a fresh migrated database, the invented club loaded on first use.
            command: `node scripts/prepare-club-db.mjs && npx next start -p ${PORT_POSTGRES}`,
            // The page needs the store, so the server is only "ready" once the database is open and the sample club is in.
            url: `http://localhost:${PORT_POSTGRES}/club/act-as`,
            reuseExistingServer: false,
            timeout: 120_000,
            env: { CCS_ALLOW_SAMPLE_DATA: "1", CCS_CLUB_NOW: "2026-10-28T20:00:00Z", CLUB_DATABASE_URL: E2E_DB, CLUB_TEST_DATABASE_URL: ADMIN_DB!, CLUB_LINK_SECRET: "playwright-only-link-secret-0002", CLUB_IPAD_SECRET: "playwright-only-ipad-secret-0002", CLUB_STAFF_LOGINS: "alex.staffer@example.org=Alex Staffer; sam.deskwell@example.org=Sam Deskwell", RESEND_API_KEY: "re_playwright_only_fake_key_0002", CLUB_MAIL_FROM: "Playwright Club <no-reply@example.org>" },
          },
        ]
      : []),
  ],
});
