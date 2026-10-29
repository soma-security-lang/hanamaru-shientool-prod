import { sessionRuntime, rateLimitedSession, unavailableSession } from "@/server/session-runtime";
import { auditSessionResponse } from "@/server/session-audit";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  try {
    const runtime = sessionRuntime();
    if (runtime && !await runtime.limit(request)) return rateLimitedSession();
    const sso = runtime?.sso;
    return auditSessionResponse("sso-start",sso ? await sso.start(request) : Response.json({ error: { code: "SSO_UNAVAILABLE" } }, { status: 404, headers: { "cache-control": "private, no-store" } }));
  } catch { return unavailableSession(); }
}
