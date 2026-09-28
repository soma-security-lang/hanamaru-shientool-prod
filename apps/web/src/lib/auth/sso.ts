"use client";

import * as oidc from "openid-client";

const FLOW_KEY = "hanamaru.sso.flow";
const TOKEN_KEY = "hanamaru.sso.access";
const CLIENT_ID = "sso-hanamaru";
type Flow = { state: string; verifier: string; nonce: string; returnTo: string };
type Access = { token: string; expiresAt: number };

function issuer(): URL {
  const raw = process.env.NEXT_PUBLIC_SSO_ISSUER;
  if (!raw) throw new Error("共通ログインの設定がありません");
  const url = new URL(raw);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && url.hostname === "127.0.0.1"))
    throw new Error("共通ログインの接続先が不正です");
  return url;
}

export function safeReturnTo(value: string): string {
  return value.startsWith("/") && !value.startsWith("//") && !value.includes("\\") &&
    ![...value].some((char) => char.charCodeAt(0) < 32) && !value.startsWith("/login")
    ? value : "/";
}

function callbackUri(): string {
  if (typeof window === "undefined") throw new Error("Browser is required");
  return new URL("/sso/callback", window.location.origin).toString();
}

let cachedClient: Promise<oidc.Configuration> | undefined;
function client(): Promise<oidc.Configuration> {
  const server = issuer();
  cachedClient ??= oidc.discovery(server, CLIENT_ID,
    { token_endpoint_auth_method: "none" }, oidc.None(),
    server.protocol === "http:" ? { execute: [oidc.allowInsecureRequests] } : undefined);
  return cachedClient;
}

export function commonLoginConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SSO_ISSUER);
}

export async function beginCommonLogin(returnTo = "/"): Promise<void> {
  const configuration = await client();
  const flow: Flow = {
    state: oidc.randomState(), verifier: oidc.randomPKCECodeVerifier(),
    nonce: oidc.randomNonce(), returnTo: safeReturnTo(returnTo),
  };
  sessionStorage.setItem(FLOW_KEY, JSON.stringify(flow));
  const authorization = oidc.buildAuthorizationUrl(configuration, {
    redirect_uri: callbackUri(), scope: "openid",
    code_challenge: await oidc.calculatePKCECodeChallenge(flow.verifier),
    code_challenge_method: "S256", state: flow.state, nonce: flow.nonce, max_age: "28800",
  });
  window.location.assign(authorization.toString());
}

export async function completeCommonLogin(currentUrl: URL): Promise<string> {
  const raw = sessionStorage.getItem(FLOW_KEY);
  sessionStorage.removeItem(FLOW_KEY);
  if (!raw) throw new Error("ログインをやり直してください");
  const flow = JSON.parse(raw) as Flow;
  if (!flow.state || !flow.verifier || !flow.nonce) throw new Error("ログイン状態が不正です");
  const tokens = await oidc.authorizationCodeGrant(await client(), currentUrl, {
    pkceCodeVerifier: flow.verifier, expectedState: flow.state, expectedNonce: flow.nonce,
  });
  if (!tokens.access_token || !tokens.expires_in || !tokens.claims()?.sub)
    throw new Error("共通ログインを確認できませんでした");
  const access: Access = { token: tokens.access_token, expiresAt: Date.now() + tokens.expires_in * 1000 };
  sessionStorage.setItem(TOKEN_KEY, JSON.stringify(access));
  window.history.replaceState({}, "", callbackUri());
  return safeReturnTo(flow.returnTo);
}

export function getCommonAccessToken(): string | null {
  if (typeof window === "undefined") return null;
  const raw = sessionStorage.getItem(TOKEN_KEY);
  if (!raw) return null;
  try {
    const access = JSON.parse(raw) as Access;
    if (typeof access.token === "string" && Number.isFinite(access.expiresAt) &&
        access.expiresAt > Date.now() + 5_000) return access.token;
  } catch { /* stale browser storage */ }
  sessionStorage.removeItem(TOKEN_KEY);
  return null;
}

export function clearCommonAccessToken(): void {
  if (typeof window !== "undefined") {
    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(FLOW_KEY);
  }
}

export function commonAppsUrl(): string | null {
  try { return new URL("/apps", issuer()).toString(); } catch { return null; }
}
