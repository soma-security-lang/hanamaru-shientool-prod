import { defineConfig, devices } from "@playwright/test";

const webBaseUrl=process.env.E2E_WEB_BASE_URL??"http://127.0.0.1:3100";
const projects=process.env.E2E_INCLUDE_WEBKIT==="1"
  ? [
      { name: "chromium", use: { ...devices["Desktop Chrome"] } },
      { name: "webkit", use: { ...devices["Desktop Safari"] } },
    ]
  : [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }];

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: true,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: webBaseUrl,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects,
  webServer: process.env.E2E_REMOTE==="1"?undefined:{
    command: "pnpm exec next dev --hostname 127.0.0.1 --port 3100",
    url: `${webBaseUrl}/__prototype`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
