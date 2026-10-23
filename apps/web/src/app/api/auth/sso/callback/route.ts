import { localServerSso } from "@/server/local-session-runtime";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const sso = localServerSso();
    return sso ? await sso.callback(request) : Response.json({ error: { code: "SSO_UNAVAILABLE" } }, { status: 404, headers: { "cache-control": "private, no-store" } });
  } catch { return Response.json({ error: { code: "SSO_UNAVAILABLE" } }, { status: 503, headers: { "cache-control": "private, no-store" } }); }
}
