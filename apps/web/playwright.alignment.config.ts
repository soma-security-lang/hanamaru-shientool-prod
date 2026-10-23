import { defineConfig, devices } from "@playwright/test";

process.env.HANAMARU_ALIGNMENT_TEST = "true";

// Synthetic upstream only. No real authentication, DB, AI or provider request.
export default defineConfig({
  testDir: "./e2e",
  testMatch: "alignment-transport.spec.ts",
  workers: 1,
  retries: 0,
  reporter: [["list"], ["json", { outputFile: "../../.artifacts/alignment/transport-results.json" }]],
  use: { baseURL: "http://127.0.0.1:3347", trace: "off" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], channel: "chrome" } }],
  webServer: {
    command: "pnpm exec next start --hostname 127.0.0.1 --port 3347",
    url: "http://127.0.0.1:3347/login",
    reuseExistingServer: false,
    env: {
      HANAMARU_BFF_ENABLED: "true",
      HANAMARU_BFF_LOCAL: "true",
      HANAMARU_BFF_UPSTREAM: "http://127.0.0.1:3348/api/v1",
      HANAMARU_BFF_PUBLIC_ORIGIN: "http://127.0.0.1:3347",
    },
  },
});
