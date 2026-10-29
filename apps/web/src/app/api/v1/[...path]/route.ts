import { forwardApiRequest } from "@/server/api-forwarder";
import { sessionRuntime, unavailableSession } from "@/server/session-runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handle(request: Request) {
  if (process.env.HANAMARU_BFF_ENABLED !== "true") {
    return Response.json({ error: { code: "NOT_FOUND", message: "見つかりません" } },
      { status: 404, headers: { "cache-control": "private, no-store" } });
  }
  try {
    const session = sessionRuntime();
    if (session) {
      if ("legacy" in session && request.headers.has("authorization")) return await session.legacy(request);
      return await session.gateway.forward(request);
    }
  } catch { return unavailableSession(); }
  if (process.env.HANAMARU_LOCAL_SESSION_POC === "true") {
    return Response.json({ error: { code: "SESSION_UNAVAILABLE", message: "ローカル認証設定を確認してください" } },
      { status: 503, headers: { "cache-control": "private, no-store" } });
  }
  return forwardApiRequest(request, {
    upstream: process.env.HANAMARU_BFF_UPSTREAM ?? "",
    publicOrigin: process.env.HANAMARU_BFF_PUBLIC_ORIGIN ?? "",
    allowLocal: process.env.HANAMARU_BFF_LOCAL === "true" && process.env.K_SERVICE === undefined,
  });
}

export { handle as GET, handle as HEAD, handle as POST, handle as PUT, handle as PATCH, handle as DELETE };
