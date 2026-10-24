import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // The same "@/" shortcut the app uses, so a test can load a page's server code directly.
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
