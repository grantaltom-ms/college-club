import path from "node:path";
import { defineConfig } from "vitest/config";

// CI sets CLUB_TEST_DATABASE_URL. The first Postgres test in a file builds a migrated
// template database, and a busy Actions runner can take longer than Vitest's 5 second
// default before the assertions even start. A longer limit only applies then. The
// assertions themselves are unchanged. Local runs without that database stay at 5 seconds.
const postgresTests = Boolean(process.env.CLUB_TEST_DATABASE_URL);
const postgresTimeoutMs = 30_000;

export default defineConfig({
  // The same "@/" shortcut the app uses, so a test can load a page's server code directly.
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    testTimeout: postgresTests ? postgresTimeoutMs : 5_000,
    hookTimeout: postgresTests ? postgresTimeoutMs : 10_000,
  },
});
