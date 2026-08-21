import {
  SignJWT,
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  type JWTPayload,
} from "jose";
import { beforeAll, describe, expect, it, vi } from "vitest";
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
