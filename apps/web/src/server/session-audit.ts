import { randomUUID } from "node:crypto";
type Operation = "login-start" | "session-exchange" | "logout" | "sso-start" | "sso-callback" | "drive-identity";

/** Fixed metadata only: no Cookie, token, subject, query or request/response body. */
export function auditSessionResponse(operation: Operation, response: Response): Response {
  const requestId = randomUUID();
  response.headers.set("x-request-id", requestId);
  console.info(JSON.stringify({ severity: response.status >= 500 ? "ERROR" : response.status >= 400 ? "WARNING" : "INFO",
    component: "web-auth-session", operation, status: response.status, requestId,
    revision: process.env.K_REVISION ?? "local" }));
  return response;
}
