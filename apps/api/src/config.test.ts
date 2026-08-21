import { describe, expect, it } from "vitest";
import {
  identityPlatformAudience,
  identityPlatformIssuer,
  identityPlatformJwksUrl,
  loadConfig,
} from "./config.js";

describe("Identity Platform configuration", () => {
  it("fails closed when development auth is enabled in production", () =>
    expect(() =>
      loadConfig({ NODE_ENV: "production", ALLOW_DEV_AUTH: "true" }),
    ).toThrow(/ALLOW_DEV_AUTH/));

  it("pins issuer, audience and securetoken JWKS to monocle-503402", () =>
    expect(
      loadConfig({ NODE_ENV: "production", ALLOW_DEV_AUTH: "false" }),
    ).toMatchObject({
      identityIssuer: identityPlatformIssuer,
      identityAudience: identityPlatformAudience,
      identityJwksUrl: identityPlatformJwksUrl,
    }));

  it("rejects a project override", () =>
    expect(() =>
      loadConfig({
        NODE_ENV: "production",
        ALLOW_DEV_AUTH: "false",
        IDENTITY_PLATFORM_PROJECT_ID: "other-project",
      }),
    ).toThrow(/monocle-503402/));
});
