import { defineConfig, devices } from "@playwright/test";

process.env.HANAMARU_SESSION_TEST = "true";
export default defineConfig({
  testDir: "./e2e", testMatch: "alignment-session.spec.ts", workers: 1, retries: 0,
  reporter: [["list"], ["json", { outputFile: "../../.artifacts/alignment/session-results.json" }]],
  use: { baseURL: "http://127.0.0.1:3357", trace: "off" },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"], channel: "chrome" } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
  webServer: {
    stdout: "pipe",
    command: "pnpm exec next start --hostname 127.0.0.1 --port 3357",
    url: "http://127.0.0.1:3357/login", reuseExistingServer: false,
    env: {
      HANAMARU_BFF_ENABLED: "true", HANAMARU_BFF_LOCAL: "true", HANAMARU_LOCAL_SESSION_POC: "true",
      HANAMARU_BFF_UPSTREAM: "http://127.0.0.1:3358/api/v1",
      HANAMARU_BFF_PUBLIC_ORIGIN: "http://127.0.0.1:3357",
    },
  },
});
