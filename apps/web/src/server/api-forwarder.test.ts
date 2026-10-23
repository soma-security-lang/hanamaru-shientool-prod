// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { forwardApiRequest, type ForwarderConfig } from "./api-forwarder";

const config: ForwarderConfig = { upstream: "http://127.0.0.1:3327/api/v1", publicOrigin: "http://127.0.0.1:3317", allowLocal: true };
function request(path = "/api/v1/me", method = "GET", extra: Record<string, string> = {}) {
  return new Request(`http://127.0.0.1:3317${path}`, {
    method, headers: { authorization: "Bearer synthetic-token", origin: config.publicOrigin, ...extra },
    ...(method === "POST" ? { body: '{"expectedLockVersion":4}' } : {}),
  });
}

describe("same-origin API transport (authorization remains upstream)", () => {
  it("preserves query, body, idempotency and conflict response without retry", async () => {
    const send = vi.fn<typeof fetch>().mockResolvedValue(new Response('{"error":{"code":"CONFLICT"}}', { status: 409 }));
    const response = await forwardApiRequest(request("/api/v1/visits?cursor=a%2Bb&limit=100", "POST", { "idempotency-key": "operation-1", "if-match": "4" }), config, send);
    expect(response.status).toBe(409);
    expect(send).toHaveBeenCalledTimes(1);
    const [url, init] = send.mock.calls[0]!;
    expect(url).toBe("http://127.0.0.1:3327/api/v1/visits?cursor=a%2Bb&limit=100");
    expect(new Headers(init!.headers).get("idempotency-key")).toBe("operation-1");
    expect(new Headers(init!.headers).get("if-match")).toBe("4");
    expect(await new Response(init!.body).text()).toBe('{"expectedLockVersion":4}');
  });
  it("drops cookies, dev identity, forwarded host and actor headers", async () => {
    const send = vi.fn<typeof fetch>().mockResolvedValue(new Response("{}", { headers: { "set-cookie": "secret=1", "x-internal-secret": "hidden" } }));
    const response = await forwardApiRequest(request(undefined, "GET", { cookie: "__session=not-auth", "x-dev-role": "manager", "x-organization-id": "other", "x-forwarded-host": "evil.example" }), config, send);
    const headers = new Headers(send.mock.calls[0]![1]!.headers);
    expect([...headers.keys()].sort()).toEqual(["authorization", "x-organization-id"]);
    // Organization selection is validated by the existing API, not trusted as a role.
    expect(headers.get("x-organization-id")).toBe("other");
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(response.headers.get("x-internal-secret")).toBeNull();
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
  it.each([401, 403, 404, 409, 422, 429, 500])("preserves API status %s and field errors", async status => {
    const payload = { error: { code: "UPSTREAM_ERROR", fieldErrors: [{ field: "amount", message: "invalid" }] } };
    const send = vi.fn<typeof fetch>().mockResolvedValue(Response.json(payload, { status, headers: { "retry-after": "3" } }));
    const response = await forwardApiRequest(request(), config, send);
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual(payload);
    expect(response.headers.get("retry-after")).toBe("3");
  });
  it("rejects cookie-only authentication", async () => {
    const send = vi.fn<typeof fetch>();
    const response = await forwardApiRequest(new Request("http://127.0.0.1:3317/api/v1/me", { headers: { cookie: "__session=fake" } }), config, send);
    expect(response.status).toBe(401);
    expect(send).not.toHaveBeenCalled();
  });
  it.each(["https://evil.example", "", "null"])("rejects mutation origin %s", async origin => {
    const send = vi.fn<typeof fetch>();
    expect((await forwardApiRequest(request(undefined, "POST", { origin }), config, send)).status).toBe(403);
    expect(send).not.toHaveBeenCalled();
  });
  it.each(["/api/v1/me%2fadmin", "/api/v1//admin", "/internal/jobs"])("rejects ambiguous path %s", async path => {
    const send = vi.fn<typeof fetch>();
    expect((await forwardApiRequest(request(path), config, send)).status).toBe(400);
    expect(send).not.toHaveBeenCalled();
  });
  it.each(["http://127.0.0.1:3317/api/v1", "https://api.example/api/v1?url=x", "https://user:synthetic@example.invalid/api/v1", "http://api.example/api/v1"])("rejects invalid/recursive upstream %s", async upstream => {
    const send = vi.fn<typeof fetch>();
    expect((await forwardApiRequest(request(), { ...config, upstream }, send)).status).toBe(503);
    expect(send).not.toHaveBeenCalled();
  });
  it("does not follow redirect or leak its target", async () => {
    const send = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 302, headers: { location: "https://other.example/?secret=x" } }));
    const response = await forwardApiRequest(request(), config, send);
    expect(send.mock.calls[0]![1]!.redirect).toBe("manual");
    expect(response.status).toBe(502);
    expect(response.headers.get("location")).toBeNull();
  });
  it("reports unknown outcome without retry or raw error details", async () => {
    const send = vi.fn<typeof fetch>().mockRejectedValue(new Error("internal secret"));
    const response = await forwardApiRequest(request(undefined, "POST"), config, send);
    expect(response.status).toBe(502);
    expect(await response.text()).not.toContain("internal secret");
    expect(send).toHaveBeenCalledTimes(1);
  });
  it("preserves 204 and binary responses", async () => {
    const noContent = await forwardApiRequest(request(), config, vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 })));
    expect(noContent.status).toBe(204);
    const response = await forwardApiRequest(request(), config, vi.fn<typeof fetch>().mockResolvedValue(new Response(new Uint8Array([0, 255, 1]), { headers: { "content-type": "application/pdf" } })));
    expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([0, 255, 1]);
  });
  it("streams an encoded local object key and checksum without changing its bytes",async()=>{
    const path=`/api/v1/local-uploads/${encodeURIComponent("organizations/synthetic/visits/fixture/source.pdf")}`;
    const bytes=new Uint8Array([0,255,1]);let received:Uint8Array|undefined;
    const send=vi.fn<typeof fetch>(async(_input,init)=>{received=new Uint8Array(await new Response(init!.body).arrayBuffer());return Response.json({stored:true});});
    const input=new Request(`http://127.0.0.1:3317${path}`,{method:"PUT",headers:{authorization:"Bearer synthetic-token",origin:config.publicOrigin,"content-type":"application/pdf","x-content-sha256":"a".repeat(64)},body:bytes});
    expect((await forwardApiRequest(input,config,send)).status).toBe(200);
    expect(send.mock.calls[0]![0]).toBe(`http://127.0.0.1:3327${path}`);
    expect(new Headers(send.mock.calls[0]![1]!.headers).get("x-content-sha256")).toBe("a".repeat(64));
    expect(received).toEqual(bytes);
  });
  it.each(["organizations/../private","organizations/synthetic/%2fprivate","organizations/synthetic/\\private","organizations//private"])("refuses unsafe encoded object %s",async object=>{
    const send=vi.fn<typeof fetch>();const response=await forwardApiRequest(request(`/api/v1/local-uploads/${encodeURIComponent(object)}`,"PUT"),config,send);
    expect(response.status).toBe(400);expect(send).not.toHaveBeenCalled();
  });
  it.each([206, 416])("preserves recording range status %s and metadata", async status => {
    const send = vi.fn<typeof fetch>().mockResolvedValue(new Response(status === 206 ? new Uint8Array([1, 2]) : null, {
      status, headers: { "content-range": status === 206 ? "bytes 0-1/10" : "bytes */10", "accept-ranges": "bytes", etag: '"fixture"' },
    }));
    const response = await forwardApiRequest(request("/api/v1/recordings/fixture/file", "GET", { range: "bytes=0-1", "if-range": '"fixture"' }), config, send);
    expect(response.status).toBe(status);
    expect(response.headers.get("content-range")).toBe(status === 206 ? "bytes 0-1/10" : "bytes */10");
    expect(response.headers.get("accept-ranges")).toBe("bytes");
    const headers = new Headers(send.mock.calls[0]![1]!.headers);
    expect(headers.get("range")).toBe("bytes=0-1"); expect(headers.get("if-range")).toBe('"fixture"');
  });
});
