import { defineConfig, devices } from "@playwright/test";

// The loopback runner owns server/database lifecycle. Never start a second Next
// instance here or inherit a deployment URL from another Playwright suite.
export default defineConfig({
  testDir: "./tests/classroom-browser",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 15 * 60_000,
  expect: { timeout: 20_000 },
  outputDir: "output/classroom-pilot/playwright",
  reporter: [["./tests/classroom-browser/sanitized-reporter.ts"]],
  use: {
    ...devices["Desktop Chrome"],
    locale: "zh-CN", viewport: { width: 1440, height: 1000 },
    trace: "off", video: "off", screenshot: "off", serviceWorkers: "block",
    actionTimeout: 30_000, navigationTimeout: 60_000,
  },
});
