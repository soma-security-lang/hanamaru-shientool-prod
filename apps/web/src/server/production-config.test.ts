import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { productionSessionConfig } from "./production-config";

const env = {
  NODE_ENV: "production", K_SERVICE: "hanamaru-pilot-web", PROVIDER_MODE: "gcp", ALLOW_DEV_AUTH: "false",
  HANAMARU_PRODUCTION_SESSION: "true", HANAMARU_BFF_ENABLED: "true", HANAMARU_RUNTIME_API_BASE_URL: "/api/v1",
  HANAMARU_PUBLIC_ORIGIN: "https://monocle-503402.firebaseapp.com",
  HANAMARU_WEB_SERVICE_ORIGIN: "https://hanamaru-pilot-web-tpqjzqidwa-an.a.run.app",
  HANAMARU_BFF_UPSTREAM: "https://hanamaru-pilot-api-tpqjzqidwa-an.a.run.app/api/v1",
  HANAMARU_DATABASE_NAME: "hanamaru", HANAMARU_DATABASE_CONNECTION_NAME: "monocle-503402:asia-northeast1:hanamaru-pilot-postgres",
  HANAMARU_SESSION_DATABASE_URL: "postgresql://session:synthetic@localhost/hanamaru?host=%2Fcloudsql%2Fmonocle-503402%3Aasia-northeast1%3Ahanamaru-pilot-postgres",
  HANAMARU_SESSION_KEYS_JSON: JSON.stringify({ activeVersion: "v1", keys: { v1: randomBytes(32).toString("hex") } }),
};
describe("production runtime policy", () => {
  it("leaves legacy auth untouched by default", () => expect(productionSessionConfig({})).toBeNull());
  it("requires an explicit session before native APIs", () => expect(() => productionSessionConfig({ HANAMARU_PRODUCTION_NATIVE_API: "true" })).toThrow("PRODUCTION_SESSION_REQUIRED"));
  it("allows only the pinned HTTPS cookie and Cloud SQL configuration", () => {
    const config = productionSessionConfig(env)!;
    expect(config.explicitSessionBootstrap).toBe(true);
    expect(config.business).toBeUndefined();
    expect(config.transportHosts).toEqual(["hanamaru-pilot-web-tpqjzqidwa-an.a.run.app"]);
  });
  it.each([
    { HANAMARU_LOCAL_SESSION_POC: "true" }, { HANAMARU_BFF_LOCAL: "true" }, { PROVIDER_MODE: "local" },
    { HANAMARU_PUBLIC_ORIGIN: "https://other.example.invalid" }, { HANAMARU_SESSION_KEYS_JSON: "{}" },
    { HANAMARU_RUNTIME_API_BASE_URL: "https://other.example.invalid/api/v1" }, { K_SERVICE: "hanamaru-pilot-stage-web" },
    { HANAMARU_PRODUCTION_NATIVE_API: "true" }, { HANAMARU_SERVER_SSO: "true" },
  ])("rejects mixed or incomplete settings: %j", change => expect(() => productionSessionConfig({ ...env, ...change })).toThrow("PRODUCTION_SESSION_CONFIGURATION_REQUIRED"));
});
