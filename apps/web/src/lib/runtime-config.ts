type RuntimeConfig = { apiBaseUrl?: string; ssoIssuer?: string };

declare global {
  interface Window { __HANAMARU_RUNTIME_CONFIG?: RuntimeConfig }
}

function runtime(): RuntimeConfig | undefined {
  return typeof window === "undefined" ? undefined : window.__HANAMARU_RUNTIME_CONFIG;
}

export function runtimeApiBaseUrl(): string {
  const value = runtime()?.apiBaseUrl ?? process.env.NEXT_PUBLIC_API_BASE_URL ?? "/api/v1";
  if (value === "/api/v1") return value;
  const url = new URL(value);
  if ((url.protocol !== "https:" && !(url.protocol === "http:" && url.hostname === "127.0.0.1")) ||
    url.username || url.password || url.search || url.hash || url.pathname !== "/api/v1")
    throw new Error("API connection is not a registered /api/v1 endpoint");
  return url.toString().replace(/\/$/, "");
}

export function runtimeSsoIssuer(): string | undefined {
  const value = runtime()?.ssoIssuer ?? process.env.NEXT_PUBLIC_SSO_ISSUER;
  if (!value) return undefined;
  const url = new URL(value);
  if ((url.protocol !== "https:" && !(url.protocol === "http:" && url.hostname === "127.0.0.1")) ||
    url.username || url.password || url.search || url.hash || (url.pathname !== "/" && url.pathname !== ""))
    throw new Error("SSO issuer must be a trusted origin");
  return url.origin;
}
