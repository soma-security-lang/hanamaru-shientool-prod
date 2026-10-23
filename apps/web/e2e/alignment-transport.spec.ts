import { createServer, type Server } from "node:http";
import { test, expect } from "@playwright/test";

test.skip(process.env.HANAMARU_ALIGNMENT_TEST !== "true", "Requires isolated alignment config and synthetic upstream");

let upstream: Server;
const received: Array<{ path: string; body: string; key: string | undefined; cookie: string | undefined }> = [];
test.beforeAll(async () => {
  upstream = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    received.push({ path: req.url ?? "", body: Buffer.concat(chunks).toString(), key: req.headers["idempotency-key"] as string | undefined, cookie: req.headers.cookie });
    res.setHeader("content-type", "application/json");
    if (req.headers.authorization !== "Bearer synthetic-transport-fixture") {
      res.writeHead(401).end('{"error":{"code":"AUTH_REQUIRED"}}');
    } else if (req.method === "POST") {
      res.writeHead(409).end('{"error":{"code":"CONFLICT"}}');
    } else {
      res.end('{"fixture":true}');
    }
  });
  await new Promise<void>(resolve => upstream.listen(3348, "127.0.0.1", resolve));
});
test.afterAll(async () => { await new Promise<void>((resolve, reject) => upstream.close(error => error ? reject(error) : resolve())); });

test("E2E-01 browser uses real Next transport, preserving conflict, body and idempotency", async ({ page }) => {
  await page.route("**/*", route => new URL(route.request().url()).hostname === "127.0.0.1" ? route.continue() : route.abort());
  await page.goto("/login");
  const result = await page.evaluate(async () => {
    const response = await fetch("/api/v1/visits?cursor=a%2Bb", {
      method: "POST",
      headers: { authorization: "Bearer synthetic-transport-fixture", "content-type": "application/json", "idempotency-key": "synthetic-operation-1" },
      body: JSON.stringify({ expectedLockVersion: 4 }),
    });
    return { status: response.status, body: await response.json(), cache: response.headers.get("cache-control") };
  });
  expect(result.status).toBe(409);
  expect(result.body).toEqual({ error: { code: "CONFLICT" } });
  // Next's configured response headers add stricter directives in production.
  expect(result.cache?.split(",").map(value => value.trim())).toEqual(expect.arrayContaining(["private", "no-store"]));
  expect(result.cache).not.toContain("public");
  expect(received).toHaveLength(1);
  expect(received[0]).toEqual({ path: "/api/v1/visits?cursor=a%2Bb", body: '{"expectedLockVersion":4}', key: "synthetic-operation-1", cookie: undefined });
});

test("E2E-02 cookie-only and hostile origin do not reach upstream", async ({ request }) => {
  const count = received.length;
  const cookie = await request.get("/api/v1/me", { headers: { cookie: "__session=synthetic-not-auth" } });
  expect(cookie.status()).toBe(401);
  const hostile = await request.post("/api/v1/visits", { headers: { authorization: "Bearer synthetic-transport-fixture", origin: "https://invalid.example" }, data: {} });
  expect(hostile.status()).toBe(403);
  expect(received).toHaveLength(count);
});

test("E2E-01 API remains the authentication owner", async ({ request }) => {
  const response = await request.get("/api/v1/me", { headers: { authorization: "Bearer invalid-synthetic-fixture" } });
  expect(response.status()).toBe(401);
  expect(await response.json()).toEqual({ error: { code: "AUTH_REQUIRED" } });
});
