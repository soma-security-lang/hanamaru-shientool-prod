// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import { auditSessionResponse } from "./session-audit";
afterEach(()=>vi.restoreAllMocks());
it("records fixed metadata without credentials or identity payloads",()=>{
  const log=vi.spyOn(console,"info").mockImplementation(()=>{});
  const response=Response.json({sensitive:"synthetic-private-value"},{status:403,headers:{"set-cookie":"synthetic-private-cookie"}});
  expect(auditSessionResponse("session-exchange",response)).toBe(response);
  const event=JSON.parse(log.mock.calls[0]![0]);
  expect(event).toMatchObject({component:"web-auth-session",operation:"session-exchange",status:403,severity:"WARNING"});
  expect(Object.keys(event).sort()).toEqual(["component","operation","requestId","revision","severity","status"]);
  expect(JSON.stringify(event)).not.toContain("synthetic-private");
  expect(response.headers.get("x-request-id")).toBe(event.requestId);
});
