import { sessionRuntime, rateLimitedSession, unavailableSession } from "@/server/session-runtime";
import { auditSessionResponse } from "@/server/session-audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
async function handle(request: Request) {
  try {
    const runtime = sessionRuntime();
    if (runtime && !await runtime.limit(request)) return rateLimitedSession();
    const response=runtime ? await runtime.gateway.session(request) : Response.json({ error: { code: "NOT_FOUND" } },
      { status: 404, headers: { "cache-control": "private, no-store" } });
    return request.method==="GET"?response:auditSessionResponse(request.method==="DELETE"?"logout":"session-exchange",response);
  } catch { return unavailableSession(); }
}
export { handle as GET, handle as POST, handle as DELETE };
