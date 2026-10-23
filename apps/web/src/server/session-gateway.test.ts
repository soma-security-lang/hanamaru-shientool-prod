// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { LocalSessionGateway } from "./session-gateway";
import type { SessionStore, StoredSession } from "@hanamaru/alignment";

const config = { publicOrigin: "http://127.0.0.1:3357", upstream: "http://127.0.0.1:3358/api/v1", allowLocal: true };
const membership = "00000000-0000-4000-8000-000000000001";
const org = "00000000-0000-4000-8000-000000000002";
const credential = "Bearer synthetic-session-fixture";
const viewer = { id: membership, status: "active", roles: ["assessor"] };
const cookieOf = (response: Response) => response.headers.get("set-cookie")!.split(";")[0]!;
function req(path: string, method = "GET", headers: Record<string, string> = {}, body?: string) {
  return new Request(`${config.publicOrigin}${path}`, { method, headers: { host: new URL(config.publicOrigin).host, origin: config.publicOrigin, ...headers }, ...(body ? { body } : {}) });
}
async function bootstrap(gateway: LocalSessionGateway) {
  const response = await gateway.session(req("/api/auth/session"));
  return { cookie: cookieOf(response), csrf: (await response.json()).csrfToken as string, response };
}
async function login(gateway: LocalSessionGateway, organizationId?: string) {
  const initial = await bootstrap(gateway);
  const response = await gateway.session(req("/api/auth/session", "POST", {
    cookie: initial.cookie, "x-csrf-token": initial.csrf, authorization: credential,
    ...(organizationId ? { "x-organization-id": organizationId } : {}),
  }));
  expect(response.status).toBe(200);
  return { cookie: cookieOf(response), csrf: (await response.json()).csrfToken as string, initial, response };
}
function fixture(now: () => number = Date.now) {
  const send = vi.fn<typeof fetch>().mockImplementation(async url => String(url).endsWith("/me") ? Response.json(viewer) : Response.json({ saved: true }));
  const gateway = new LocalSessionGateway(config, send, now);
  return { send, gateway };
}

describe("local-only server session boundary", () => {
  it("accepts Next internal URL only with the configured Host and rejects forwarded host spoofing", async () => {
    const { gateway } = fixture();
    expect((await gateway.session(new Request("http://localhost:3357/api/auth/session", {
      headers: { host: "127.0.0.1:3357" },
    }))).status).toBe(200);
    expect((await gateway.session(req("/api/auth/session", "GET", {
      host: "evil.invalid", "x-forwarded-host": "127.0.0.1:3357",
    }))).status).toBe(403);
  });
  it("issues opaque HttpOnly cookie, rotates on login, and does not expose credentials", async () => {
    // Cookie Max-Age is deliberately floored against the absolute deadline.
    // Use the injected clock instead of depending on a sub-millisecond login.
    const { gateway } = fixture(() => 1_700_000_000_000);
    const logged = await login(gateway);
    expect(logged.cookie).not.toBe(logged.initial.cookie);
    expect(logged.csrf).not.toBe(logged.initial.csrf);
    expect(logged.response.headers.get("set-cookie")).toContain("HttpOnly; SameSite=Lax; Max-Age=300");
    expect(logged.response.headers.get("cache-control")).toBe("private, no-store");
    expect(logged.cookie).not.toContain("fixture");
    expect((await gateway.forward(req("/api/v1/visits", "GET", { cookie: logged.initial.cookie }))).status).toBe(401);
    const refreshed = await gateway.session(req("/api/auth/session", "GET", { cookie: logged.cookie }));
    expect(await refreshed.text()).not.toContain(credential);
  });
  it.each(["https://evil.example", "null", ""])("rejects login and mutation Origin %s without upstream access", async origin => {
    const { gateway, send } = fixture();
    const logged = await login(gateway); send.mockClear();
    const headers = { cookie: logged.cookie, "x-csrf-token": logged.csrf, origin };
    expect((await gateway.forward(req("/api/v1/visits", "POST", headers))).status).toBe(403);
    expect((await gateway.session(req("/api/auth/session", "POST", { ...headers, authorization: credential }))).status).toBe(403);
    expect(send).not.toHaveBeenCalled();
  });
  it("rejects absent or wrong CSRF, duplicate cookies, mixed identities and organization changes", async () => {
    const { gateway, send } = fixture();
    const logged = await login(gateway, org); send.mockClear();
    expect((await gateway.forward(req("/api/v1/visits", "POST", { cookie: logged.cookie }))).status).toBe(403);
    expect((await gateway.session(req("/api/auth/session", "DELETE", { cookie: logged.cookie, "x-csrf-token": "a".repeat(43) }))).status).toBe(403);
    expect((await gateway.forward(req("/api/v1/me", "GET", { cookie: `${logged.cookie}; ${logged.cookie}` }))).status).toBe(401);
    expect((await gateway.forward(req("/api/v1/me", "GET", { cookie: logged.cookie, authorization: credential }))).status).toBe(400);
    expect((await gateway.forward(req("/api/v1/me", "GET", { cookie: logged.cookie, "x-organization-id": membership }))).status).toBe(403);
    expect(send).not.toHaveBeenCalled();
  });
  it("revalidates membership and forwards the fixed organization without cookies or spoofed roles", async () => {
    const { gateway, send } = fixture();
    const logged = await login(gateway, org); send.mockClear();
    const response = await gateway.forward(req("/api/v1/visits", "POST", {
      cookie: logged.cookie, "x-csrf-token": logged.csrf, "idempotency-key": "operation-1", "x-dev-role": "manager",
    }, '{"expectedLockVersion":1}'));
    expect(response.status).toBe(200);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[0]![0]).toBe(`${config.upstream}/me`);
    const [, init] = send.mock.calls[1]!;
    const headers = new Headers(init!.headers);
    expect(headers.get("authorization")).toBe(credential);
    expect(headers.get("x-organization-id")).toBe(org);
    for (const key of ["cookie", "x-csrf-token", "x-dev-role"]) expect(headers.has(key)).toBe(false);
    expect(headers.get("idempotency-key")).toBe("operation-1");
    expect(await new Response(init!.body).text()).toBe('{"expectedLockVersion":1}');
  });
  it.each([401, 403])("invalidates a session on API revocation %s", async status => {
    const { gateway, send } = fixture(); const logged = await login(gateway);
    send.mockClear().mockResolvedValue(Response.json({ error: { code: "DENIED" } }, { status }));
    expect((await gateway.forward(req("/api/v1/visits", "GET", { cookie: logged.cookie }))).status).toBe(status);
    expect((await gateway.forward(req("/api/v1/visits", "GET", { cookie: logged.cookie }))).status).toBe(401);
    expect(send).toHaveBeenCalledTimes(1);
  });
  it("uses current roles, and rejects a different membership even with valid credentials", async () => {
    const { gateway, send } = fixture(); const logged = await login(gateway);
    send.mockImplementation(async () => Response.json({ ...viewer, roles: ["manager"] }));
    const refresh = await gateway.session(req("/api/auth/session", "GET", { cookie: logged.cookie }));
    expect((await refresh.json()).viewer.roles).toEqual(["manager"]);
    send.mockImplementation(async () => Response.json({ ...viewer, id: org }));
    expect((await gateway.forward(req("/api/v1/visits", "GET", { cookie: logged.cookie }))).status).toBe(401);
  });
  it("preserves session on transient identity outage but never executes a write", async () => {
    const { gateway, send } = fixture(); const logged = await login(gateway);
    send.mockClear().mockRejectedValueOnce(new Error("private error"));
    const response = await gateway.forward(req("/api/v1/visits", "POST", { cookie: logged.cookie, "x-csrf-token": logged.csrf }));
    expect(response.status).toBe(502); expect(await response.text()).not.toContain("private error");
    expect(send).toHaveBeenCalledTimes(1);
    expect((await gateway.forward(req("/api/v1/visits", "GET", { cookie: logged.cookie }))).status).toBe(200);
  });
  it("does not resend a write after unknown result", async () => {
    const { gateway, send } = fixture(); const logged = await login(gateway);
    send.mockClear().mockImplementation(async url => {
      if (String(url).endsWith("/me")) return Response.json(viewer);
      throw new Error("committed then disconnected");
    });
    const response = await gateway.forward(req("/api/v1/visits", "POST", { cookie: logged.cookie, "x-csrf-token": logged.csrf }));
    expect(response.status).toBe(502);
    expect((await response.json()).error.code).toBe("RESULT_UNKNOWN");
    expect(send.mock.calls.filter(([url]) => String(url).endsWith("/visits"))).toHaveLength(1);
  });
  it("logout clears cookie and blocks replay", async () => {
    const { gateway } = fixture(); const logged = await login(gateway);
    const response = await gateway.session(req("/api/auth/session", "DELETE", { cookie: logged.cookie, "x-csrf-token": logged.csrf }));
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
    expect((await gateway.forward(req("/api/v1/me", "GET", { cookie: logged.cookie }))).status).toBe(401);
  });
  it("expires absolutely and bounds pre-authentication capacity", async () => {
    let now = 1; const { send } = fixture();
    const gateway = new LocalSessionGateway(config, send, () => now, 1);
    const logged = await login(gateway);
    expect((await gateway.session(req("/api/auth/session"))).status).toBe(429);
    now += 300_000;
    expect((await gateway.forward(req("/api/v1/me", "GET", { cookie: logged.cookie }))).status).toBe(401);
    expect((await gateway.session(req("/api/auth/session"))).status).toBe(200);
  });
  it("consumes a pre-auth session once under concurrent exchange", async () => {
    const { gateway, send } = fixture(); const initial = await bootstrap(gateway);
    const resolvers: Array<(value: Response) => void> = [];
    send.mockImplementation(() => new Promise(resolve => resolvers.push(resolve)));
    const exchange = () => gateway.session(req("/api/auth/session", "POST", { cookie: initial.cookie, "x-csrf-token": initial.csrf, authorization: credential }));
    const a = exchange(), b = exchange();
    await vi.waitFor(() => expect(resolvers).toHaveLength(2));
    resolvers.forEach(resolve => resolve(Response.json(viewer)));
    expect((await Promise.all([a, b])).map(r => r.status).sort()).toEqual([200, 409]);
  });
  it("does not forward a write if logout occurs during membership validation", async () => {
    const { gateway, send } = fixture(); const logged = await login(gateway);
    let resolveIdentity!: (value: Response) => void;
    send.mockClear().mockImplementation(() => new Promise(resolve => { resolveIdentity = resolve; }));
    const pending = gateway.forward(req("/api/v1/visits", "POST", { cookie: logged.cookie, "x-csrf-token": logged.csrf }));
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    await gateway.session(req("/api/auth/session", "DELETE", { cookie: logged.cookie, "x-csrf-token": logged.csrf }));
    resolveIdentity(Response.json(viewer));
    expect((await pending).status).toBe(401); expect(send).toHaveBeenCalledTimes(1);
  });
  it.each([{}, { ...viewer, status: "disabled" }, { ...viewer, roles: [] }])("rejects malformed or inactive identity %j", async payload => {
    const gateway = new LocalSessionGateway(config, vi.fn<typeof fetch>().mockImplementation(async () => Response.json(payload)));
    const initial = await bootstrap(gateway);
    expect((await gateway.session(req("/api/auth/session", "POST", { cookie: initial.cookie, "x-csrf-token": initial.csrf, authorization: credential }))).status).toBe(502);
  });
});

describe("eight-hour OIDC session renewal without business replay", () => {
  function longFixture() {
    let now = Date.now();
    const rows = new Map<string, { value: StoredSession; version: number }>();
    const store: SessionStore = {
      async get(key) { const row = rows.get(key); return row && row.value.expiresAt > now ? structuredClone(row) : null; },
      async create(key, value) { rows.set(key, { value: structuredClone(value), version: 0 }); return true; },
      async replace(key, version, nextKey, value) {
        const row = rows.get(key); if (!row || row.version !== version || row.value.expiresAt <= now) return false;
        rows.delete(key); rows.set(nextKey, { value: structuredClone(value), version: version + 1 }); return true;
      },
      async remove(key) { rows.delete(key); }, async attempt() { return true; },
    };
    const send = vi.fn<typeof fetch>().mockImplementation(async url => String(url).endsWith("/me") ? Response.json(viewer) : Response.json({ saved: true }));
    const renew = vi.fn(async (session: StoredSession) => ({ credential: "Bearer synthetic-renewed", sso: { ...session.sso!, refreshToken: "synthetic-rotated", accessExpiresAt: now + 300_000 } }));
    const gateway = new LocalSessionGateway(config, send, () => now, 128, store);
    const second = new LocalSessionGateway(config, send, () => now, 128, store);
    gateway.setSsoRenewal(renew); second.setSsoRenewal(renew);
    async function establish() {
      const initial = await bootstrap(gateway);
      const response = await gateway.session(req("/api/auth/session", "POST", { cookie: initial.cookie, "x-csrf-token": initial.csrf, authorization: credential }), {
        issuer: "http://127.0.0.1:3388", subject: "synthetic-immutable-subject", authTime: Math.floor(now / 1000), accessExpiresAt: now + 300_000, refreshToken: "synthetic-refresh",
      });
      expect(response.status).toBe(200);
      const body = await response.json(); expect(JSON.stringify(body)).not.toContain("synthetic-refresh");
      return { cookie: cookieOf(response), csrf: body.csrfToken, expiresAt: body.expiresAt, response };
    }
    return { gateway, second, renew, send, rows, establish, advance: (ms: number) => { now += ms; } };
  }
  it("continues after three hours, rotates server token only, and never slides beyond eight hours", async () => {
    const f = longFixture(), session = await f.establish();
    expect(session.response.headers.get("set-cookie")).toMatch(/Max-Age=2879\d|Max-Age=28800/);
    f.advance(3 * 3600_000);
    expect((await f.gateway.forward(req("/api/v1/visits", "GET", { cookie: session.cookie }))).status).toBe(200);
    expect(f.renew).toHaveBeenCalledTimes(1);
    const updated = await f.second.session(req("/api/auth/session", "GET", { cookie: session.cookie }));
    expect((await updated.json()).expiresAt).toBe(session.expiresAt);
    f.advance(5 * 3600_000);
    expect((await f.gateway.forward(req("/api/v1/visits", "GET", { cookie: session.cookie }))).status).toBe(401);
    expect(f.renew).toHaveBeenCalledTimes(1);
  });
  it("serializes cross-instance refresh and dispatches each business request once", async () => {
    const f = longFixture(), session = await f.establish(); f.advance(280_000); f.send.mockClear();
    const results = await Promise.all([f.gateway, f.second].map(gateway => gateway.forward(req("/api/v1/visits", "POST", { cookie: session.cookie, "x-csrf-token": session.csrf }))));
    expect(results.map(r => r.status)).toEqual([200, 200]); expect(f.renew).toHaveBeenCalledTimes(1);
    expect(f.send.mock.calls.filter(([url]) => String(url).endsWith("/visits"))).toHaveLength(2);
  });
  it("checks CSRF before refresh and cannot manufacture long sessions with an HTTP header", async () => {
    const f = longFixture(), session = await f.establish(); f.advance(280_000);
    expect((await f.gateway.forward(req("/api/v1/visits", "POST", { cookie: session.cookie }))).status).toBe(403);
    expect(f.renew).not.toHaveBeenCalled();
    const initial = await bootstrap(f.gateway);
    const normal = await f.gateway.session(req("/api/auth/session", "POST", { cookie: initial.cookie, "x-csrf-token": initial.csrf, authorization: credential, "x-session-lifetime": "28800" }));
    expect(normal.headers.get("set-cookie")).toContain("Max-Age=300");
  });
  it("does not resurrect a session after logout during refresh", async () => {
    const f = longFixture(), session = await f.establish(); f.advance(280_000);
    let release!: () => void;
    f.renew.mockImplementationOnce(async value => { await new Promise<void>(resolve => { release = resolve; }); return { credential, sso: { ...value.sso!, accessExpiresAt: Date.now() + 600_000 } }; });
    const pending = f.gateway.forward(req("/api/v1/visits", "GET", { cookie: session.cookie }));
    await vi.waitFor(() => expect(f.renew).toHaveBeenCalledTimes(1));
    await f.second.session(req("/api/auth/session", "DELETE", { cookie: session.cookie, "x-csrf-token": session.csrf }));
    release(); expect((await pending).status).toBe(401); expect(f.rows.size).toBe(0);
  });
  it("an uncertain refresh is not retried and never executes a business write", async () => {
    const f = longFixture(), session = await f.establish(); f.advance(280_000); f.send.mockClear();
    f.renew.mockRejectedValueOnce(new Error("private refresh response lost"));
    for (let index = 0; index < 2; index++) {
      const response = await f.gateway.forward(req("/api/v1/visits", "POST", { cookie: session.cookie, "x-csrf-token": session.csrf }));
      expect(response.status).toBe(401); expect(await response.text()).not.toContain("private");
    }
    expect(f.renew).toHaveBeenCalledTimes(1); expect(f.send).not.toHaveBeenCalled();
  });
  it("rejects a renewed subject or changed product membership", async () => {
    const f = longFixture(), session = await f.establish(); f.advance(280_000);
    f.renew.mockImplementationOnce(async value => ({ credential, sso: { ...value.sso!, subject: "different-subject", accessExpiresAt: Date.now() + 600_000 } }));
    expect((await f.gateway.forward(req("/api/v1/me", "GET", { cookie: session.cookie }))).status).toBe(401);
    const other = await f.establish(); f.advance(280_000);
    f.send.mockImplementation(async () => Response.json({ ...viewer, id: org }));
    expect((await f.gateway.forward(req("/api/v1/me", "GET", { cookie: other.cookie }))).status).toBe(401);
  });
  it("a delayed old-token identity rejection cannot delete a concurrently renewed session", async () => {
    const f = longFixture(), session = await f.establish(); f.send.mockClear();
    let release!: (value: Response) => void;
    f.send.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    const pending = f.gateway.forward(req("/api/v1/visits", "GET", { cookie: session.cookie }));
    await vi.waitFor(() => expect(f.send).toHaveBeenCalledTimes(1)); f.advance(280_000);
    expect((await f.second.forward(req("/api/v1/me", "GET", { cookie: session.cookie }))).status).toBe(200);
    release(Response.json({ error: { code: "EXPIRED_OLD_TOKEN" } }, { status: 401 }));
    expect((await pending).status).toBe(200);
    expect((await f.gateway.session(req("/api/auth/session", "GET", { cookie: session.cookie }))).status).toBe(200);
    expect(f.renew).toHaveBeenCalledTimes(1);
  });
  it("an old-token business rejection is returned once without invalidating newer credentials", async () => {
    const f = longFixture(), session = await f.establish(); f.send.mockClear();
    let release!: (value: Response) => void;
    f.send.mockImplementation(async url => String(url).endsWith("/visits") ? new Promise(resolve => { release = resolve; }) : Response.json(viewer));
    const pending = f.gateway.forward(req("/api/v1/visits", "POST", { cookie: session.cookie, "x-csrf-token": session.csrf }));
    await vi.waitFor(() => expect(f.send.mock.calls.filter(([url]) => String(url).endsWith("/visits"))).toHaveLength(1));
    f.advance(280_000); expect((await f.second.session(req("/api/auth/session", "GET", { cookie: session.cookie }))).status).toBe(200);
    release(Response.json({ error: { code: "EXPIRED_OLD_TOKEN" } }, { status: 401 }));
    expect((await pending).status).toBe(401);
    expect((await f.gateway.session(req("/api/auth/session", "GET", { cookie: session.cookie }))).status).toBe(200);
    expect(f.send.mock.calls.filter(([url]) => String(url).endsWith("/visits"))).toHaveLength(1);
  });
});
