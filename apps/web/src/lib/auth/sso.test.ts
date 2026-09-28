import { afterEach, describe, expect, it } from "vitest";
import { clearCommonAccessToken, getCommonAccessToken } from "./sso";

const key = "hanamaru.sso.access";
describe("public OIDC access token storage", () => {
  afterEach(() => clearCommonAccessToken());

  it("returns only a short-lived unexpired token for the API", () => {
    sessionStorage.setItem(key, JSON.stringify({ token: "synthetic-token", expiresAt: Date.now() + 60_000 }));
    expect(getCommonAccessToken()).toBe("synthetic-token");
    sessionStorage.setItem(key, JSON.stringify({ token: "expired-token", expiresAt: Date.now() - 1 }));
    expect(getCommonAccessToken()).toBeNull();
    expect(sessionStorage.getItem(key)).toBeNull();
  });

  it("clears local OIDC credentials on product logout", () => {
    sessionStorage.setItem(key, JSON.stringify({ token: "synthetic-token", expiresAt: Date.now() + 60_000 }));
    clearCommonAccessToken();
    expect(getCommonAccessToken()).toBeNull();
  });
});
