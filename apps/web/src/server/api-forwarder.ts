/** P1 transport only. The existing API remains the authorization and write owner. */
export interface ForwarderConfig {
  upstream: string;
  publicOrigin: string;
  allowLocal: boolean;
}

const noStore = "private, no-store";
const requestHeaders = ["authorization", "accept", "content-type", "x-content-sha256", "idempotency-key", "if-match", "x-request-id", "x-organization-id", "range", "if-range"];
const responseHeaders = ["content-type", "content-disposition", "retry-after", "x-request-id", "content-range", "accept-ranges", "etag", "last-modified"];

function error(status: number, code: string, message: string) {
  return Response.json({ error: { code, message } }, { status, headers: { "cache-control": noStore } });
}

function configuredUrl(value: string, allowLocal: boolean, pathname: string) {
  const url = new URL(value);
  if (url.username || url.password || url.search || url.hash || url.pathname !== pathname ||
    !(url.protocol === "https:" || (allowLocal && url.protocol === "http:" && url.hostname === "127.0.0.1"))) {
    throw new Error("Invalid BFF configuration");
  }
  return url;
}
function allowedPath(path: string) {
  if (/^\/api\/v1\/[A-Za-z0-9_/-]+$/.test(path) && !path.includes("//")) return true;
  const prefix="/api/v1/local-uploads/";
  if(!path.startsWith(prefix))return false;
  try {
    const object=decodeURIComponent(path.slice(prefix.length));
    // Local providers encode the whole private object key in the upload URL.
    // Decode once to validate, but forward the original path unchanged.
    return object.startsWith("organizations/")&&/^[A-Za-z0-9_./-]+$/.test(object)&&
      object.split("/").every(segment=>segment!==""&&segment!=="."&&segment!=="..");
  } catch { return false; }
}

export async function forwardApiRequest(request: Request, config: ForwarderConfig, send: typeof fetch = fetch) {
  let upstream: URL;
  let publicOrigin: string;
  try {
    upstream = configuredUrl(config.upstream, config.allowLocal, "/api/v1");
    publicOrigin = configuredUrl(config.publicOrigin, config.allowLocal, "/").origin;
    if (upstream.origin === publicOrigin) throw new Error("BFF loop");
  } catch {
    return error(503, "BFF_UNAVAILABLE", "接続設定を確認できません");
  }
  const url = new URL(request.url);
  // Preserve path/query literally; never let a client choose the destination.
  if (!allowedPath(url.pathname)) {
    return error(400, "INVALID_PATH", "APIのパスを確認してください");
  }
  const method = request.method.toUpperCase();
  if (!["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"].includes(method)) {
    return error(405, "METHOD_NOT_ALLOWED", "利用できない操作です");
  }
  // Cookies and spoofed actor/dev headers must never establish identity here.
  const authorization = request.headers.get("authorization");
  if (!authorization || !/^Bearer [^\s]+$/i.test(authorization)) {
    return error(401, "AUTH_REQUIRED", "ログインしてください");
  }
  const origin = request.headers.get("origin");
  if ((origin && origin !== publicOrigin) ||
    (!["GET", "HEAD"].includes(method) && origin !== publicOrigin) ||
    request.headers.get("sec-fetch-site") === "cross-site") {
    return error(403, "ORIGIN_REJECTED", "同じ画面から操作してください");
  }
  const headers = new Headers();
  for (const name of requestHeaders) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  // Stream unchanged. Large uploads continue to use their existing signed URLs.
  // Do not retry writes: a network error may follow a committed transaction.
  try {
    const init: RequestInit & { duplex?: "half" } = {
      method, headers, cache: "no-store", credentials: "omit", redirect: "manual",
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(30_000)]),
    };
    if (method !== "GET" && method !== "HEAD" && request.body) {
      init.body = request.body;
      init.duplex = "half";
    }
    const response = await send(`${upstream.origin}${url.pathname}${url.search}`, init);
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel();
      return error(502, "UPSTREAM_REDIRECT", "APIの応答を確認できません");
    }
    const outgoing = new Headers({ "cache-control": noStore });
    for (const name of responseHeaders) {
      const value = response.headers.get(name);
      if (value) outgoing.set(name, value);
    }
    return new Response(method === "HEAD" ? null : response.body, { status: response.status, headers: outgoing });
  } catch {
    return error(502, "RESULT_UNKNOWN", "通信を完了できませんでした。保存操作は結果を確認してから再試行してください");
  }
}
