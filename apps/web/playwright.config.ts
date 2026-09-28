import { defineConfig, devices } from "@playwright/test";

const webBaseUrl = process.env.E2E_WEB_BASE_URL ?? "http://127.0.0.1:3100";
const webUrl = new URL(webBaseUrl);
if (process.env.E2E_REMOTE !== "1" && webUrl.hostname !== "127.0.0.1") {
  throw new Error("Local E2E must use 127.0.0.1");
}
const webPort = Number(webUrl.port || "3100");
const projects =
  process.env.E2E_INCLUDE_WEBKIT === "1"
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
  webServer:
    process.env.E2E_REMOTE === "1"
      ? undefined
      : {
          command: `pnpm exec next dev --hostname 127.0.0.1 --port ${webPort}`,
          env: { HANAMARU_E2E_NEXT_DIST_DIR: ".next/e2e" },
          url: `${webBaseUrl}/__prototype`,
          reuseExistingServer: !process.env.CI,
          timeout: 120_000,
        },
});
