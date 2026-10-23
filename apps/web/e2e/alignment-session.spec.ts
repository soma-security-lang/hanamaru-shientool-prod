import { createServer, type Server } from "node:http";
import { test, expect, type Page } from "@playwright/test";

test.skip(process.env.HANAMARU_SESSION_TEST !== "true", "Isolated session config and synthetic API required");
const origin = "http://127.0.0.1:3357";
const organizationId = "00000000-0000-4000-8000-000000000002";
let server: Server;
let revoked = false;
const received: Array<{ path: string; cookie?: string; csrf?: string; organization?: string; method?: string; key?: string }> = [];
test.beforeAll(async () => {
  server = createServer(async (req, res) => {
    for await (const chunk of req) void chunk;
    received.push({ path: req.url!, method: req.method, cookie: req.headers.cookie,
      csrf: req.headers["x-csrf-token"] as string | undefined, organization: req.headers["x-organization-id"] as string | undefined,
      key: req.headers["idempotency-key"] as string | undefined });
    res.setHeader("content-type", "application/json");
    if (revoked || req.headers.authorization !== "Bearer synthetic-session-browser") {
      res.writeHead(401).end('{"error":{"code":"DENIED"}}');
    } else if (req.url === "/api/v1/me") {
      res.end(JSON.stringify({ id: "00000000-0000-4000-8000-000000000001", status: "active", roles: ["assessor"] }));
    } else if (req.url === "/api/v1/unknown") {
      req.socket.destroy();
    } else {
      res.end('{"saved":true}');
    }
  });
  await new Promise<void>(resolve => server.listen(3358, "127.0.0.1", resolve));
});
test.afterAll(async () => { await new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve())); });
test.beforeEach(async ({ page }) => {
  revoked = false; received.length = 0;
  await page.route("**/*", route => new URL(route.request().url()).hostname === "127.0.0.1" ? route.continue() : route.abort());
  await page.goto("/login");
});
async function login(page: Page) {
  return page.evaluate(async organization => {
    const initial = await (await fetch("/api/auth/session")).json();
    const response = await fetch("/api/auth/session", { method: "POST", headers: {
      "x-csrf-token": initial.csrfToken, authorization: "Bearer synthetic-session-browser", "x-organization-id": organization,
    } });
    return { status: response.status, body: await response.json() };
  }, organizationId);
}
test("E2E-SESSION-01 exchange, cookie-only API, reload and logout use actual Next routes", async ({ page, context }) => {
  const result = await login(page);
  expect(result.status, result.body.error?.code).toBe(200); expect(result.body.authenticated).toBe(true);
  const cookies = await context.cookies();
  const session = cookies.find(cookie => cookie.name === "__session")!;
  expect(session.httpOnly).toBe(true); expect(session.sameSite).toBe("Lax");
  expect(await page.evaluate(() => document.cookie)).not.toContain("__session");
  expect(await page.evaluate(async csrf => (await fetch("/api/v1/visits", {
    method: "POST", headers: { "x-csrf-token": csrf, "idempotency-key": "browser-operation-1" }, body: "{}",
  })).status, result.body.csrfToken)).toBe(200);
  await page.reload();
  const restored = await page.evaluate(async () => (await fetch("/api/auth/session")).json());
  expect(restored.authenticated).toBe(true);
  expect(restored.csrfToken).toBe(result.body.csrfToken);
  const writes = received.filter(item => item.method === "POST");
  expect(writes).toHaveLength(1);
  expect(writes[0]).toMatchObject({ cookie: undefined, csrf: undefined, organization: organizationId, key: "browser-operation-1" });
  const logout = await page.evaluate(async csrf => {
    const response = await fetch("/api/auth/session", { method: "DELETE", headers: { "x-csrf-token": csrf } });
    return { status: response.status, protectedStatus: (await fetch("/api/v1/me")).status };
  }, restored.csrfToken);
  expect(logout).toEqual({ status: 200, protectedStatus: 401 });
  expect((await context.cookies()).some(cookie => cookie.name === "__session")).toBe(false);
});
test("E2E-SESSION-02 CSRF, hostile origin, organization substitution and Bearer fallback are rejected", async ({ page, context }) => {
  const result = await login(page); const count = received.length;
  const statuses = await page.evaluate(async csrf => {
    const requests = [
      fetch("/api/v1/visits", { method: "POST" }),
      fetch("/api/v1/me", { headers: { "x-organization-id": "00000000-0000-4000-8000-000000000003" } }),
      fetch("/api/v1/me", { headers: { authorization: "Bearer synthetic-session-browser" } }),
      fetch("/api/auth/session", { method: "DELETE", headers: { "x-csrf-token": `${csrf}wrong` } }),
    ];
    return Promise.all(requests.map(async promise => (await promise).status));
  }, result.body.csrfToken);
  expect(statuses).toEqual([403, 403, 400, 403]);
  const hostile = await context.request.post(`${origin}/api/v1/visits`, { headers: { origin: "https://evil.invalid", "x-csrf-token": result.body.csrfToken } });
  expect(hostile.status()).toBe(403); expect(received).toHaveLength(count);
});
test("E2E-SESSION-03 revoked membership blocks existing browser session", async ({ page }) => {
  await login(page); revoked = true;
  expect(await page.evaluate(async () => (await fetch("/api/v1/me")).status)).toBe(401);
  revoked = false;
  expect(await page.evaluate(async () => (await fetch("/api/v1/me")).status)).toBe(401);
});
test("E2E-SESSION-04 connection loss after write is not automatically retried", async ({ page }) => {
  const result = await login(page);
  const response = await page.evaluate(async csrf => {
    const response = await fetch("/api/v1/unknown", { method: "POST", headers: { "x-csrf-token": csrf }, body: "{}" });
    return { status: response.status, body: await response.json() };
  }, result.body.csrfToken);
  expect(response.status).toBe(502); expect(response.body.error.code).toBe("RESULT_UNKNOWN");
  expect(received.filter(item => item.path === "/api/v1/unknown")).toHaveLength(1);
});
