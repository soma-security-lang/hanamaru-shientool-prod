import { sessionRuntime, rateLimitedSession, unavailableSession } from "@/server/session-runtime";
import { auditSessionResponse } from "@/server/session-audit";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  try {
    const session = sessionRuntime();
    if (!session) return Response.json({ error: { code: "NOT_FOUND" } }, { status: 404 });
    if (!await session.limit(request)) return rateLimitedSession();
    return auditSessionResponse("login-start",await session.gateway.restart(request));
  } catch { return unavailableSession(); }
}
