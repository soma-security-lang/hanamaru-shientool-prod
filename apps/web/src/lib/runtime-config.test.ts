import { afterEach, expect, it, vi } from "vitest";
import { runtimeApiBaseUrl, runtimeSsoIssuer } from "./runtime-config";

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

it("uses the revision's explicit runtime endpoints over build-time defaults", () => {
  vi.stubEnv("NEXT_PUBLIC_API_BASE_URL", "https://old.example.invalid/api/v1");
  vi.stubEnv("NEXT_PUBLIC_SSO_ISSUER", "https://old.example.invalid");
  vi.stubGlobal("window", { __HANAMARU_RUNTIME_CONFIG: {
    apiBaseUrl: "https://review-api.example.invalid/api/v1",
    ssoIssuer: "https://review-issuer.example.invalid",
  } });
  expect(runtimeApiBaseUrl()).toBe("https://review-api.example.invalid/api/v1");
  expect(runtimeSsoIssuer()).toBe("https://review-issuer.example.invalid");
});

it("rejects a malformed runtime API path or issuer", () => {
  vi.stubGlobal("window", { __HANAMARU_RUNTIME_CONFIG: {
    apiBaseUrl: "https://review.example.invalid/admin",
    ssoIssuer: "https://review.example.invalid/callback",
  } });
  expect(runtimeApiBaseUrl).toThrow();
  expect(runtimeSsoIssuer).toThrow();
});
