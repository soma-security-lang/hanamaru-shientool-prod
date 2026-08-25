import AxeBuilder from "@axe-core/playwright";
import {expect,test,type Page} from "@playwright/test";
import {mkdir} from "node:fs/promises";
import {resolve} from "node:path";
import {createLiveSession,installLiveSession,type LiveSession} from "./auth";

const managerToken=process.env.LIVE_E2E_GOOGLE_ID_TOKEN??process.env.LIVE_E2E_IDENTITY_PLATFORM_ID_TOKEN;
const remoteAcceptance=process.env.E2E_REMOTE==="1";
test.skip(process.env.REAL_STACK_E2E!=="1"||!managerToken,"live stack and an approved manager identity token are required");

const viewports=[["mobile",390,844],["tablet",834,1112],["desktop",1440,900]] as const;
let visitId="";
let managerSession:LiveSession;

function routes(){return [
  ["SCR-001","/login"],["SCR-002","/"],["SCR-003","/visits"],
  ["SCR-004",`/visits/${visitId}/import`],["SCR-005",`/visits/${visitId}/preparation`],
  ["SCR-006",`/visits/${visitId}/transcription`],["SCR-007",`/visits/${visitId}/review/input`],
  ["SCR-008",`/visits/${visitId}/review`],["SCR-009","/reviews"],
  ["SCR-010","/knowledge/talks"],["SCR-011","/knowledge/flows"],
  ["SCR-012","/knowledge/reference"],["SCR-013","/knowledge/manuals"],
  ["SCR-014","/training/videos"],["SCR-015","/training/roleplay"],
  ["SCR-016","/admin/contents"],["SCR-017","/admin/users"],
  ["SCR-018","/admin/operations"],["SCR-019","/admin/approvals"],
  ["SCR-020","/admin/analytics"],
] as const;}

async function waitForResolvedScreen(page:Page,route:string){
  await expect(page.locator("main")).toBeVisible();
  if(route!=="/login"){
    await expect(page.getByRole("heading",{name:"利用者情報を確認しています"})).toHaveCount(0);
    await expect(page.getByRole("heading",{name:"ログインが必要です"})).toHaveCount(0);
    await expect(page.getByRole("heading",{name:"利用者情報を確認できません"})).toHaveCount(0);
  }
  await expect(page.locator("main h1")).toBeVisible();
}

async function expectCurrentMobileNavigation(page:Page){
  const mobileNavigation=page.getByRole("navigation",{name:"モバイルナビゲーション"});
  await expect(mobileNavigation).toBeVisible();
  await expect(mobileNavigation.locator(":scope > a, :scope > button")).toHaveCount(5);
  await expect(mobileNavigation.locator(":scope > a, :scope > button")).toHaveText([
    "ホーム","訪問","振り返り","知識","その他",
  ]);
}

test.beforeAll(async()=>{
  managerSession=await createLiveSession(managerToken!);
  expect(managerSession.me.roles).toContain("manager");
  const response=await managerSession.api.get("visits");
  expect(response.ok(),await response.text()).toBeTruthy();
  const body=await response.json() as {items:Array<{id:string}>};
  visitId=body.items[0]?.id??"";
  if(!visitId){
    const created=await managerSession.api.post("visits",{headers:{"idempotency-key":crypto.randomUUID()},data:{caseNumber:`E2E-${Date.now()}`}});
    expect(created.ok(),await created.text()).toBeTruthy();
    visitId=(await created.json() as {id:string}).id;
  }
});

test.afterAll(async()=>{await managerSession?.api.dispose();});
test.beforeEach(async({context})=>{await installLiveSession(context,managerSession);});

test("all 20 canonical routes render semantic content from the live local stack",async({page})=>{
  test.setTimeout(remoteAcceptance?300_000:120_000);
  for(const [id,route] of routes()){
    await page.goto(route);
    await waitForResolvedScreen(page,route);
    await expect(page.locator("main h1"),id).toBeVisible();
  }
});

test("release HTML uses a unique deployment id for mutable assets",async({request})=>{
  const response=await request.get("/");
  expect(response.ok()).toBeTruthy();
  expect(response.headers()["cache-control"]).toContain("no-store");
  const html=await response.text();
  const assetUrls=[...html.matchAll(/(?:src|href)="([^"]*\/_next\/static\/[^"]+\.(?:js|css)(?:\?[^"]*)?)"/g)].map(match=>match[1]);
  expect(assetUrls.length).toBeGreaterThan(0);
  const deploymentIds=assetUrls.map(asset=>new URL(asset,response.url()).searchParams.get("dpl"));
  expect(deploymentIds.every(Boolean)).toBe(true);
  expect(new Set(deploymentIds).size).toBe(1);
});

test("category approval opens from the live API without a recovery error",async({page})=>{
  const response=await managerSession.api.get("admin/content-approval-batches");
  expect(response.ok(),await response.text()).toBeTruthy();
  await page.goto("/admin/approvals");
  await expect(page.getByRole("heading",{name:"コンテンツ承認"})).toBeVisible();
  await expect(page.getByRole("heading",{name:"承認対象セット",exact:true})).toBeVisible();
  await expect(page.getByRole("alert").filter({hasText:"承認情報を読み込めませんでした。"})).toHaveCount(0);
});

test("manager operations never expose the system audit tab",async({page})=>{
  await page.goto("/admin/operations?tab=audit");
  await expect(page.getByRole("heading",{name:"システム運用"})).toBeVisible();
  await expect(page.getByRole("button",{name:"保存・削除"})).toBeVisible();
  await expect(page.getByRole("button",{name:"監査ログ"})).toHaveCount(0);
  await expect(page.getByRole("button",{name:"ジョブ"})).toHaveAttribute("data-active","true");
});

test("legacy links preserve the real visit id while redirecting",async({page})=>{
  const legacy=[
    [`/visits/${visitId}/document`, `/visits/${visitId}/import`],
    [`/visits/${visitId}/recording`, `/visits/${visitId}/transcription`],
    [`/visits/${visitId}/transcription/status`, `/visits/${visitId}/transcription`],
    [`/visits/${visitId}/transcript`, `/visits/${visitId}/transcription`],
    ["/history","/reviews"],["/contents/talks","/knowledge/talks"],
    ["/contents/reference","/knowledge/reference"],["/training","/training/roleplay"],
    ["/admin/jobs","/admin/operations?tab=jobs"],["/admin/retention","/admin/operations?tab=retention"],
    ["/admin/audit","/admin/operations?tab=audit"],["/admin/content-approvals","/admin/approvals"],
  ] as const;
  for(const [source,target] of legacy){await page.goto(source);await expect(page).toHaveURL(new RegExp(target.replace(/[?]/g,"\\?")));}
});

test("development controls are isolated from normal navigation",async({page})=>{
  await page.goto("/");
  expect(await page.evaluate(()=>Object.keys(sessionStorage).filter(key=>key.startsWith("firebase:authUser:")))).toEqual([]);
  await expect(page.getByRole("link",{name:/画面・状態検証|プロトタイプ/})).toHaveCount(0);
  await expect(page.locator("main")).not.toContainText(/SCR-\d{3}|fixture|prototype|実API未接続|操作モック/i);
  await page.goto("/__prototype");
  if(process.env.NEXT_PUBLIC_PROTOTYPE_MODE==="enabled")await expect(page.getByRole("heading",{name:"画面・状態検証"})).toBeVisible();
  else await expect(page.getByRole("heading",{name:"画面が見つかりません"})).toBeVisible();
});

test("a newly opened tab reuses the authenticated account without an account or API switch screen",async({page,context})=>{
  await page.goto("/");
  await expect(page.locator("main h1")).toBeVisible();
  const nextTab=await context.newPage();
  await nextTab.goto("/visits");
  await expect(nextTab.getByRole("heading",{name:"訪問支援"})).toBeVisible();
  await expect(nextTab).not.toHaveURL(/\/login/);
  await expect(nextTab.getByText(/API.*切り替|アカウント.*切り替|接続先.*選択/)).toHaveCount(0);
  await nextTab.close();
});

test("the complete PoC corpus is searchable through the API-backed UI",async({page})=>{
  await page.goto("/knowledge/talks");
  await expect(page.getByText("1,156件",{exact:true}).first()).toBeVisible({timeout:15_000});
  await page.getByRole("textbox",{name:"検索"}).fill("査定");
  await expect.poll(()=>page.locator("main button").count()).toBeGreaterThan(1);
  await page.goto("/knowledge/flows");await expect(page.getByText("159件",{exact:true}).first()).toBeVisible({timeout:15_000});
  await page.goto("/knowledge/reference");await expect.poll(()=>page.getByRole("row").count()).toBeGreaterThan(10);
  await page.goto("/training/roleplay");await expect.poll(()=>page.getByRole("button").count()).toBeGreaterThan(10);
});

test("knowledge and roleplay pagination advance without repeating the first page",async({page})=>{
  await page.goto("/knowledge/talks");
  const resultPane=page.locator("section").filter({has:page.getByRole("heading",{name:"検索結果",exact:true})}).first();
  const firstTalk=await resultPane.locator("button strong").first().textContent();
  await page.getByRole("button",{name:"次のページ"}).click();
  await expect(resultPane.getByText(/2ページ/)).toBeVisible();
  await expect.poll(()=>resultPane.locator("button strong").first().textContent()).not.toBe(firstTalk);
  await page.goto("/training/roleplay");
  const firstScenario=await page.locator("aside button strong").first().textContent();
  await page.getByRole("button",{name:"次のページ"}).click();
  await expect.poll(()=>page.locator("aside button strong").first().textContent()).not.toBe(firstScenario);
});

test("desktop provides the Web workspace and mobile remains horizontally bounded",async({page})=>{
  for(const [width,height] of [[1440,900],[834,1112],[390,844]] as const){
    await page.setViewportSize({width,height});
    for(const route of ["/","/visits","/knowledge/talks","/training/roleplay"]){
      await page.goto(route);
      await waitForResolvedScreen(page,route);
      expect(await page.locator("body").evaluate(body=>body.scrollWidth<=window.innerWidth),`${route} at ${width}px`).toBe(true);
      if(width===1440){await expect(page.getByRole("complementary",{name:"メインナビゲーション"})).toBeVisible();await expect(page.getByRole("navigation",{name:"モバイルナビゲーション"})).toBeHidden();}
      if(width===390)await expectCurrentMobileNavigation(page);
    }
  }
});

test("keyboard interaction and 44px targets remain available",async({page})=>{
  await page.setViewportSize({width:1440,height:900});
  await page.goto("/visits");
  const firstVisit=page.getByRole("button",{pressed:true}).first();await firstVisit.focus();await page.keyboard.press("Enter");await expect(firstVisit).toBeFocused();
  await page.goto("/knowledge/talks");const search=page.getByRole("textbox",{name:"検索"});await search.focus();await page.keyboard.type("査定");await expect.poll(()=>page.locator("main button").count()).toBeGreaterThan(1);
  for(const [,route] of routes()){
    await page.goto(route);
    const undersized=await page.locator("main button:visible, header button:visible, aside button:visible").evaluateAll(elements=>elements.map(element=>{const rect=element.getBoundingClientRect();return{label:element.getAttribute("aria-label")??element.textContent?.trim().slice(0,48),width:rect.width,height:rect.height};}).filter(({width,height})=>width<43.5||height<43.5));
    expect(undersized,route).toEqual([]);
  }
});

test("all 20 screens have zero serious or critical axe violations",async({page})=>{
  test.setTimeout(remoteAcceptance?600_000:180_000);await page.emulateMedia({reducedMotion:"reduce"});
  for(const [,route] of routes()){
    await page.goto(route);
    const results=await new AxeBuilder({page}).withTags(["wcag2a","wcag2aa","wcag21aa","wcag22aa"]).analyze();
    expect(results.violations.filter(item=>item.impact==="serious"||item.impact==="critical"),route).toEqual([]);
  }
});

test("assessor is denied every administration route without query role overrides",async({browser})=>{
  const assessorToken=process.env.LIVE_E2E_ASSESSOR_GOOGLE_ID_TOKEN??process.env.LIVE_E2E_ASSESSOR_IDENTITY_PLATFORM_ID_TOKEN;
  test.skip(!assessorToken,"LIVE_E2E_ASSESSOR_GOOGLE_ID_TOKEN is required for the real denial gate");
  const assessorSession=await createLiveSession(assessorToken!,"assessor");expect(assessorSession.me.roles).toContain("assessor");expect(assessorSession.me.roles).not.toContain("manager");
  const context=await browser.newContext();await installLiveSession(context,assessorSession);const page=await context.newPage();
  for(const route of ["/admin/contents","/admin/users","/admin/operations","/admin/approvals","/admin/analytics"]){await page.goto(route);await expect(page.getByRole("heading",{name:"この画面を利用する権限がありません"})).toBeVisible();}
  await context.close();await assessorSession.api.dispose();
});

test("captures the 60 current local-product images",async({page})=>{
  test.setTimeout(remoteAcceptance?900_000:300_000);const output=resolve(process.env.HITL_SCREENSHOT_DIR??".artifacts/hitl-screenshots-web");await mkdir(output,{recursive:true});
  for(const [viewport,width,height] of viewports){await page.setViewportSize({width,height});for(const [id,route] of routes()){await page.goto(route);await waitForResolvedScreen(page,route);if(viewport==="mobile"&&route!=="/login")await expectCurrentMobileNavigation(page);await page.screenshot({path:resolve(output,`${id}-${viewport}.png`),fullPage:true,caret:"initial",animations:"disabled"});}}
});
