import { randomUUID } from "node:crypto";
import { authenticate, registerRoutes, BackendService, ApiProblem, type ApiConfig, type IdentityTokenVerifier } from "@hanamaru/api/alignment";

type Registry = Parameters<typeof registerRoutes>[0];
type AuthRequest = Parameters<typeof authenticate>[0] & { auth: Awaited<ReturnType<typeof authenticate>> };
type Handler = (request: AuthRequest, reply: Reply) => Promise<unknown>;
class Reply {
  status = 200;
  headers = new Headers({ "cache-control": "private, no-store", "x-content-type-options": "nosniff",
    "content-security-policy": "default-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
    "x-frame-options": "DENY", "referrer-policy": "no-referrer" });
  sent = false;
  body: unknown;
  code(value: number) { this.status = value; return this; }
  header(name: string, value: string) { this.headers.set(name, value); return this; }
  type(value: string) { return this.header("content-type", value); }
  send(value?: unknown) { this.sent = true; this.body = value; return this; }
}
function parserFailure(reply: Reply, id: string) {
  // The current Fastify error handler normalizes parser/body-limit failures to
  // this envelope. Preserve it during migration; change HTTP policy separately.
  return Response.json({error:{code:"INTERNAL_ERROR",message:"処理を完了できませんでした。Request IDを管理者へお伝えください。",fieldErrors:[],retryable:false},requestId:id}, {status:500,headers:reply.headers});
}

/** Native Request/Response execution; no HTTP loopback or second business writer.
 * Binary/redirect and infrastructure endpoints deliberately remain legacy-owned.
 */
export async function nativeApi(service: BackendService, config: ApiConfig, verifier?: IdentityTokenVerifier) {
  const routes: Array<{ method: string; path: string; handler: Handler; public: boolean }> = [];
  const registry = Object.fromEntries(["get", "post", "put", "patch", "delete"].map(method => [method,
    (path: string, options: Handler | { config?: { public?: boolean } }, handler?: Handler) => {
      routes.push({ method: method.toUpperCase(), path, handler: handler ?? options as Handler,
        public: typeof options !== "function" && options.config?.public === true });
    }])) as unknown as Registry;
  await registerRoutes(registry, service);
  const supported = routes.filter(route => route.path.startsWith("/api/v1/") && !route.public &&
    !/\/file$|local-upload|openapi\.json/.test(route.path));
  const counts = new Map<string, { until: number; count: number }>();
  return {
    paths: supported.map(r => `${r.method} ${r.path}`),
    async handle(input: Request): Promise<Response | null> {
      const url = new URL(input.url);
      let params: Record<string, string> = {};
      const found = supported.find(route => {
        if (route.method !== input.method && !(input.method === "HEAD" && route.method === "GET")) return false;
        const expected = route.path.split("/"), actual = url.pathname.split("/");
        if (expected.length !== actual.length) return false;
        const candidate: Record<string, string> = {};
        for (let i = 0; i < expected.length; i++) {
          if (expected[i]!.startsWith(":")) {
            try { candidate[expected[i]!.slice(1)] = decodeURIComponent(actual[i]!); } catch { return false; }
          } else if (expected[i] !== actual[i]) return false;
        }
        params = candidate; return true;
      });
      if (!found) return null; // Only unsupported routes may use the legacy owner.
      // Choose the owner before reading or executing anything. Legacy retains
      // non-JSON parsers/streams, including those submitted to a JSON route.
      const contentType=input.headers.get("content-type")?.split(";")[0];
      if(input.body&&contentType!=="application/json")return null;
      const suppliedId = input.headers.get("x-request-id");
      const id = suppliedId && /^[A-Za-z0-9._:-]{8,64}$/.test(suppliedId) ? suppliedId : randomUUID();
      const reply = new Reply().header("x-request-id", id);
      try {
        const query: Record<string, string | string[]> = {};
        for (const [key, value] of url.searchParams) query[key] = key in query ? [...[query[key]].flat() as string[], value] : value;
        const request = { id, headers: Object.fromEntries(input.headers), params, query } as unknown as AuthRequest;
        request.auth = await authenticate(request, config, service.repository, verifier);
        const now = Date.now();
        for (const [key, value] of counts) if (value.until <= now) counts.delete(key);
        const limit = counts.get(request.auth.membershipId) ?? { until: now + 60_000, count: 0 };
        counts.set(request.auth.membershipId, limit);
        if (++limit.count > config.rateLimitMax) return Response.json({ error: { code: "RATE_LIMITED" } }, { status: 429, headers: reply.headers });
        if (!["GET", "HEAD"].includes(input.method)) {
          const type = input.headers.get("content-type")?.split(";")[0];
          const reader = input.body?.getReader(); const chunks: Uint8Array[] = []; let size = 0;
          if (reader) for (;;) { const part = await reader.read(); if (part.done) break; size += part.value.length;
            if (size > 2_000_000) { await reader.cancel(); return parserFailure(reply,id); }
            chunks.push(part.value);
          }
          if(!size&&type==="application/json")return parserFailure(reply,id);
          try { request.body = size ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : undefined; }
          catch { return parserFailure(reply,id); }
        }
        const returned = await found.handler(request, reply);
        const value = reply.sent ? reply.body : returned;
        if (input.method === "HEAD" || reply.status === 204 || value === undefined) return new Response(null, { status: reply.status, headers: reply.headers });
        return Response.json(value, { status: reply.status, headers: reply.headers });
      } catch (error) {
        if (error instanceof ApiProblem) return Response.json({ error: { code: error.code, message: error.message, fieldErrors: error.fieldErrors, retryable: error.retryable }, requestId: id }, { status: error.statusCode, headers: reply.headers });
        const message = error instanceof Error ? error.message : "";
        const temporary = message.startsWith("PROVIDER_TEMPORARY:"), permanent = message.startsWith("PROVIDER_PERMANENT:");
        return Response.json({ error: { code: temporary ? "PROVIDER_TEMPORARY" : permanent ? "PROVIDER_PERMANENT" : "INTERNAL_ERROR", message: temporary ? "外部サービスが一時的に利用できません。時間をおいて再実行してください。" : permanent ? "外部サービスの処理を完了できませんでした。入力または接続設定を確認してください。" : "処理を完了できませんでした。Request IDを管理者へお伝えください。", fieldErrors: [], retryable: temporary }, requestId: id }, { status: temporary ? 503 : permanent ? 422 : 500, headers: reply.headers });
      }
    },
  };
}
