// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { localSessionGateway } from "./local-session-runtime";
import { GET as sessionGet } from "../app/api/auth/session/route";
import { GET as apiGet } from "../app/api/v1/[...path]/route";

afterEach(() => { vi.restoreAllMocks();vi.unstubAllEnvs(); localSessionGateway(); });
function enable() {
  vi.stubEnv("HANAMARU_LOCAL_SESSION_POC", "true"); vi.stubEnv("K_SERVICE", undefined);
  vi.stubEnv("HANAMARU_BFF_ENABLED", "true"); vi.stubEnv("HANAMARU_BFF_LOCAL", "true");
  vi.stubEnv("HANAMARU_BFF_UPSTREAM", "http://127.0.0.1:3358/api/v1");
  vi.stubEnv("HANAMARU_BFF_PUBLIC_ORIGIN", "http://127.0.0.1:3357");
}
describe("local session configuration is fail closed", () => {
  it("is unavailable by default", async () => {
    vi.stubEnv("HANAMARU_LOCAL_SESSION_POC", undefined);
    expect(localSessionGateway()).toBeNull();
    expect((await sessionGet(new Request("http://127.0.0.1:3357/api/auth/session"))).status).toBe(404);
  });
  it.each([
    ["K_SERVICE", "any-cloud-run-service"], ["HANAMARU_BFF_LOCAL", "false"],
    ["HANAMARU_BFF_UPSTREAM", "https://api.example/api/v1"],
    ["HANAMARU_BFF_PUBLIC_ORIGIN", "https://public.example"],
    ["HANAMARU_BFF_UPSTREAM", "http://127.0.0.1:3357/api/v1"],
  ])("rejects %s=%s without Bearer fallback", async (name, value) => {
    enable(); vi.stubEnv(name, value);
    expect(localSessionGateway()).toBeNull();
    expect((await apiGet(new Request("http://127.0.0.1:3357/api/v1/me", { headers: { authorization: "Bearer synthetic" } }))).status).toBe(503);
  });
  it("shares only a valid local instance and drops it when disabled", () => {
    enable(); const first = localSessionGateway();
    expect(first).not.toBeNull(); expect(localSessionGateway()).toBe(first);
    vi.stubEnv("HANAMARU_LOCAL_SESSION_POC", "false"); expect(localSessionGateway()).toBeNull();
    enable(); expect(localSessionGateway()).not.toBe(first);
  });
  it("redacts store outages and never falls back to bearer",async()=>{
    enable();const gateway=localSessionGateway()!;
    vi.spyOn(gateway,"session").mockRejectedValue(new Error("private connection detail"));
    vi.spyOn(gateway,"forward").mockRejectedValue(new Error("private connection detail"));
    for(const response of [await sessionGet(new Request("http://127.0.0.1:3357/api/auth/session")),await apiGet(new Request("http://127.0.0.1:3357/api/v1/me"))]){
      expect(response.status).toBe(503);expect(await response.text()).not.toContain("private connection");
    }
  });
  it("requires persistent storage and server SSO before enabling long sessions", () => {
    enable(); vi.stubEnv("HANAMARU_LOCAL_LONG_SESSION", "true");
    vi.stubEnv("HANAMARU_SESSION_STORE", "memory"); vi.stubEnv("HANAMARU_SERVER_SSO", "true");
    expect(localSessionGateway()).toBeNull();
    vi.stubEnv("HANAMARU_SESSION_STORE", "postgres"); vi.stubEnv("HANAMARU_SERVER_SSO", "false");
    expect(localSessionGateway()).toBeNull();
  });
});
