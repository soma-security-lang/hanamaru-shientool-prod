import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { forwardApiRequest, type ForwarderConfig } from "./api-forwarder";
import type { SessionStore, StoredSession } from "@hanamaru/alignment";

const opaque = () => randomBytes(32).toString("base64url");
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const unsafeMethods = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
type Viewer = { id: string; status: string; roles: string[] };
type Session = StoredSession;

class MemorySessionStore implements SessionStore {
  private readonly values = new Map<string, { value: Session; version: number }>();
  constructor(private readonly now: () => number, private readonly capacity: number) {}
  async get(key: string) {
    const value = this.values.get(key);
    return value && value.value.expiresAt > this.now() ? structuredClone(value) : null;
  }
  async create(key: string, value: Session) {
    for (const [id, entry] of this.values) if (entry.value.expiresAt <= this.now()) this.values.delete(id);
    if (this.values.size >= this.capacity) return false;
    this.values.set(key, { value: structuredClone(value), version: 0 }); return true;
  }
  async replace(key: string, version: number, nextKey: string, value: Session) {
    const current = this.values.get(key);
    if (!current || current.version !== version || current.value.expiresAt <= this.now()) return false;
    this.values.delete(key); this.values.set(nextKey, { value: structuredClone(value), version: version + 1 }); return true;
  }
  async remove(key: string) { this.values.delete(key); }
  async attempt(key: string) {
    const value = this.values.get(key);
    return Boolean(value && value.value.expiresAt > this.now() && ++value.value.attempts <= 5);
  }
}

/** Local gateway. Memory by default; an atomic encrypted persistent store may be injected. */
export class LocalSessionGateway {
  private readonly store: SessionStore;
  private renewSso?: (session: Session) => Promise<{ credential: string; sso: NonNullable<Session["sso"]> }>;
  setSsoRenewal(renew: NonNullable<LocalSessionGateway["renewSso"]>) { this.renewSso = renew; }
  constructor(private readonly config: ForwarderConfig, private readonly send: typeof fetch = fetch,
    private readonly now: () => number = Date.now, capacity = 128, store?: SessionStore) {
    this.store = store ?? new MemorySessionStore(now, capacity);
  }

  private reply(status: number, payload: unknown, cookie?: string) {
    return Response.json(payload, { status, headers: {
      "cache-control": "private, no-store", "vary": "Cookie, Origin",
      ...(cookie ? { "set-cookie": cookie } : {}),
    } });
  }
  private fail(status: number, code: string) {
    return this.reply(status, { error: { code, message: "認証状態を確認してから操作してください" } });
  }
  private cookie(id: string, expires = false, maxAge = 300) {
    const secure = new URL(this.config.publicOrigin).protocol === "https:" ? "; Secure" : "";
    return `__session=${id}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${expires ? 0 : maxAge}${secure}`;
  }
  private key(request: Request) {
    const values = (request.headers.get("cookie") ?? "").split(";").map(v => v.trim()).filter(v => v.startsWith("__session="));
    if (values.length !== 1) return null;
    const id = values[0]!.slice("__session=".length);
    return /^[A-Za-z0-9_-]{43}$/.test(id) ? digest(id) : null;
  }
  private async current(request: Request) {
    const key = this.key(request);
    const stored = key ? await this.store.get(key) : null;
    return { key, session: stored?.value, version: stored?.version ?? 0 };
  }
  /** Shared CAS lease: never exchange a rotating refresh token twice, even across processes. */
  private async usable(request: Request) {
    let current = await this.current(request);
    const deadline = Date.now() + 6_000;
    while (current.session?.sso && (current.session.renewal || current.session.sso.accessExpiresAt <= this.now() + 30_000)) {
      const { key, session, version } = current;
      if (!key || !this.renewSso || session.renewal && session.renewal.expiresAt <= this.now()) {
        if (key) await this.store.remove(key);
        return { ...current, session: undefined, response: this.fail(401, "SSO_REAUTH_REQUIRED") };
      }
      if (!session.renewal) {
        const owner = opaque();
        const claimed = { ...session, renewal: { owner, expiresAt: this.now() + 20_000 } };
        if (await this.store.replace(key, version, key, claimed)) {
          try {
            const renewed = await this.renewSso(session);
            const active = await this.store.get(key);
            if (!active || active.value.renewal?.owner !== owner) return { ...current, session: undefined, response: this.fail(401, "SESSION_EXPIRED") };
            if (renewed.sso.subject !== session.sso!.subject || renewed.sso.issuer !== session.sso!.issuer || renewed.sso.authTime !== session.sso!.authTime ||
              renewed.sso.accessExpiresAt <= this.now() || !/^Bearer [^\s]{1,8192}$/i.test(renewed.credential)) throw new Error("SSO_IDENTITY_CHANGED");
            const next = { ...session, ...renewed };
            if (!await this.store.replace(key, active.version, key, next)) return { ...current, session: undefined, response: this.fail(401, "SESSION_EXPIRED") };
          } catch {
            // Exchange may have committed remotely: do not retry the old refresh token.
            await this.store.remove(key);
            return { ...current, session: undefined, response: this.fail(401, "SSO_REAUTH_REQUIRED") };
          }
        }
      } else {
        if (Date.now() >= deadline) return { ...current, response: this.fail(503, "SESSION_RENEWAL_BUSY") };
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      current = await this.current(request);
    }
    return { ...current, response: undefined as Response | undefined };
  }
  private allowedOrigin(request: Request) {
    const origin = new URL(this.config.publicOrigin).origin;
    const supplied = request.headers.get("origin");
    // Next may construct Request.url using its internal server hostname. Match
    // Host against the fixed configuration, never a client-supplied forwarded host.
    return [new URL(origin).host, ...(this.config.transportHosts ?? [])].includes(request.headers.get("host") ?? "") && request.headers.get("sec-fetch-site") !== "cross-site" &&
      (!supplied || supplied === origin) && (!unsafeMethods.has(request.method) || supplied === origin);
  }
  private csrf(request: Request, session: Session) {
    const value = request.headers.get("x-csrf-token") ?? "";
    return /^[A-Za-z0-9_-]{43}$/.test(value) && same(session.csrf, value);
  }
  private issue(value: Partial<Session> = {}) {
    const id = opaque();
    const session: Session = { csrf: opaque(), expiresAt: this.now() + 300_000, attempts: 0, ...value };
    return { id, session };
  }
  private async identity(credential: string, organizationId?: string) {
    const headers = new Headers({ authorization: credential });
    if (organizationId) headers.set("x-organization-id", organizationId);
    const response = await forwardApiRequest(new Request(`${this.config.publicOrigin}/api/v1/me`, { headers }), this.config, this.send);
    if (!response.ok) return { response };
    try {
      const viewer = await response.json() as Viewer;
      if (!uuid.test(viewer.id) || viewer.status !== "active" || !Array.isArray(viewer.roles) || !viewer.roles.length)
        return { response: this.fail(502, "INVALID_IDENTITY_RESPONSE") };
      return { viewer };
    } catch { return { response: this.fail(502, "INVALID_IDENTITY_RESPONSE") }; }
  }
  private async invalidateCredential(key: string, credential: string) {
    const row = await this.store.get(key);
    if (row && !row.value.renewal && row.value.credential === credential)
      await this.store.replace(key, row.version, key, { ...row.value, expiresAt: this.now() - 1 });
  }
  /** Only identity reads may be repeated after a concurrent token rotation. */
  private async validated(request: Request) {
    let current = await this.usable(request);
    for (let attempt = 0; attempt < 3; attempt++) {
      if (current.response || !current.session?.credential || !current.key) return { ...current, viewer: undefined as Viewer | undefined };
      const session = current.session;
      const checked = await this.identity(session.credential!, session.organizationId);
      const latest = await this.store.get(current.key);
      if (!latest) return { ...current, viewer: undefined, response: this.fail(401, "SESSION_EXPIRED") };
      if (latest.value.renewal || latest.value.credential !== session.credential) { current = await this.usable(request); continue; }
      if (checked.response) {
        if ([401, 403].includes(checked.response.status)) await this.invalidateCredential(current.key, session.credential!);
        return { ...current, viewer: undefined, response: checked.response };
      }
      if (checked.viewer!.id !== session.membershipId) {
        await this.invalidateCredential(current.key, session.credential!);
        return { ...current, viewer: undefined, response: this.fail(401, "IDENTITY_CHANGED") };
      }
      return { ...current, session: latest.value, version: latest.version, viewer: checked.viewer };
    }
    return { ...current, viewer: undefined, response: this.fail(503, "SESSION_RENEWAL_BUSY") };
  }

  // sso is passed only by the verified server callback, never parsed from HTTP input.
  async session(request: Request, sso?: Session["sso"]): Promise<Response> {
    if (!this.allowedOrigin(request)) return this.fail(403, "ORIGIN_REJECTED");
    if (!["GET", "POST", "DELETE"].includes(request.method)) return this.fail(405, "METHOD_NOT_ALLOWED");
    if (this.config.explicitSessionBootstrap && request.method === "DELETE" && request.headers.get("x-session-intent") === "logout") {
      const key = this.key(request);
      if (key) await this.store.remove(key);
      return this.reply(200, { authenticated: false }, this.cookie("", true));
    }
    const current = request.method === "GET" ? await this.validated(request) : { ...await this.current(request), viewer: undefined, response: undefined };
    if (current.response) return current.response;
    const old = current.session;
    if (request.method === "GET") {
      if (old?.credential) {
        return this.reply(200, { authenticated: true, csrfToken: old.csrf, viewer: current.viewer, expiresAt: old.expiresAt });
      }
      if (old) return this.reply(200, { authenticated: false, csrfToken: old.csrf });
      if (this.config.explicitSessionBootstrap) {
        // An expired SSO Cookie must never silently restore a Google identity.
        return (request.headers.get("cookie") ?? "").split(";").some(part => part.trim().startsWith("__session="))
          ? this.fail(401, "SESSION_EXPIRED") : this.reply(200, { authenticated: false });
      }
      const fresh = this.issue();
      if (!await this.store.create(digest(fresh.id), fresh.session)) return this.fail(429, "SESSION_CAPACITY");
      return this.reply(200, { authenticated: false, csrfToken: fresh.session.csrf }, this.cookie(fresh.id));
    }
    if (!old || !this.csrf(request, old)) return this.fail(403, "CSRF_REJECTED");
    if (request.method === "DELETE") {
      await this.store.remove(current.key!);
      return this.reply(200, { authenticated: false }, this.cookie("", true));
    }
    if (!await this.store.attempt(current.key!)) return this.fail(429, "SESSION_ATTEMPTS");
    const credential = request.headers.get("authorization") ?? "";
    const organizationId = request.headers.get("x-organization-id") ?? undefined;
    if (!/^Bearer [^\s]{1,8192}$/i.test(credential) || (organizationId !== undefined && !uuid.test(organizationId)))
      return this.fail(400, "INVALID_CREDENTIAL_REQUEST");
    const checked = await this.identity(credential, organizationId);
    if (checked.response) return checked.response;
    // Consume the previous session exactly once, including concurrent login or logout.
    const expiresAt = sso ? Math.min(this.now() + 8 * 3600_000, (sso.authTime + 8 * 3600) * 1000) : this.now() + 300_000;
    if (sso && (!this.renewSso || !Number.isSafeInteger(sso.authTime) || expiresAt <= this.now() || sso.authTime * 1000 > this.now() + 30_000 || !sso.refreshToken)) return this.fail(401, "SSO_REAUTH_REQUIRED");
    const fresh = this.issue({ credential, organizationId, membershipId: checked.viewer!.id, expiresAt, ...(sso ? { sso } : {}) });
    if (!await this.store.replace(current.key!, current.version, digest(fresh.id), fresh.session)) return this.fail(409, "SESSION_CHANGED");
    return this.reply(200, { authenticated: true, csrfToken: fresh.session.csrf, viewer: checked.viewer, expiresAt }, this.cookie(fresh.id, false, Math.max(1, Math.floor((expiresAt - this.now()) / 1000))));
  }

  /** Only an explicit same-origin login action may restart an expired flow. */
  async restart(request: Request): Promise<Response> {
    if (request.method !== "POST" || !this.allowedOrigin(request) || request.headers.get("x-session-intent") !== "login")
      return this.fail(403, "ORIGIN_REJECTED");
    const key = this.key(request);
    if (key) await this.store.remove(key);
    const fresh = this.issue();
    if (!await this.store.create(digest(fresh.id), fresh.session)) return this.fail(429, "SESSION_CAPACITY");
    return this.reply(200, { authenticated: false, csrfToken: fresh.session.csrf }, this.cookie(fresh.id));
  }

  /** Drive consent must belong to the currently authenticated product member. */
  async verifyGoogleIdentity(request: Request): Promise<Response> {
    if (request.method !== "POST" || !this.allowedOrigin(request)) return this.fail(403, "ORIGIN_REJECTED");
    const current = await this.validated(request);
    if (current.response) return current.response;
    if (!current.session?.credential || !current.viewer || !this.csrf(request, current.session)) return this.fail(403, "CSRF_REJECTED");
    const credential = request.headers.get("authorization") ?? "";
    if (!/^Bearer [^\s]{1,8192}$/i.test(credential)) return this.fail(400, "INVALID_CREDENTIAL_REQUEST");
    const checked = await this.identity(credential, current.session.organizationId);
    return checked.viewer?.id === current.viewer.id ? this.reply(200, { verified: true }) : this.fail(403, "IDENTITY_CHANGED");
  }

  async forward(request: Request): Promise<Response> {
    if (!this.allowedOrigin(request)) return this.fail(403, "ORIGIN_REJECTED");
    // Reject mixed credentials and CSRF before any token exchange or provider call.
    if (request.headers.has("authorization")) return this.fail(400, "MIXED_CREDENTIALS");
    const before = await this.current(request);
    if (before.session && unsafeMethods.has(request.method) && !this.csrf(request, before.session)) return this.fail(403, "CSRF_REJECTED");
    const requestedOrg = request.headers.get("x-organization-id");
    if (before.session && requestedOrg && requestedOrg !== before.session.organizationId) return this.fail(403, "ORGANIZATION_CHANGED");
    const current = await this.validated(request);
    if (current.response) return current.response;
    const { key, session } = current;
    if (!session?.credential) return this.fail(401, "SESSION_REQUIRED");
    if (requestedOrg && requestedOrg !== session.organizationId) return this.fail(403, "ORGANIZATION_CHANGED");
    if (unsafeMethods.has(request.method) && !this.csrf(request, session)) return this.fail(403, "CSRF_REJECTED");
    const headers = new Headers(request.headers);
    headers.delete("cookie"); headers.delete("x-csrf-token"); headers.delete("x-organization-id");
    headers.set("authorization", session.credential);
    if (session.organizationId) headers.set("x-organization-id", session.organizationId);
    const response = await forwardApiRequest(new Request(request, { headers }), this.config, this.send);
    if (response.status === 401) await this.invalidateCredential(key!, session.credential);
    return response;
  }
}
