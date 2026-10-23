// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import { GET } from "../app/api/v1/[...path]/route";

afterEach(() => vi.unstubAllEnvs());

it("BFF remains disabled by default, even with a bearer", async () => {
  vi.stubEnv("HANAMARU_BFF_ENABLED", undefined);
  const response = await GET(new Request("https://example.invalid/api/v1/me", { headers: { authorization: "Bearer synthetic-fixture" } }));
  expect(response.status).toBe(404);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
});

it("Cloud Run cannot enable localhost upstream through the local switch", async () => {
  vi.stubEnv("HANAMARU_BFF_ENABLED", "true");
  vi.stubEnv("HANAMARU_BFF_LOCAL", "true");
  vi.stubEnv("K_SERVICE", "synthetic-service");
  vi.stubEnv("HANAMARU_BFF_UPSTREAM", "http://127.0.0.1:3348/api/v1");
  vi.stubEnv("HANAMARU_BFF_PUBLIC_ORIGIN", "https://example.invalid");
  const response = await GET(new Request("https://example.invalid/api/v1/me", { headers: { authorization: "Bearer synthetic-fixture" } }));
  expect(response.status).toBe(503);
});
