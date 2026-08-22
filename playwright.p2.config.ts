import { defineConfig, devices } from "@playwright/test";
import { P2_FIXTURE_DATA_DIR } from "./tests/p2/browser/fixture-data";

const localBaseUrl = "http://127.0.0.1:3108";
const configuredBaseUrl = process.env.P2_BASE_URL?.trim();
const baseURL = configuredBaseUrl || localBaseUrl;

export default defineConfig({
  testDir: "./tests/p2/browser",
  globalSetup: "./tests/p2/browser/global-setup.ts",
  globalTeardown: "./tests/p2/browser/global-teardown.ts",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 30_000,
  expect: {
    timeout: 5_000,
  },
  outputDir: "output/playwright/test-results",
  reporter: [
    ["line"],
    ["html", { outputFolder: "output/playwright/report", open: "never" }],
  ],
  use: {
    baseURL,
    colorScheme: "light",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "off",
  },
  webServer: configuredBaseUrl
    ? undefined
    : {
        command: "npm run dev -- --webpack --hostname 127.0.0.1 --port 3108",
        url: `${localBaseUrl}/healthz`,
        reuseExistingServer: false,
        timeout: 120_000,
        env: {
          UAIS_APP_AUTH_PROVIDER: "local-demo",
          UAIS_APP_SESSION_SIGNING_SECRET:
            "p2-fixture-only-app-session-signing-secret",
          UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET:
            "p2-fixture-only-teacher-signing-secret",
          UAIS_TEACHING_COURSES_DATA_DIR: P2_FIXTURE_DATA_DIR,
          UAIS_LEARNING_CHATROOM_GROUPS_MODE: "on",
        },
      },
  projects: [
    {
      name: "desktop-zh-CN",
      use: {
        ...devices["Desktop Chrome"],
        locale: "zh-CN",
        viewport: { width: 1440, height: 900 },
      },
    },
    {
      name: "desktop-en-US",
      use: {
        ...devices["Desktop Chrome"],
        locale: "en-US",
        viewport: { width: 1440, height: 900 },
      },
    },
    {
      name: "mobile-zh-CN",
      use: {
        ...devices["Desktop Chrome"],
        locale: "zh-CN",
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      },
    },
    {
      name: "mobile-en-US",
      use: {
        ...devices["Desktop Chrome"],
        locale: "en-US",
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
});
