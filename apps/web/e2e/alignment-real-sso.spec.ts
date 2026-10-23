import { test, expect } from "@playwright/test";
import { createHash } from "node:crypto";
import type { BrowserContext, Page, APIRequestContext } from "@playwright/test";
test.skip(process.env.HANAMARU_REAL_SSO_TEST !== "true", "Requires isolated real Soumu provider and databases");
const issuer = "http://127.0.0.1:3381";
const browserErrors = new WeakMap<Page, string[]>();
async function control(request: APIRequestContext, action: string, key?: string) {
  const response = await request.post("http://127.0.0.1:3386/control", { headers: { "x-local-test-secret": process.env.SSO_INTERNAL_SECRET! }, data: { action, key } });
  const result = await response.json(); expect(response.status(), JSON.stringify(result)).toBe(200); return result;
}
async function keyOf(context: BrowserContext) {
  const cookie = (await context.cookies()).find(cookie => cookie.name === "__session")!;
  expect(cookie.httpOnly).toBe(true); return createHash("sha256").update(cookie.value).digest("hex");
}
async function login(page: Page) {
  await page.goto("/login"); await page.getByRole("button", { name: /共通.*ログイン/ }).click();
  await expect(page.getByLabel("共通ID")).toBeVisible();
  await page.getByLabel("共通ID").fill("long.synthetic");
  await page.getByLabel("パスワード").fill(process.env.SYNTHETIC_SSO_PASSWORD!);
  await page.getByRole("button", { name: "ログイン", exact: true }).click();
  await expect(page).toHaveURL("http://127.0.0.1:3383/");
  await page.waitForLoadState("networkidle");
}
test.beforeEach(async ({ page, request }) => {
  const errors: string[] = []; browserErrors.set(page, errors);
  page.on("pageerror", error => errors.push(error.message));
  await control(request, "reset");
  await page.route("**/*", route => new URL(route.request().url()).hostname === "127.0.0.1" ? route.continue() : route.abort());
});
test.afterEach(async ({ page }) => { expect(browserErrors.get(page)).toEqual([]); });
test("E2E-REAL-01 real password/PKCE → expired provider access → server refresh → save and reload", async ({ page, context, request }) => {
  await login(page);
  const original = await page.evaluate(async () => (await fetch("/api/auth/session")).json());
  expect(original.viewer.id).toBe("00000000-0000-4000-8000-000000000100");
  expect(original.viewer.roles).toContain("assessor"); expect(original.viewer.roles).not.toContain("system_admin");
  expect(original.expiresAt - Date.now()).toBeGreaterThan(7.9 * 3600_000);
  const key = await keyOf(context), before = await control(request, "stats");
  await control(request, "expire-access", key);
  const responses = await page.evaluate(async () => Promise.all(Array.from({ length: 6 }, async () => (await fetch("/api/v1/me")).status)));
  expect(responses).toEqual([200, 200, 200, 200, 200, 200]);
  const after = await control(request, "stats"); expect(after.consumed - before.consumed).toBe(1);
  const saved = await page.evaluate(async () => {
    const auth = await (await fetch("/api/auth/session")).json();
    const response = await fetch("/api/v1/visits", { method: "POST", headers: { "content-type": "application/json", "x-csrf-token": auth.csrfToken, "idempotency-key": crypto.randomUUID() }, body: JSON.stringify({ caseNumber: `HV-REAL-${crypto.randomUUID()}` }) });
    return { status: response.status, body: await response.json(), expiresAt: auth.expiresAt };
  });
  expect(saved.status).toBe(201); expect(saved.expiresAt).toBe(original.expiresAt);
  await page.waitForLoadState("networkidle"); await page.reload();
  expect(await page.evaluate(async id => (await fetch(`/api/v1/visits/${id}`)).status, saved.body.id)).toBe(200);
  const browserState = await page.evaluate(() => ({ access: sessionStorage.getItem("hanamaru.sso.access"), cookies: document.cookie }));
  expect(browserState.access).toBeNull(); expect(browserState.cookies).not.toContain("__session");
});
test("E2E-REAL-02 repeated refresh preserves input, then global logout rejects old session", async ({ page, context, request }, info) => {
  await login(page); const key = await keyOf(context);
  const day = await page.evaluate(async businessDate => {
    const auth = await (await fetch("/api/auth/session")).json();
    const response = await fetch("/api/v1/expense-days", { method: "POST", headers: { "content-type": "application/json", "x-csrf-token": auth.csrfToken, "idempotency-key": crypto.randomUUID() }, body: JSON.stringify({ businessDate }) });
    return { status: response.status, body: await response.json() };
  }, info.project.name === "chromium" ? "2026-04-24" : "2026-04-25");
  expect(day.status).toBe(200);
  await page.goto(`/expense-settlement?dayId=${day.body.id}`);
  const note = page.getByLabel("買取金の参照元メモ（任意）");
  await expect(note).toBeVisible(); await note.fill("まだ保存していない合成メモ");
  await page.waitForLoadState("networkidle");
  for (let cycle = 0; cycle < 3; cycle++) {
    await control(request, "expire-access", key);
    expect(await page.evaluate(async () => (await fetch("/api/auth/session")).status)).toBe(200);
    await expect(note).toHaveValue("まだ保存していない合成メモ");
  }
  const portal = await context.newPage(); await portal.goto(`${issuer}/apps`);
  await portal.getByRole("button", { name: "すべてからログアウト", exact: true }).click();
  await expect(portal).toHaveURL(`${issuer}/login`);
  expect(await page.evaluate(async () => (await fetch("/api/v1/me")).status)).toBe(401);
  expect(await page.evaluate(async () => (await fetch("/api/v1/me")).status)).toBe(401);
  await expect(note).toHaveValue("まだ保存していない合成メモ");
});
test("E2E-REAL-03 link revocation prevents refresh; absolute expiry cannot be extended", async ({ page, context, request }) => {
  await login(page); const key = await keyOf(context);
  await control(request, "expire-access", key); await control(request, "unlink");
  expect(await page.evaluate(async () => (await fetch("/api/v1/me")).status)).toBe(401);
  await control(request, "reset");
  expect(await page.evaluate(async () => (await fetch("/api/v1/me")).status)).toBe(401);
  await context.clearCookies(); await login(page);
  await control(request, "expire-session", await keyOf(context));
  expect(await page.evaluate(async () => (await fetch("/api/v1/me")).status)).toBe(401);
});
