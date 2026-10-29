import { productionSessionRuntime } from "./production-runtime";
import { localServerSso, localSessionGateway } from "./local-session-runtime";

export function sessionRuntime() {
  const deployed = productionSessionRuntime();
  if (deployed) return deployed;
  const gateway = localSessionGateway();
  return gateway ? { gateway, sso: localServerSso(), limit: async () => true } : null;
}

export const unavailableSession = () => Response.json({ error: { code: "SESSION_UNAVAILABLE" } },
  { status: 503, headers: { "cache-control": "private, no-store" } });
export const rateLimitedSession = () => Response.json({ error: { code: "RATE_LIMITED" } },
  { status: 429, headers: { "cache-control": "private, no-store", "retry-after": "60" } });
