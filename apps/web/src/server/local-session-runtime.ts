import { LocalSessionGateway } from "./session-gateway";
import { localPrisma, PrismaSessionStore } from "@hanamaru/alignment";
import { localApiFetch } from "./native-runtime";
import { ServerSso } from "./server-sso";

type Runtime = { configKey: string; gateway: LocalSessionGateway; sso?: ServerSso; dispose?: () => Promise<void> };
const holder = globalThis as typeof globalThis & { hanamaruLocalSession?: Runtime };
function reset() {
  const old = holder.hanamaruLocalSession;
  delete holder.hanamaruLocalSession;
  void old?.dispose?.().catch(() => {});
}

/** Both local stores are intentionally impossible to enable on Cloud Run. */
export function localSessionGateway(): LocalSessionGateway | null {
  if (process.env.HANAMARU_LOCAL_SESSION_POC !== "true" || process.env.K_SERVICE !== undefined ||
    process.env.HANAMARU_BFF_ENABLED !== "true" || process.env.HANAMARU_BFF_LOCAL !== "true") {
    reset();
    return null;
  }
  const upstream = process.env.HANAMARU_BFF_UPSTREAM ?? "";
  const publicOrigin = process.env.HANAMARU_BFF_PUBLIC_ORIGIN ?? "";
  try {
    const api = new URL(upstream), web = new URL(publicOrigin);
    if ([api, web].some(url => url.protocol !== "http:" || url.hostname !== "127.0.0.1" || url.username || url.password || url.search || url.hash) ||
      api.pathname !== "/api/v1" || web.pathname !== "/" || api.origin === web.origin || publicOrigin !== web.origin) {
      reset();
      return null;
    }
  } catch { reset(); return null; }
  const mode = process.env.HANAMARU_SESSION_STORE ?? "memory";
  if (!["memory", "postgres"].includes(mode)) { reset(); return null; }
  const longSessions = process.env.HANAMARU_LOCAL_LONG_SESSION === "true";
  if (longSessions && (mode !== "postgres" || process.env.HANAMARU_SERVER_SSO !== "true")) { reset(); return null; }
  // Configuration is server-only; never return or log this cache identity.
  const configKey = JSON.stringify([publicOrigin, upstream, mode, process.env.ALIGNMENT_DATABASE_URL,
    process.env.ALIGNMENT_SESSION_KEY, process.env.HANAMARU_SERVER_SSO, process.env.SSO_ISSUER, longSessions]);
  if (holder.hanamaruLocalSession?.configKey !== configKey) {
    reset();
    let prisma: ReturnType<typeof localPrisma> | undefined;
    try {
      prisma = mode === "postgres" ? localPrisma(process.env.ALIGNMENT_DATABASE_URL ?? "") : undefined;
      const store = prisma ? new PrismaSessionStore(prisma, process.env.ALIGNMENT_SESSION_KEY ?? "") : undefined;
      const gateway = new LocalSessionGateway({ publicOrigin, upstream, allowLocal: true }, localApiFetch, Date.now, 128, store);
      const diagnostic = process.env.HANAMARU_REAL_SSO_TEST === "true" ? (stage: string, code: string) => console.info("LOCAL_SSO_RENEWAL_DIAGNOSTIC", stage, code) : undefined;
      const sso = store && process.env.HANAMARU_SERVER_SSO === "true" ? new ServerSso(process.env.SSO_ISSUER ?? "", publicOrigin, store, gateway, longSessions, diagnostic) : undefined;
      holder.hanamaruLocalSession = { configKey, gateway, sso, dispose: prisma ? () => prisma!.$disconnect() : undefined };
    } catch { void prisma?.$disconnect().catch(() => {}); return null; }
  }
  return holder.hanamaruLocalSession.gateway;
}

export function localServerSso(): ServerSso | null {
  if (!localSessionGateway()) return null;
  return holder.hanamaruLocalSession?.sso ?? null;
}
