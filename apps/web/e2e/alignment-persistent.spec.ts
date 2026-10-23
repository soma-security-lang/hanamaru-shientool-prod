import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
test.skip(process.env.HANAMARU_PERSISTENT_TEST !== "true", "Isolated PostgreSQL and synthetic issuer required");
test.beforeEach(async ({ page, request }) => {
  await request.post("http://127.0.0.1:3378/test/revoked", { headers: { "x-sso-internal-secret": process.env.SSO_INTERNAL_SECRET! }, form: { value: "false" } });
  await page.route("**/*", route => new URL(route.request().url()).hostname === "127.0.0.1" ? route.continue() : route.abort());
  await page.goto("/login");
});
test("E2E-PERSIST-01 SSO GUI → cookie → native API → Prisma write → reload, with no browser bearer", async ({ page, context }, info) => {
  const errors: string[]=[];page.on("pageerror",error=>errors.push(error.message));
  await page.getByRole("button", { name: /共通.*ログイン/ }).click();
  await expect(page).toHaveURL("http://127.0.0.1:3377/");
  const me=await page.evaluate(async()=>{const r=await fetch("/api/v1/me");return {status:r.status,body:await r.json()};});
  expect(me.status).toBe(200);expect(me.body.roles).toContain("assessor");
  expect((await context.cookies()).find(c=>c.name==="__session")?.httpOnly).toBe(true);
  expect(await page.evaluate(()=>sessionStorage.getItem("hanamaru.sso.access"))).toBeNull();
  const saved=await page.evaluate(async day=>{
    const session=await(await fetch("/api/auth/session")).json();
    const headers={"x-csrf-token":session.csrfToken,"content-type":"application/json","idempotency-key":crypto.randomUUID()};
    const response=await fetch("/api/v1/expense-days",{method:"POST",headers,body:JSON.stringify({businessDate:day})});
    return {status:response.status,body:await response.json()};
  },info.project.name==="chromium"?"2026-04-22":"2026-04-23");
  expect(saved.status,JSON.stringify(saved.body)).toBe(200);
  // Complete Next's sidebar prefetches before a full document navigation;
  // WebKit reports cancelled intercepted RSC requests as page errors.
  await page.waitForLoadState("networkidle");
  await page.goto(`/expense-settlement?dayId=${saved.body.id}`);
  await expect(page.getByRole("button",{name:"入力値を保存"})).toBeEnabled();
  await page.getByLabel("買取金の参照元メモ（任意）").fill("合成の移行確認メモ");
  const stored=page.waitForResponse(r=>r.request().method()==="PATCH"&&r.url().endsWith(`/expense-days/${saved.body.id}`));
  await page.getByRole("button",{name:"入力値を保存"}).click();expect((await stored).status()).toBe(200);
  await page.waitForLoadState("networkidle");
  await page.reload();
  const restored=await page.evaluate(async id=>{const r=await fetch(`/api/v1/expense-days/${id}`);return {status:r.status,body:await r.json()};},saved.body.id);
  expect(restored.status).toBe(200);expect(restored.body.day.id).toBe(saved.body.id);
  expect(restored.body.day.purchaseSourceNote).toBe("合成の移行確認メモ");
  await expect(page.getByLabel("買取金の参照元メモ（任意）")).toHaveValue("合成の移行確認メモ");
  await page.setViewportSize({width:390,height:844});
  await expect(page.getByRole("main")).toHaveCount(1);
  await page.getByLabel("買取金の参照元メモ（任意）").scrollIntoViewIfNeeded();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  // Capture the actual mobile viewport: full-page capture after a desktop→mobile
  // resize can repeat sticky compositing layers in installed Chrome screenshots.
  await page.screenshot({path:`../../.artifacts/alignment/persistent-${info.project.name}-390.png`,fullPage:false});
  const axe=await new AxeBuilder({page}).analyze();expect(axe.violations.filter(v=>["serious","critical"].includes(v.impact??""))).toEqual([]);
  expect(errors).toEqual([]);
  const logout=await page.evaluate(async()=>{const session=await(await fetch("/api/auth/session")).json();await fetch("/api/auth/session",{method:"DELETE",headers:{"x-csrf-token":session.csrfToken}});return (await fetch("/api/v1/me")).status;});expect(logout).toBe(401);
});
test("E2E-PERSIST-02 provider revocation blocks an existing browser session permanently",async({page,request})=>{
  await page.getByRole("button",{name:/共通.*ログイン/}).click();await expect(page).toHaveURL("http://127.0.0.1:3377/");
  await request.post("http://127.0.0.1:3378/test/revoked",{headers:{"x-sso-internal-secret":process.env.SSO_INTERNAL_SECRET!},form:{value:"true"}});
  expect(await page.evaluate(async()=>(await fetch("/api/v1/me")).status)).toBe(401);
  await request.post("http://127.0.0.1:3378/test/revoked",{headers:{"x-sso-internal-secret":process.env.SSO_INTERNAL_SECRET!},form:{value:"false"}});
  expect(await page.evaluate(async()=>(await fetch("/api/v1/me")).status)).toBe(401);
});
test("E2E-PERSIST-03 cookie session preserves JSON ownership and private PDF binary round trip",async({page})=>{
  await page.getByRole("button",{name:/共通.*ログイン/}).click();await expect(page).toHaveURL("http://127.0.0.1:3377/");
  const result=await page.evaluate(async()=>{
    const session=await(await fetch("/api/auth/session")).json();
    const write=async(path:string,body:unknown)=>{
      const response=await fetch(`/api/v1${path}`,{method:"POST",headers:{"content-type":"application/json","x-csrf-token":session.csrfToken,"idempotency-key":crypto.randomUUID()},body:JSON.stringify(body)});
      return {status:response.status,body:await response.json()};
    };
    const visit=await write("/visits",{caseNumber:`HV-PERSIST-${crypto.randomUUID()}`});
    if(visit.status!==201)return {phase:"visit",...visit};
    const text="%PDF-1.4\nsynthetic local-only document\n%%EOF",bytes=new TextEncoder().encode(text);
    const sha256=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",bytes)),b=>b.toString(16).padStart(2,"0")).join("");
    const upload=await write(`/visits/${visit.body.id}/documents/uploads`,{mimeType:"application/pdf",sizeBytes:bytes.length,sha256});
    if(upload.status!==201)return {phase:"upload-session",...upload};
    const put=await fetch(upload.body.url,{method:"PUT",headers:{...upload.body.headers,"x-csrf-token":session.csrfToken},body:bytes});
    if(!put.ok)return {phase:"binary-write",status:put.status};
    const complete=await write(`/document-uploads/${upload.body.uploadId}/complete`,{});
    if(complete.status!==201)return {phase:"complete",...complete};
    const file=await fetch(`/api/v1/documents/${complete.body.id}/file`);
    return {phase:"read-back",status:file.status,matches:await file.text()===text,encodedKey:upload.body.url.includes("%2F")};
  });
  expect(result).toEqual({phase:"read-back",status:200,matches:true,encodedKey:true});
});
