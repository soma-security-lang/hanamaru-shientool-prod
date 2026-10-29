import { createHash } from "node:crypto";
import * as oidc from "openid-client";
import type { SessionStore, StoredSession } from "@hanamaru/alignment";
import type { LocalSessionGateway } from "./session-gateway";

const hash = (value: string) => createHash("sha256").update(value).digest("hex");
function cookieKey(request: Request) {
  const entries = (request.headers.get("cookie") ?? "").split(";").map(v => v.trim()).filter(v => v.startsWith("__session="));
  const raw = entries.length === 1 ? entries[0]!.slice(10) : "";
  return /^[A-Za-z0-9_-]{43}$/.test(raw) ? hash(raw) : null;
}
export function localReturnPath(raw: string | null) {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//") || /[\\\u0000-\u0020]/.test(raw) || /%2f|%5c|%0[ad]/i.test(raw) || /^\/(login|sso|api)(\/|\?|$)/.test(raw)) return "/";
  return raw;
}
/** Server-side PKCE. Public-client identity remains sso-hanamaru; no email linking. */
export class ServerSso {
  private client?: Promise<oidc.Configuration>;
  constructor(private readonly issuer: string, private readonly origin: string,
    private readonly store: SessionStore, private readonly gateway: LocalSessionGateway, private readonly longSessions = false,
    private readonly diagnostic?: (stage: string, code: string) => void,
    private readonly production?: { transportHosts: readonly string[] }) {
    if (production) {
      if (process.env.NODE_ENV !== "production" || !/^hanamaru-(?:pilot-web|pilot-stage-web|alignment-stage-web)$/.test(process.env.K_SERVICE ?? "") ||
          process.env.HANAMARU_PRODUCTION_SESSION !== "true" || process.env.HANAMARU_SERVER_SSO !== "true" ||
          !longSessions || [issuer, origin].some(value => { const url = new URL(value); return url.protocol !== "https:" || value !== url.origin; }))
        throw new Error("PRODUCTION_SSO_CONFIGURATION_REQUIRED");
    } else if (process.env.K_SERVICE !== undefined || [issuer, origin].some(value => {
      const url = new URL(value); return url.protocol !== "http:" || url.hostname !== "127.0.0.1" || value !== url.origin;
    })) throw new Error("LOCAL_SSO_ONLY");
    if (longSessions) gateway.setSsoRenewal(session => this.renew(session));
  }
  private configuration() {
    return this.client ??= (async () => {
      const config = await oidc.discovery(new URL(this.issuer), "sso-hanamaru", { token_endpoint_auth_method: "none" }, oidc.None(),
        this.production ? undefined : { execute: [oidc.allowInsecureRequests] });
      const metadata = config.serverMetadata();
      for (const endpoint of [metadata.authorization_endpoint, metadata.token_endpoint, metadata.jwks_uri])
        if (!endpoint || new URL(endpoint).origin !== this.issuer) throw new Error("OIDC_ENDPOINT_REJECTED");
      oidc.enableNonRepudiationChecks(config);
      config.timeout = 5;
      return config;
    })();
  }
  private failure() { return Response.json({ error: { code: "SSO_RESTART_REQUIRED" } }, { status: 401, headers: { "cache-control": "private, no-store" } }); }
  async start(request: Request) {
    if (request.method !== "POST" || request.headers.get("origin") !== this.origin ||
      ![new URL(this.origin).host, ...(this.production?.transportHosts ?? [])].includes(request.headers.get("host") ?? "")) return this.failure();
    const owner = cookieKey(request), session = owner ? await this.store.get(owner) : null;
    if (!owner || !session || request.headers.get("x-csrf-token") !== session.value.csrf) return this.failure();
    const state = oidc.randomState(), verifier = oidc.randomPKCECodeVerifier(), nonce = oidc.randomNonce();
    const config = await this.configuration();
    const returnTo = localReturnPath(new URL(request.url).searchParams.get("returnTo"));
    if (!await this.store.create(hash(`flow:${state}`), { csrf: nonce, expiresAt: Date.now() + 300_000, attempts: 0, flow: { owner, state, verifier, nonce, returnTo } })) return this.failure();
    const url = oidc.buildAuthorizationUrl(config, { redirect_uri: `${this.origin}/api/auth/sso/callback`, scope: this.longSessions ? "openid offline_access" : "openid", state, nonce,
      ...(this.longSessions ? { prompt: "consent" } : {}),
      code_challenge: await oidc.calculatePKCECodeChallenge(verifier), code_challenge_method: "S256", max_age: "28800" });
    return Response.json({ authorizationUrl: url.toString() }, { headers: { "cache-control": "private, no-store" } });
  }
  async callback(request: Request) {
    let stage = "callback-request";
    try {
      if (request.method !== "GET" || ![new URL(this.origin).host, ...(this.production?.transportHosts ?? [])].includes(request.headers.get("host") ?? "")) return this.failure();
      const url = new URL(new URL(request.url).pathname + new URL(request.url).search, this.origin);
      const state = url.searchParams.get("state");
      if (!state || url.searchParams.getAll("state").length !== 1) return this.failure();
      const key = hash(`flow:${state}`), row = await this.store.get(key), owner = cookieKey(request);
      if (!row?.value.flow || !owner || row.value.flow.owner !== owner || !await this.store.get(owner)) return this.failure();
      const flow = row.value.flow;
      // Atomic consume before exchanging code: retries never exchange twice.
      if (!await this.store.replace(key, row.version, key, { csrf: "consumed", attempts: 5, expiresAt: Date.now() - 1 })) return this.failure();
      stage = "callback-token-exchange";
      const tokens = await oidc.authorizationCodeGrant(await this.configuration(), url, {
        pkceCodeVerifier: flow.verifier, expectedState: flow.state, expectedNonce: flow.nonce, idTokenExpected: true,
      });
      stage = "callback-claims";
      const claims = tokens.claims();
      if (!tokens.access_token || !claims?.sub) return this.failure();
      let sso: StoredSession["sso"];
      if (this.longSessions) {
        if (!tokens.refresh_token || !tokens.expires_in || !Number.isSafeInteger(claims.auth_time) || claims.auth_time! * 1000 > Date.now() + 30_000) return this.failure();
        sso = { issuer: this.issuer, subject: claims.sub, authTime: claims.auth_time!, accessExpiresAt: Date.now() + tokens.expires_in * 1000, refreshToken: tokens.refresh_token };
      }
      stage = "callback-session-owner";
      const initial = await this.store.get(owner);
      if (!initial) return this.failure();
      stage = "callback-session-exchange";
      const result = await this.gateway.session(new Request(`${this.origin}/api/auth/session`, { method: "POST", headers: {
        host: new URL(this.origin).host, origin: this.origin, cookie: request.headers.get("cookie")!,
        "x-csrf-token": initial.value.csrf, authorization: `Bearer ${tokens.access_token}`,
      } }), sso);
      if (!result.ok) { this.diagnostic?.(stage, `HTTP_${result.status}`); return result; }
      const cookie = result.headers.get("set-cookie");
      if (!cookie) return this.failure();
      return new Response(null, { status: 303, headers: { location: `${this.origin}${flow.returnTo}`, "set-cookie": cookie, "cache-control": "private, no-store" } });
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error && typeof error.code === "string" && /^[A-Z_]{1,80}$/.test(error.code) ? error.code : "CALLBACK_REJECTED";
      this.diagnostic?.(stage, code);
      return this.failure();
    }
  }

  private async active(session: StoredSession) {
    const sso = session.sso;
    const secret = process.env.SSO_INTERNAL_SECRET;
    if (!sso || sso.issuer !== this.issuer || !secret || !session.membershipId || session.expiresAt <= Date.now()) throw new Error("SSO_REAUTH_REQUIRED");
    // Resolve immutable sub again, never infer a user from email/name. Check
    // original auth_time, not the newly minted token iat, against global logout.
    const post = async (path: string, input: Record<string, string>) => {
      const response = await fetch(new URL(path, this.issuer), { method: "POST", redirect: "error", cache: "no-store",
        headers: { "content-type": "application/x-www-form-urlencoded", "x-sso-internal-secret": secret },
        body: new URLSearchParams(input), signal: AbortSignal.timeout(1500) });
      if (!response.ok) throw new Error("SSO_STATUS_UNAVAILABLE");
      return response.json();
    };
    const resolved = await post("/internal/resolve", { subject: sso.subject, product: "hanamaru" }) as { links?: Array<{ productUserId: string; organizationId: string }> };
    const links = resolved.links?.filter(link => !session.organizationId || link.organizationId === session.organizationId);
    if (!links || links.length !== 1 || !links[0]?.productUserId || !links[0].organizationId) throw new Error("SSO_LINK_CHANGED");
    const status = await post("/internal/status", { subject: sso.subject, product: "hanamaru", productUserId: links[0].productUserId,
      organizationId: links[0].organizationId, authTime: String(sso.authTime) }) as { active?: boolean };
    if (status.active !== true) throw new Error("SSO_REVOKED");
  }

  private async renew(session: StoredSession) {
    if (!this.longSessions || !session.sso) throw new Error("SSO_REAUTH_REQUIRED");
    let stage = "status-before";
    try {
    await this.active(session);
    stage = "exchange";
    const tokens = await oidc.refreshTokenGrant(await this.configuration(), session.sso.refreshToken);
    stage = "claims";
    const claims = tokens.claims();
    if (!tokens.access_token || !tokens.expires_in || !claims || claims.sub !== session.sso.subject ||
      claims.auth_time !== undefined && claims.auth_time !== session.sso.authTime) throw new Error("SSO_IDENTITY_CHANGED");
    stage = "status-after"; await this.active(session);
    return { credential: `Bearer ${tokens.access_token}`, sso: { ...session.sso,
      refreshToken: tokens.refresh_token ?? session.sso.refreshToken, accessExpiresAt: Date.now() + tokens.expires_in * 1000 } };
    } catch (error) {
      // Injectable test diagnostics expose only fixed stage and a library error code,
      // never token/subject/provider description/request/response payloads.
      const code = error && typeof error === "object" && "code" in error && typeof error.code === "string" && /^[A-Z_]{1,80}$/.test(error.code) ? error.code : "RENEWAL_REJECTED";
      this.diagnostic?.(stage, code); throw error;
    }
  }
}
