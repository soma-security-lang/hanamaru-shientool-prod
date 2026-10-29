import { createHash } from "node:crypto";
import { productionPrisma, PrismaRateLimit, PrismaRepository, PrismaSessionStore } from "@hanamaru/alignment";
import { BackendService, loadConfig } from "@hanamaru/api/alignment";
import { productionSessionConfig } from "./production-config";
import { LocalSessionGateway } from "./session-gateway";
import { ServerSso } from "./server-sso";
import { nativeApi } from "./native-api";
import { forwardApiRequest } from "./api-forwarder";

type Runtime = { fingerprint: string; gateway: LocalSessionGateway; sso?: ServerSso; limit: (request: Request) => Promise<boolean>;
  ready: () => Promise<void>; legacy: (request: Request) => Promise<Response> };
let current: Runtime | undefined;

/** No memory store, loopback providers or alternate writer fallback in production. */
export function productionSessionRuntime(): Runtime | null {
  const config = productionSessionConfig();
  if (!config) return null;
  const fingerprint = createHash("sha256").update(JSON.stringify([config,process.env.SSO_ISSUER,process.env.SSO_INTERNAL_SECRET])).digest("hex");
  if (current) {
    if (current.fingerprint !== fingerprint) throw new Error("SESSION_RUNTIME_RESTART_REQUIRED");
    return current;
  }
  const database = productionPrisma(config.session);
  const store = new PrismaSessionStore(database, config.keys);
  const limiter = new PrismaRateLimit(database);
  let native: ReturnType<typeof nativeApi> | undefined;
  const send: typeof fetch = async (input, init) => {
    const request = input instanceof Request && !init ? input : new Request(input, init);
    if (new URL(request.url).origin !== new URL(config.upstream).origin) throw new Error("UNREGISTERED_API_ORIGIN");
    if (config.business) {
      native ??= (async () => {
        const { createProviders } = await import("@hanamaru/platform");
        const providers = createProviders();
        if (providers.mode !== "gcp") throw new Error("PRODUCTION_PROVIDER_REQUIRED");
        const repository = new PrismaRepository(productionPrisma(config.business!), config.business!.url, "hanamaru_api", "hanamaru_api_system");
        return nativeApi(new BackendService(repository, providers), loadConfig(), undefined,
          membershipId => limiter.consume("business-api", membershipId, 300));
      })();
      const response = await (await native).handle(request);
      if (response) return response;
    }
    // Unsupported streams/binary routes are selected before reading/executing.
    return fetch(request);
  };
  const gateway = new LocalSessionGateway(config, send, Date.now, 10000, store);
  const sso = config.sso ? new ServerSso(process.env.SSO_ISSUER!, config.publicOrigin, store, gateway, true, undefined,
    { transportHosts: config.transportHosts }) : undefined;
  current = { fingerprint, gateway, ...(sso ? { sso } : {}), legacy: async request => {
    if (/(?:^|;\s*)__session=/.test(request.headers.get("cookie") ?? ""))
      return Response.json({ error: { code: "MIXED_CREDENTIALS" } }, { status: 400, headers: { "cache-control": "private, no-store" } });
    return forwardApiRequest(request, config, send);
  }, ready: async () => {
    await database.alignmentSession.count();
    await database.$queryRaw`SELECT 1 FROM alignment_rate_limits LIMIT 0`;
  }, limit: async request => {
    const cookie = request.headers.get("cookie")?.match(/(?:^|;\s*)__session=([A-Za-z0-9_-]{43})(?:;|$)/)?.[1];
    const mutation = request.method !== "GET";
    if (!await limiter.consume("auth-global", mutation ? "mutation" : "read", mutation ? 600 : 6000)) return false;
    return !cookie || limiter.consume(mutation ? "auth-mutation" : "auth-read", cookie, mutation ? 20 : 600);
  } };
  return current;
}
