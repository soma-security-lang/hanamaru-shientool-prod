import { defineConfig, devices } from "@playwright/test";
process.env.HANAMARU_REAL_SSO_TEST = "true";
const env = {
  HANAMARU_REAL_SSO_TEST: "true", HANAMARU_BFF_ENABLED: "true", HANAMARU_BFF_LOCAL: "true",
  HANAMARU_LOCAL_SESSION_POC: "true", HANAMARU_SESSION_STORE: "postgres", HANAMARU_LOCAL_NATIVE_API: "true",
  HANAMARU_SERVER_SSO: "true", HANAMARU_LOCAL_LONG_SESSION: "true", SSO_ISSUER: "http://127.0.0.1:3381", ALLOW_DEV_AUTH: "false",
  HANAMARU_RUNTIME_API_BASE_URL: "/api/v1", HANAMARU_BFF_UPSTREAM: "http://127.0.0.1:3382/api/v1", HANAMARU_BFF_PUBLIC_ORIGIN: "http://127.0.0.1:3383",
};
export default defineConfig({
  testDir: "./e2e", testMatch: "alignment-real-sso.spec.ts", workers: 1, retries: 0,
  reporter: [["list"], ["json", { outputFile: "../../.artifacts/alignment/real-sso-browser.json" }]],
  use: { baseURL: "http://127.0.0.1:3383", trace: "off", screenshot: "off" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], channel: "chrome" } }, { name: "webkit", use: { ...devices["Desktop Safari"] } }],
  webServer: [
    { command: "node e2e/alignment-real-sso-fixture.mjs", url: "http://127.0.0.1:3386/health", reuseExistingServer: false, env },
    { command: "pnpm exec next start --hostname 127.0.0.1 --port 3383", url: "http://127.0.0.1:3383/login", reuseExistingServer: false, env },
  ],
});
