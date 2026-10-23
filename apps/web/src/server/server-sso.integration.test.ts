// @vitest-environment node
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { randomBytes, randomUUID, createHash, generateKeyPairSync, sign } from "node:crypto";
import { localPrisma, PrismaSessionStore, PrismaRepository } from "@hanamaru/alignment";
import { BackendService, loadConfig } from "@hanamaru/api/alignment";
import { createLocalProviders } from "@hanamaru/platform";
import { developmentIds as d } from "@hanamaru/database";
import { ServerSso, localReturnPath } from "./server-sso";
import { LocalSessionGateway } from "./session-gateway";
import { nativeApi } from "./native-api";

const database = process.env.ALIGNMENT_DATABASE_URL;
describe.skipIf(!database)("server PKCE with signed synthetic issuer, real product DB and persistent session", () => {
  let server: Server, issuer: string, gateway: LocalSessionGateway, sso: ServerSso;
  const db = database ? localPrisma(database) : undefined;
  const repository = db ? new PrismaRepository(db, database!, "hanamaru_api", "hanamaru_api_system") : undefined;
  const origin = "http://127.0.0.1:3387";
  const secret = randomBytes(32).toString("hex");
  const codes = new Map<string, { nonce: string; challenge: string; redirect: string }>();
  const tokens = new Set<string>(); let tokenCalls = 0, revoked = false, linked = true, badNonce = false;
  const keys = generateKeyPairSync("rsa", { modulusLength: 2048 });
  function jwt(payload: object) {
    const head = Buffer.from(JSON.stringify({ alg: "RS256", kid: "synthetic-key", typ: "JWT" })).toString("base64url");
    const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
    return `${head}.${body}.${sign("RSA-SHA256", Buffer.from(`${head}.${body}`), keys.privateKey).toString("base64url")}`;
  }
  beforeAll(async () => {
    server = createServer(async (req, res) => {
      res.setHeader("content-type", "application/json");
      const path = new URL(req.url!, issuer).pathname;
      if (path === "/.well-known/openid-configuration") return res.end(JSON.stringify({ issuer, authorization_endpoint: `${issuer}/auth`, token_endpoint: `${issuer}/token`, jwks_uri: `${issuer}/jwks`, response_types_supported: ["code"], subject_types_supported: ["public"], id_token_signing_alg_values_supported: ["RS256"], token_endpoint_auth_methods_supported: ["none"], code_challenge_methods_supported: ["S256"] }));
      if (path === "/jwks") return res.end(JSON.stringify({ keys: [{ ...keys.publicKey.export({ format: "jwk" }), kid: "synthetic-key", alg: "RS256", use: "sig" }] }));
      const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const form = new URLSearchParams(Buffer.concat(chunks).toString());
      if (path === "/token") {
        tokenCalls++; const code = form.get("code")!, flow = codes.get(code); codes.delete(code);
        if (!flow || form.get("redirect_uri") !== flow.redirect || form.get("client_id") !== "sso-hanamaru" || createHash("sha256").update(form.get("code_verifier") ?? "").digest("base64url") !== flow.challenge) return res.writeHead(400).end('{"error":"invalid_grant"}');
        const access = `synthetic-${randomUUID()}`; tokens.add(access);
        const now = Math.floor(Date.now() / 1000);
        return res.end(JSON.stringify({ access_token: access, token_type: "Bearer", expires_in: 300,
          id_token: jwt({ iss: issuer, aud: "sso-hanamaru", sub: "immutable-synthetic-subject", nonce: badNonce ? "bad" : flow.nonce, iat: now, exp: now + 300 }) }));
      }
      if (req.headers["x-sso-internal-secret"] !== secret) return res.writeHead(403).end("{}");
      if (path === "/internal/token") return res.end(JSON.stringify({ active: !revoked && tokens.has(form.get("token")!), subject: "immutable-synthetic-subject" }));
      if (path === "/internal/resolve") return res.end(JSON.stringify({ links: linked ? [{ productUserId: d.userId, organizationId: d.organizationId }] : [] }));
      return res.writeHead(404).end("{}");
    });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    issuer = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    const handler = await nativeApi(new BackendService(repository!, createLocalProviders()), loadConfig({ NODE_ENV: "test", ALLOW_DEV_AUTH: "false", SSO_ISSUER: issuer, SSO_INTERNAL_SECRET: secret }), async () => { throw new Error("not-an-identity-platform-token"); });
    const send = (async (input: string | URL | Request, init?: RequestInit) => (await handler.handle(new Request(input, init)))!) as typeof fetch;
    const store = new PrismaSessionStore(db!, randomBytes(32).toString("hex"));
    gateway = new LocalSessionGateway({ publicOrigin: origin, upstream: "http://127.0.0.1:3388/api/v1", allowLocal: true }, send, Date.now, 128, store);
    sso = new ServerSso(issuer, origin, store, gateway);
  });
  afterAll(async () => { await repository?.close(); if (server) await new Promise<void>(resolve => server.close(() => resolve())); });
  const req = (path: string, cookie?: string, method = "GET", extra: Record<string, string> = {}) => new Request(`${origin}${path}`, { method, headers: { host: "127.0.0.1:3387", ...(cookie ? { cookie } : {}), ...(method === "POST" ? { origin } : {}), ...extra } });
  async function flow() {
    const bootstrap = await gateway.session(req("/api/auth/session")); const initial = await bootstrap.json();
    const cookie = bootstrap.headers.get("set-cookie")!.split(";")[0]!;
    const started = await sso.start(req("/api/auth/sso/start?returnTo=%2Fexpense-settlement", cookie, "POST", { "x-csrf-token": initial.csrfToken }));
    expect(started.status).toBe(200);
    const url = new URL((await started.json()).authorizationUrl);
    const code = randomUUID(); codes.set(code, { nonce: url.searchParams.get("nonce")!, challenge: url.searchParams.get("code_challenge")!, redirect: url.searchParams.get("redirect_uri")! });
    return { cookie, callback: `/api/auth/sso/callback?code=${code}&state=${url.searchParams.get("state")}` };
  }
  it("validates signed nonce and PKCE, retains product user and rotates cookie without browser token", async () => {
    const started = await flow(); const result = await sso.callback(req(started.callback, started.cookie));
    expect(result.status).toBe(303); expect(result.headers.get("location")).toBe(`${origin}/expense-settlement`);
    const cookie = result.headers.get("set-cookie")!.split(";")[0]!; expect(cookie).not.toBe(started.cookie);
    const session = await gateway.session(req("/api/auth/session", cookie)); const body = await session.json();
    expect(body.viewer.id).toBe(d.membershipId); expect(JSON.stringify(body)).not.toContain("access_token");
    const before = tokenCalls;
    expect((await sso.callback(req(started.callback, started.cookie))).status).toBe(401);
    expect(tokenCalls).toBe(before);
    revoked = true;
    expect((await gateway.forward(req("/api/v1/me", cookie))).status).toBe(401);
    revoked = false;
    expect((await gateway.forward(req("/api/v1/me", cookie))).status).toBe(401);
  });
  it("refuses wrong cookie and nonce without email-based enrollment", async () => {
    const started = await flow(); const before = tokenCalls;
    expect((await sso.callback(req(started.callback))).status).toBe(401); expect(tokenCalls).toBe(before);
    badNonce = true; expect((await sso.callback(req(started.callback, started.cookie))).status).toBe(401); badNonce = false;
    linked = false; const unlinked = await flow(); expect((await sso.callback(req(unlinked.callback, unlinked.cookie))).status).toBe(401); linked = true;
  });
});
it("only allows local product return paths", () => {
  for (const value of ["//example.invalid", "/\\example.invalid", "/%2fexample.invalid", "/api/auth/session", "/sso/callback"]) expect(localReturnPath(value)).toBe("/");
  expect(localReturnPath("/performance?period=month")).toBe("/performance?period=month");
});
