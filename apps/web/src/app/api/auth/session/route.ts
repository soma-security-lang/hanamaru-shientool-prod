import { localSessionGateway } from "@/server/local-session-runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
async function handle(request: Request) {
  const gateway = localSessionGateway();
  try { return gateway ? await gateway.session(request) : Response.json({ error: { code: "NOT_FOUND" } },
    { status: 404, headers: { "cache-control": "private, no-store" } });
  } catch { return Response.json({ error: { code: "SESSION_UNAVAILABLE" } }, { status: 503, headers: { "cache-control": "private, no-store" } }); }
}
export { handle as GET, handle as POST, handle as DELETE };
