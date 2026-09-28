import {
  SignJWT,
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  type JWTPayload,
} from "jose";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  authenticate,
  createIdentityPlatformTokenVerifier,
  validateIdentityPlatformClaims,
} from "./auth.js";
import { loadConfig } from "./config.js";

const config = loadConfig({ NODE_ENV: "test", ALLOW_DEV_AUTH: "false" });
const now = Math.floor(Date.now() / 1000);
const validClaims = (): JWTPayload => ({
  sub: "firebase-user-123",
  email: "assessor@example.invalid",
  email_verified: true,
  auth_time: now - 60,
  iat: now - 30,
  exp: now + 3_600,
});

describe("Identity Platform ID token verification", () => {
  let sign: (claims?: JWTPayload, issuer?: string, audience?: string) => Promise<string>;
  let verify: ReturnType<typeof createIdentityPlatformTokenVerifier>;

  beforeAll(async () => {
    const { publicKey, privateKey } = await generateKeyPair("RS256");
    const jwk = await exportJWK(publicKey);
    const keySet = createLocalJWKSet({
      keys: [{ ...jwk, kid: "securetoken-test-key", alg: "RS256", use: "sig" }],
    });
    verify = createIdentityPlatformTokenVerifier(config, keySet);
    sign = (claims = validClaims(), issuer = config.identityIssuer, audience = config.identityAudience) =>
      new SignJWT(claims)
        .setProtectedHeader({ alg: "RS256", kid: "securetoken-test-key" })
        .setIssuer(issuer)
        .setAudience(audience)
        .sign(privateKey);
  });

  it("accepts a correctly signed securetoken for monocle-503402", async () => {
    await expect(verify(await sign())).resolves.toMatchObject({
      sub: "firebase-user-123",
      email_verified: true,
    });
  });

  it("rejects a token for another issuer or audience", async () => {
    await expect(
      verify(await sign(validClaims(), "https://securetoken.google.com/other")),
    ).rejects.toThrow();
    await expect(
      verify(await sign(validClaims(), config.identityIssuer, "other-project")),
    ).rejects.toThrow();
  });

  it("requires exp, iat, auth_time, sub, email and verified email", () => {
    for (const claim of ["exp", "iat", "auth_time", "sub", "email"] as const) {
      const invalid = validClaims();
      delete invalid[claim];
      expect(() => validateIdentityPlatformClaims(invalid, now)).toThrow();
    }
    expect(() =>
      validateIdentityPlatformClaims(
        { ...validClaims(), email_verified: false },
        now,
      ),
    ).toThrow(/verified email/);
  });

  it("rejects expired or future-issued authentication", () => {
    expect(() =>
      validateIdentityPlatformClaims({ ...validClaims(), exp: now }, now),
    ).toThrow(/future/);
    expect(() =>
      validateIdentityPlatformClaims({ ...validClaims(), iat: now + 1 }, now),
    ).toThrow(/iat/);
    expect(() =>
      validateIdentityPlatformClaims(
        { ...validClaims(), auth_time: now + 1 },
        now,
      ),
    ).toThrow(/auth_time/);
  });

  it("never rebinds an active account when the Identity subject differs", async () => {
    const system = vi.fn(async (sql: string) => {
      if (sql.includes("FROM memberships")) return { rows: [], rowCount: 0 };
      if (sql.includes("FROM users WHERE email_hash")) {
        expect(sql).toContain("status='invited'");
        expect(sql).not.toContain("'active'");
        return { rows: [], rowCount: 0 };
      }
      throw new Error(`unexpected query: ${sql}`);
    });
    await expect(
      authenticate(
        {
          id: "request-identity-rebind",
          headers: { authorization: "Bearer test-token" },
        } as never,
        config,
        { system } as never,
        async () => validClaims(),
      ),
    ).rejects.toMatchObject({ code: "AUTH_INVALID", statusCode: 401 });
    expect(system.mock.calls.some(([sql]) => String(sql).startsWith("UPDATE users"))).toBe(false);
  });
});

describe("shared OIDC and Google coexistence", () => {
  const ssoConfig = loadConfig({ NODE_ENV: "test", SSO_ISSUER: "http://127.0.0.1:3300",
    SSO_INTERNAL_SECRET: "synthetic-hanamaru-internal-secret-at-least-32" });
  const userId = "00000000-0000-4000-8000-000000000101";
  const organizationId = "00000000-0000-4000-8000-000000000202";
  const membership = {
    user_id: userId, organization_id: organizationId,
    membership_id: "00000000-0000-4000-8000-000000000303", branch_id: "00000000-0000-4000-8000-000000000404",
    roles: ["assessor"], capabilities: ["visit:self"], authorization_scopes: [],
  };
  const request = { id: "synthetic-request", headers: { authorization: "Bearer opaque-token",
    "x-organization-id": organizationId } } as never;
  afterEach(() => vi.unstubAllGlobals());

  it("resolves a preapproved OIDC link to the existing membership without granting another role", async () => {
    const fetchMock = vi.fn(async (url: URL) => new Response(JSON.stringify(
      url.pathname === "/internal/token"
        ? { active: true, subject: "00000000-0000-4000-8000-000000000505" }
        : { links: [{ productUserId: userId, organizationId }] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const system = vi.fn(async (sql: string) => {
      expect(sql).toContain('u.id=$1');
      return { rows: [membership], rowCount: 1 };
    });
    const actor = await authenticate(request, ssoConfig, { system } as never, async () => { throw new Error("not Firebase"); });
    expect(actor).toMatchObject({ authMode: "oidc", organizationId, roles: ["assessor"], capabilities: ["visit:self"] });
    expect(system.mock.calls[0]?.[0]).toContain("u.id=$1");
  });

  it("rejects an OIDC link whose organization does not match the product membership", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: URL) => new Response(JSON.stringify(
      url.pathname === "/internal/token"
        ? { active: true, subject: "00000000-0000-4000-8000-000000000505" }
        : { links: [{ productUserId: userId, organizationId: "other-org" }] }), { status: 200 })));
    await expect(authenticate(
      { id: "synthetic-request", headers: { authorization: "Bearer opaque-token" } } as never,
      ssoConfig, { system: vi.fn(async () => ({ rows: [membership], rowCount: 1 })) } as never,
      async () => { throw new Error("not Firebase"); },
    )).rejects.toMatchObject({ code: "SCOPE_DENIED", statusCode: 403 });
  });

  it("requires an explicit organization for a shared subject with multiple approved memberships", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: URL) => new Response(JSON.stringify(
      url.pathname === "/internal/token"
        ? { active: true, subject: "00000000-0000-4000-8000-000000000505" }
        : { links: [
          { productUserId: userId, organizationId },
          { productUserId: userId, organizationId: "00000000-0000-4000-8000-000000000909" },
        ] }), { status: 200 })));
    const system = vi.fn(async () => ({ rows: [membership], rowCount: 1 }));
    await expect(authenticate(
      { id: "synthetic-request", headers: { authorization: "Bearer opaque-token" } } as never,
      ssoConfig, { system } as never, async () => { throw new Error("not Firebase"); },
    )).rejects.toMatchObject({ code: "ORGANIZATION_REQUIRED", statusCode: 409 });
    expect(system).not.toHaveBeenCalled();
    const selected = await authenticate(request, ssoConfig, { system } as never,
      async () => { throw new Error("not Firebase"); });
    expect(selected.organizationId).toBe(organizationId);
    expect(selected.roles).toEqual(["assessor"]);
  });

  it("fails closed when the common session service is unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("synthetic outage"); }));
    await expect(authenticate(request, ssoConfig, { system: vi.fn() } as never,
      async () => { throw new Error("not Firebase"); }))
      .rejects.toMatchObject({ code: "AUTH_INVALID", statusCode: 401 });
  });

  it("rejects an old Google token after common logout for a mapped user", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ managed: true, active: false }), { status: 200 })));
    const system = vi.fn(async () => ({ rows: [membership], rowCount: 1 }));
    await expect(authenticate(request, ssoConfig, { system } as never, async () => validClaims()))
      .rejects.toMatchObject({ code: "AUTH_INVALID", statusCode: 401 });
  });

  it("keeps an unmigrated Google user signed in during an issuer outage after reconciliation", async () => {
    const ready = loadConfig({ NODE_ENV: "test", SSO_ISSUER: "http://127.0.0.1:3300",
      SSO_INTERNAL_SECRET: "synthetic-hanamaru-internal-secret-at-least-32",
      SSO_LOCAL_ENROLLMENT_READY: "true" });
    const fetchMock = vi.fn(async () => { throw new Error("synthetic outage"); });
    vi.stubGlobal("fetch", fetchMock);
    const system = vi.fn(async () => ({ rows: [{ ...membership, sso_enrollment_state: "legacy" }], rowCount: 1 }));
    await expect(authenticate(request, ready, { system } as never, async () => validClaims()))
      .resolves.toMatchObject({ authMode: "identity_platform", organizationId });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses a prepared Google user when the issuer cannot confirm status", async () => {
    const ready = loadConfig({ NODE_ENV: "test", SSO_ISSUER: "http://127.0.0.1:3300",
      SSO_INTERNAL_SECRET: "synthetic-hanamaru-internal-secret-at-least-32",
      SSO_LOCAL_ENROLLMENT_READY: "true" });
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("synthetic outage"); }));
    const system = vi.fn(async () => ({ rows: [{ ...membership, sso_enrollment_state: "pending" }], rowCount: 1 }));
    await expect(authenticate(request, ready, { system } as never, async () => validClaims()))
      .rejects.toMatchObject({ code: "AUTH_INVALID", statusCode: 401 });
  });
});
