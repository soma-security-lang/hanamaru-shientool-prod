import { assertProductionDatabase, type SessionKeyRing } from "@hanamaru/alignment";

export function productionSessionConfig(env: Readonly<Record<string, string | undefined>> = process.env) {
  if (env.HANAMARU_PRODUCTION_SESSION !== "true") {
    if (env.HANAMARU_PRODUCTION_NATIVE_API === "true") throw new Error("PRODUCTION_SESSION_REQUIRED");
    return null;
  }
  try {
    const origin = new URL(env.HANAMARU_PUBLIC_ORIGIN ?? "");
    const upstream = new URL(env.HANAMARU_BFF_UPSTREAM ?? "");
    const transport = new URL(env.HANAMARU_WEB_SERVICE_ORIGIN ?? "");
    const stage = (env.K_SERVICE ?? "").includes("stage");
    if (env.NODE_ENV !== "production" || !/^hanamaru-(?:pilot-web|pilot-stage-web|alignment-stage-web)$/.test(env.K_SERVICE ?? "") ||
        env.HANAMARU_LOCAL_SESSION_POC === "true" || env.HANAMARU_BFF_LOCAL === "true" ||
        env.HANAMARU_BFF_ENABLED !== "true" || env.HANAMARU_RUNTIME_API_BASE_URL !== "/api/v1" ||
        origin.protocol !== "https:" || origin.origin !== env.HANAMARU_PUBLIC_ORIGIN ||
        (!stage && origin.origin !== "https://monocle-503402.firebaseapp.com") ||
        transport.protocol !== "https:" || transport.origin !== env.HANAMARU_WEB_SERVICE_ORIGIN ||
        !/^hanamaru-(?:pilot-web|pilot-stage-web|alignment-stage-web)-[a-z0-9-]+\.a\.run\.app$/.test(transport.hostname) ||
        upstream.protocol !== "https:" || upstream.username || upstream.password || upstream.search || upstream.hash || upstream.pathname !== "/api/v1" ||
        !/^hanamaru-(?:pilot-api|alignment-stage-api)-[a-z0-9-]+\.a\.run\.app$/.test(upstream.hostname) ||
        (stage && upstream.hostname.startsWith("hanamaru-pilot-api-"))) throw new Error("invalid");
    const database = { connectionName: env.HANAMARU_DATABASE_CONNECTION_NAME ?? "", databaseName: env.HANAMARU_DATABASE_NAME ?? "" };
    const session = { ...database, url: env.HANAMARU_SESSION_DATABASE_URL ?? "", max: 2, sessionOnly: true };
    assertProductionDatabase(session, env);
    const native = env.HANAMARU_PRODUCTION_NATIVE_API === "true";
    const business = native ? { ...database, url: env.DATABASE_URL ?? "", max: 3 } : undefined;
    if (business) {
      assertProductionDatabase(business, env);
      if (env.DATABASE_CONTEXT_ROLE !== "hanamaru_api" || env.DATABASE_SYSTEM_ROLE !== "hanamaru_api_system") throw new Error("invalid");
    }
    const keys = JSON.parse(env.HANAMARU_SESSION_KEYS_JSON ?? "{}") as SessionKeyRing;
    if (!keys || !/^[a-zA-Z0-9_-]{1,32}$/.test(keys.activeVersion) || !keys.keys?.[keys.activeVersion] ||
      !Object.keys(keys.keys).length || Object.keys(keys.keys).length > 4 ||
      Object.entries(keys.keys).some(([version, key]) => !/^[a-zA-Z0-9_-]{1,32}$/.test(version) || !/^[a-f0-9]{64}$/i.test(key))) throw new Error("invalid");
    const sso = env.HANAMARU_SERVER_SSO === "true";
    if (sso) {
      const issuer = new URL(env.SSO_ISSUER ?? "");
      if (issuer.protocol !== "https:" || issuer.origin !== env.SSO_ISSUER || !env.SSO_INTERNAL_SECRET || env.SSO_INTERNAL_SECRET.length < 32)
        throw new Error("invalid");
    }
    return { publicOrigin: origin.origin, upstream: upstream.toString(), transportHosts: [transport.host], allowLocal: false,
      explicitSessionBootstrap: true, session, business, keys: { ...keys, maxSessions: 10000 }, sso };
  } catch { throw new Error("PRODUCTION_SESSION_CONFIGURATION_REQUIRED"); }
}
