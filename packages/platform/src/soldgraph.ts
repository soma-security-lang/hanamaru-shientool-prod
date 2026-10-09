import type { SoldgraphPageProvider, SoldgraphFailureClass, SoldgraphUsage } from "@hanamaru/contracts";
import { parseSoldgraphEnvelope, parseSoldgraphUsage, soldgraphRequestUrl, validSoldgraphRequestId } from "@hanamaru/market-price";

export type { SoldgraphFailureClass } from "@hanamaru/contracts";

export class SoldgraphProviderError extends Error {
  constructor(readonly failureClass: SoldgraphFailureClass, readonly retryAfterSeconds: number | null = null) {
    super(failureClass);
    this.name = "SoldgraphProviderError";
  }
}

/** Fixed-host adapter; construction performs no I/O. */
export function createSoldgraphProvider(options: {
  apiKey: string;
  allowExternalRequests: boolean;
  /** Required injection; there is intentionally no default ambient fetch. */
  transport: typeof fetch;
  timeoutMs?: number;
}): SoldgraphPageProvider & {usage:()=>Promise<SoldgraphUsage>} {
  const timeoutMs = options.timeoutMs ?? 25_000;
  const maxBytes = 2 * 1024 * 1024;
  async function perform<T>(url: string,parse:(raw:unknown)=>T,statuses:readonly number[],operationKey?: string):Promise<T> {
    if (!options.allowExternalRequests) throw new SoldgraphProviderError("EXTERNAL_DISABLED");
    if (!options.apiKey || /\s/.test(options.apiKey) || options.apiKey.length > 4096) throw new SoldgraphProviderError("CONFIGURATION");
    const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await options.transport(url, { method: "GET", redirect: "manual", cache: "no-store", signal: controller.signal,
        headers: { Authorization: `Bearer ${options.apiKey}`, Accept: "application/json", ...(operationKey ? { "Idempotency-Key": operationKey } : {}) } });
      // A provider redirect is not followed, including same-origin redirects.
      if (response.status >= 300 && response.status < 400) throw new SoldgraphProviderError("CONTRACT");
      if (!response.body) throw new SoldgraphProviderError("CONTRACT");
      const reader = response.body.getReader(), chunks: Uint8Array[] = [];
      let total = 0;
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          total += value.byteLength;
          // A tee/clone may wait for its other reader when cancellation is awaited.
          // Reject immediately; cancellation still releases the consumed branch.
          if (total > maxBytes) { void reader.cancel().catch(() => {}); throw new SoldgraphProviderError("CONTRACT"); }
          chunks.push(value);
        }
      } finally { reader.releaseLock(); }
      let raw: unknown;
      try { raw = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
      catch { throw new SoldgraphProviderError("CONTRACT"); }
      if (!response.ok) {
        const record = raw !== null && typeof raw === "object" ? raw as Record<string, unknown> : {};
        const error = record.error !== null && typeof record.error === "object" ? record.error as Record<string, unknown> : {};
        const code = error.code ?? record.code;
        const classes: Record<string, SoldgraphFailureClass> = {
          invalid_api_key: "CONFIGURATION", account_suspended: "CONFIGURATION", rate_limited: "RATE_LIMIT",
          too_many_pending: "PENDING_LIMIT", quota_exceeded: "QUOTA", upstream_daily_limit: "UPSTREAM_LIMIT",
          idempotency_conflict: "IDEMPOTENCY_CONFLICT", request_not_found: "RESULT_UNKNOWN", queue_full: "TRANSPORT",
        };
        const retry = response.headers.get("retry-after");
        const seconds = retry && /^\d+$/.test(retry) ? Number(retry)
          : retry && Number.isFinite(Date.parse(retry)) ? Math.max(0, Math.ceil((Date.parse(retry) - Date.now()) / 1000)) : null;
        throw new SoldgraphProviderError(typeof code === "string" && classes[code] ? classes[code]!
          : response.status === 401 || response.status === 403 ? "CONFIGURATION"
          : response.status === 429 ? "RESULT_UNKNOWN" : "TRANSPORT", seconds !== null && Number.isSafeInteger(seconds) ? seconds : null);
      }
      if (!statuses.includes(response.status)) throw new SoldgraphProviderError("CONTRACT");
      try { return parse(raw); }
      catch { throw new SoldgraphProviderError("CONTRACT"); }
    } catch (error) {
      if (error instanceof SoldgraphProviderError) throw error;
      // Do not attach cause: fetch errors can include credentials or query URLs.
      throw new SoldgraphProviderError("TRANSPORT");
    } finally { clearTimeout(timeout); }
  }
  return {
    submit(request, key) {
      if (!/^sg-[a-f0-9]{64}$/.test(key)) throw new SoldgraphProviderError("IDEMPOTENCY_CONFLICT");
      return perform(soldgraphRequestUrl(request),raw=>parseSoldgraphEnvelope(raw),[200,202],key);
    },
    poll(requestId) {
      if (!validSoldgraphRequestId(requestId)) throw new SoldgraphProviderError("CONTRACT");
      // poll_url is never executed. The request ID and fixed origin are the only inputs.
      return perform(`https://api.soldgraph.com/v1/jobs/${requestId}?wait=20`,raw=>parseSoldgraphEnvelope(raw,requestId),[200,202]);
    },
    usage(){return perform("https://api.soldgraph.com/v1/usage",parseSoldgraphUsage,[200]);},
  };
}

/** Deployment permission is distinct from organization flags and DB execution mode. */
export function createConfiguredSoldgraphProvider(environment:Readonly<Record<string,string|undefined>>,transport:typeof fetch){
  const allowed=environment.SOLDGRAPH_ALLOW_EXTERNAL_REQUESTS;
  if(allowed===undefined||allowed==="false")return undefined;
  if(allowed!=="true")throw new SoldgraphProviderError("CONFIGURATION");
  const accountId=environment.SOLDGRAPH_ACCOUNT_ID,apiKey=environment.SOLDGRAPH_API_KEY;
  if(!accountId||!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(accountId)
    ||!apiKey||/\s/.test(apiKey)||apiKey.length>4096)throw new SoldgraphProviderError("CONFIGURATION");
  return createSoldgraphProvider({apiKey,allowExternalRequests:true,transport});
}
