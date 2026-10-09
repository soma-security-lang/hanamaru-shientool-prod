import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SoldgraphPageRequest } from "@hanamaru/contracts";
import { soldgraphOperationKey } from "@hanamaru/market-price";
import { createSoldgraphProvider } from "./soldgraph.js";

const request: SoldgraphPageRequest = { keyword: "SYNTHETIC CAMERA X1", market: "uk", page: 1, conditions: ["used"], buyingFormat: null };
const key = soldgraphOperationKey("synthetic-search", request);
const body = { request_id: "synthetic-job-1", status: "pending", credits: 0, cached: false };
const json = (value: unknown, status = 200, headers = {}) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json", ...headers } });
function setup(response = json(body, 202), enabled = true) {
  const transport = vi.fn<typeof fetch>(async () => response.clone());
  return { transport, provider: createSoldgraphProvider({ apiKey: "synthetic-test-credential", allowExternalRequests: enabled, transport }) };
}

describe("Soldgraph transport (injected responses; all ambient network forbidden)", () => {
  beforeEach(() => vi.stubGlobal("fetch", vi.fn(() => { throw new Error("LIVE_NETWORK_FORBIDDEN"); })));
  afterEach(() => { expect(globalThis.fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals(); });

  it("refuses I/O when external requests are disabled, including with a configured key", async () => {
    const { provider, transport } = setup(json(body), false);
    await expect(provider.submit(request, key)).rejects.toThrow("EXTERNAL_DISABLED");
    expect(transport).not.toHaveBeenCalled();
  });
  it("uses the fixed usage endpoint without a search key, retaining only validated accounting fields",async()=>{
    const usage={plan:"free",used:10,limit:100,remaining:90,extra_requests:0,window:"one_time",shared_allowance:true,rate_limit_per_minute:60};
    const {provider,transport}=setup(json({...usage,private_body:"PRIVATE BODY"}));
    expect(await provider.usage()).toEqual({plan:"free",used:10,limit:100,remaining:90,extraRequests:0,window:"one_time",sharedAllowance:true,rateLimitPerMinute:60});
    expect(transport.mock.calls[0]?.[0]).toBe("https://api.soldgraph.com/v1/usage");
    expect(transport.mock.calls[0]?.[1]?.headers).toEqual({Authorization:"Bearer synthetic-test-credential",Accept:"application/json"});
  });
  it("does not call usage without explicit external-request permission",async()=>{
    const {provider,transport}=setup(json({}),false);
    await expect(provider.usage()).rejects.toThrow("EXTERNAL_DISABLED");expect(transport).not.toHaveBeenCalled();
  });
  it.each([json({plan:"free",used:0}),json(body,202),new Response(null,{status:302,headers:{location:"https://untrusted.invalid"}})])("rejects incomplete, pending and redirected usage safely",async response=>{
    await expect(setup(response).provider.usage()).rejects.toThrow("CONTRACT");
  });
  it("passes credentials only in a header, fixes host/filtering and disables redirects", async () => {
    const { provider, transport } = setup();
    expect(await provider.submit(request, key)).toMatchObject({ requestId: "synthetic-job-1", status: "pending" });
    const [url, init] = transport.mock.calls[0]!;
    expect(String(url)).toContain("https://api.soldgraph.com/v1/ebay/sold?");
    expect(String(url)).not.toContain("credential");
    expect(init).toMatchObject({ redirect: "manual", cache: "no-store", headers: { Authorization: "Bearer synthetic-test-credential", "Idempotency-Key": key } });
  });
  it("polls only the fixed host and saved ID, not provider poll_url", async () => {
    const { provider, transport } = setup(json({ ...body, poll_url: "https://untrusted.invalid/private" }));
    await provider.submit(request, key);
    await provider.poll("synthetic-job-1");
    expect(transport.mock.calls[1]?.[0]).toBe("https://api.soldgraph.com/v1/jobs/synthetic-job-1?wait=20");
    expect(() => provider.poll("../usage")).toThrow("CONTRACT");
    expect(transport).toHaveBeenCalledTimes(2);
  });
  it("rejects redirect responses without following Location", async () => {
    const { provider, transport } = setup(new Response(null, { status: 302, headers: { location: "https://untrusted.invalid" } }));
    await expect(provider.submit(request, key)).rejects.toThrow("CONTRACT");
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it.each([
    [401, "invalid_api_key", "CONFIGURATION"], [403, "account_suspended", "CONFIGURATION"],
    [429, "rate_limited", "RATE_LIMIT"], [429, "too_many_pending", "PENDING_LIMIT"], [429, "quota_exceeded", "QUOTA"],
    [503, "upstream_daily_limit", "UPSTREAM_LIMIT"], [409, "idempotency_conflict", "IDEMPOTENCY_CONFLICT"],
    [404, "request_not_found", "RESULT_UNKNOWN"], [503, "queue_full", "TRANSPORT"], [429, "future_error", "RESULT_UNKNOWN"],
  ])("classifies %s / %s without leaking raw body", async (status, code, failureClass) => {
    const { provider } = setup(json({ error: { code, message: "PRIVATE BODY WITH QUERY AND KEY" } }, Number(status), { "retry-after": "120" }));
    await expect(provider.submit(request, key)).rejects.toMatchObject({ message: failureClass, failureClass, retryAfterSeconds: 120 });
  });
  it("does not expose raw network causes", async () => {
    const transport = vi.fn<typeof fetch>().mockRejectedValue(new Error("PRIVATE QUERY AND AUTHORIZATION"));
    const provider = createSoldgraphProvider({ apiKey: "synthetic", allowExternalRequests: true, transport });
    await expect(provider.submit(request, key)).rejects.toMatchObject({ message: "TRANSPORT", failureClass: "TRANSPORT" });
    try { await provider.submit(request, key); } catch (error) { expect(String(error)).not.toContain("PRIVATE"); expect((error as Error).cause).toBeUndefined(); }
  });
  it("bounds response size and rejects non-JSON/unknown contracts", async () => {
    await expect(setup(new Response("x".repeat(2 * 1024 * 1024 + 1))).provider.submit(request, key)).rejects.toThrow("CONTRACT");
    await expect(setup(new Response("<html>private response</html>")).provider.submit(request, key)).rejects.toThrow("CONTRACT");
    await expect(setup(json({ ...body, status: "unexpected" })).provider.submit(request, key)).rejects.toThrow("CONTRACT");
  });
  it("rejects invalid credentials and operation keys before network access", async () => {
    const transport = vi.fn<typeof fetch>();
    const provider = createSoldgraphProvider({ apiKey: "", allowExternalRequests: true, transport });
    await expect(provider.submit(request, key)).rejects.toThrow("CONFIGURATION");
    expect(() => provider.submit(request, "arbitrary-key")).toThrow("IDEMPOTENCY_CONFLICT");
    expect(transport).not.toHaveBeenCalled();
  });
  it("does not mistake HTTP 200 pending or failed for a complete result", async () => {
    expect(await setup(json(body)).provider.submit(request, key)).toMatchObject({ status: "pending" });
    expect(await setup(json({ ...body, status: "failed" })).provider.submit(request, key)).toMatchObject({ status: "failed", credits: 0 });
  });
  it("aborts a hung request and returns a sanitized error", async () => {
    const transport = vi.fn<typeof fetch>((_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new Error("PRIVATE TIMEOUT")), { once: true });
    }));
    const provider = createSoldgraphProvider({ apiKey: "synthetic", allowExternalRequests: true, transport, timeoutMs: 5 });
    await expect(provider.submit(request, key)).rejects.toThrow("TRANSPORT");
  });
});
