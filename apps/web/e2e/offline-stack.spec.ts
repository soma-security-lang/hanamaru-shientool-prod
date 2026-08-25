import AxeBuilder from "@axe-core/playwright";
import {expect,test,type BrowserContext,request,type APIRequestContext} from "@playwright/test";
import {mkdir} from "node:fs/promises";
import {resolve} from "node:path";
import {PDFDocument,StandardFonts} from "pdf-lib";

test.skip(process.env.OFFLINE_STACK_E2E!=="1","OFFLINE_STACK_E2E=1 is required");
test.describe.configure({mode:"serial"});

const webBase=process.env.E2E_WEB_BASE_URL??"http://127.0.0.1:3100";
const apiBase=process.env.E2E_API_BASE_URL??"http://127.0.0.1:3200/api/v1";
const screenshots=resolve(process.env.OFFLINE_E2E_SCREENSHOT_DIR??".artifacts/offline-e2e-screenshots");
let api:APIRequestContext;
let visitId="";

async function addRole(context:BrowserContext,role="manager"){
  await context.route(`${apiBase}/**`,async route=>{
    const headers={...route.request().headers(),"x-dev-role":role};
    await route.continue({headers});
  });
}

function canonicalRoutes(){return [
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

async function anonymousVisitPdf(){
  const document=await PDFDocument.create();const font=await document.embedFont(StandardFonts.Helvetica);const page=document.addPage([595,842]);
  page.drawText("Visit information",{x:56,y:780,size:18,font});
  page.drawText("visitDate: 2026-08-20",{x:56,y:735,size:12,font});
  page.drawText("customerLabel: OfflineE2ECustomer",{x:56,y:710,size:12,font});
  page.drawText("appraisalItems: Anonymous watch and camera",{x:56,y:685,size:12,font});
  page.drawText("visitTime: 14:30",{x:56,y:660,size:12,font});
  page.drawText("visitAddress: Anonymous test address",{x:56,y:635,size:12,font});
  page.drawText("contact: 000-0000-0000",{x:56,y:610,size:12,font});
  page.drawText("parking: Available",{x:56,y:585,size:12,font});
  page.drawText("campaign: Offline E2E",{x:56,y:560,size:12,font});
  page.drawText("notes: Anonymous acceptance fixture",{x:56,y:535,size:12,font});
  page.drawText("assignedStaffName: Test Assessor",{x:56,y:510,size:12,font});
  return Buffer.from(await document.save());
}

test.beforeAll(async()=>{
  api=await request.newContext({baseURL:`${apiBase.replace(/\/$/,"")}/`,extraHTTPHeaders:{"x-dev-role":"manager"}});
  const response=await api.get("visits");expect(response.ok(),await response.text()).toBeTruthy();
  const body=await response.json() as {items:Array<{id:string}>};visitId=body.items[0]?.id??"";expect(visitId).not.toBe("");
  await mkdir(screenshots,{recursive:true});
});
test.afterAll(async()=>api?.dispose());
test.beforeEach(async({context})=>addRole(context));

test("all 20 API-backed screens render and remain free of serious accessibility violations",async({page})=>{
  test.setTimeout(240_000);
  await page.goto(`${webBase}/`);
  expect(await page.evaluate(()=>Object.keys(localStorage).filter(key=>key.startsWith("firebase:authUser:")))).toEqual([]);
  for(const [screenId,path] of canonicalRoutes()){
    await page.goto(`${webBase}${path}`);await expect(page.locator("main"),screenId).toBeVisible();
    if(path!=="/login"){
      await expect(page.getByRole("heading",{name:"利用者情報を確認しています"}),screenId).toHaveCount(0);
      await expect(page.getByRole("heading",{name:"ログインが必要です"}),screenId).toHaveCount(0);
      await expect(page.getByRole("heading",{name:"利用者情報を確認できません"}),screenId).toHaveCount(0);
    }
    await expect(page.locator("h1"),screenId).toBeVisible();
    const results=await new AxeBuilder({page}).withTags(["wcag2a","wcag2aa","wcag21aa","wcag22aa"]).analyze();
    expect(results.violations.filter(item=>item.impact==="serious"||item.impact==="critical"),screenId).toEqual([]);
  }
});

test("PDF registration reaches confirmed visit preparation through API, worker and PostgreSQL",async({page})=>{
  test.setTimeout(120_000);await page.goto(`${webBase}/visits`);await page.getByRole("link",{name:"PDFから訪問を登録"}).click();
  await page.locator('input[type="file"]').setInputFiles({name:"offline-visit.pdf",mimeType:"application/pdf",buffer:await anonymousVisitPdf()});
  await expect(page).toHaveURL(/\/visits\/[0-9a-f-]{36}\/import$/);visitId=page.url().match(/\/visits\/([0-9a-f-]{36})\/import/)?.[1]??"";expect(visitId).not.toBe("");
  await expect(page.getByRole("textbox",{name:"訪問予定日"})).toHaveValue("2026-08-20",{timeout:30_000});
  await expect(page.getByRole("textbox",{name:"お客様表示名"})).toHaveValue("OfflineE2ECustomer");
  await page.getByRole("button",{name:"内容を確定して訪問前チェックへ"}).click();await expect(page).toHaveURL(new RegExp(`/visits/${visitId}/preparation$`));
  await expect(page.getByRole("checkbox")).toHaveCount(4,{timeout:30_000});for(const checkbox of await page.getByRole("checkbox").all())await checkbox.check();
  await page.getByRole("button",{name:"確認して準備を完了"}).click();await expect(page.getByRole("button",{name:"準備完了"})).toBeVisible();
});

test("audio registration reaches transcript confirmation and six-area AI review",async({page})=>{
  test.setTimeout(180_000);expect(visitId).not.toBe("");await page.goto(`${webBase}/visits/${visitId}/transcription`);
  await page.getByRole("checkbox",{name:/録音同意/}).check();
  await page.locator('input[type="file"]').setInputFiles({name:"offline-audio.m4a",mimeType:"audio/mp4",buffer:Buffer.from("anonymous-offline-audio")});
  await expect.poll(()=>page.locator("textarea[aria-label^='発話']").count(),{timeout:60_000}).toBeGreaterThan(0);
  await expect(page.getByText("話者をチャンク単位で割り当て")).toHaveCount(0);
  const continueWithRisk=page.getByRole("button",{name:"内容を確認して利用継続"});if(await continueWithRisk.count())await continueWithRisk.click();
  const speakers=page.locator("select[aria-label$='の役割']");for(let index=0;index<await speakers.count();index++)await speakers.nth(index).selectOption(index%2===0?"staff":"customer");
  await page.getByRole("button",{name:"文字起こしを確定"}).click();await expect(page.getByRole("button",{name:"確定しました"})).toBeVisible();
  await page.goto(`${webBase}/visits/${visitId}/review/input`);await page.getByRole("button",{name:/AI振り返りを作成/}).click();
  await expect(page).toHaveURL(new RegExp(`/visits/${visitId}/review$`));await expect.poll(()=>page.locator("button[aria-pressed]").count(),{timeout:60_000}).toBeGreaterThanOrEqual(6);
  await page.getByRole("button",{name:"確認を完了"}).click();await expect(page.getByRole("button",{name:"確認済み"})).toBeVisible();
});

test("operations exposes aggregate health and per-visit retention without body data",async({page})=>{
  await page.goto(`${webBase}/admin/operations`);
  await expect(page.getByRole("heading",{name:"稼働状況"})).toBeVisible();
  await page.getByRole("button",{name:"保存・削除"}).click();
  await page.getByLabel("保存期限を確認する案件").selectOption(visitId);
  await expect(page.getByRole("heading",{name:"案件へ実際に適用された保存期限"})).toBeVisible();
  await expect(page.getByRole("columnheader",{name:"削除予定日"})).toBeVisible();
});

test("mobile navigation and progressive panes preserve URL-addressable state",async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await page.goto(`${webBase}/`);
  const mobileNav=page.getByRole("navigation",{name:"モバイルナビゲーション"});
  await expect(mobileNav).toBeVisible();
  await expect(mobileNav.locator(":scope > a, :scope > button")).toHaveCount(5);
  await mobileNav.getByRole("button",{name:"その他"}).click();
  await expect(page.getByRole("dialog").getByRole("heading",{name:"その他"})).toBeVisible();
  await expect(page.getByRole("navigation",{name:"その他の機能"}).getByRole("link",{name:/研修/})).toBeVisible();
  await page.getByRole("button",{name:"メニューを閉じる"}).click();

  await page.goto(`${webBase}/visits`);
  await page.locator("tbody").getByRole("button").first().click();
  await expect(page).toHaveURL(/view=detail/);
  await expect(page.getByRole("button",{name:"訪問一覧へ戻る"})).toBeVisible();
  await page.getByRole("button",{name:"訪問一覧へ戻る"}).click();
  await expect(page).toHaveURL(/view=list/);

  await page.goto(`${webBase}/knowledge/talks`);
  await page.getByRole("button",{name:/検索結果を見る/}).click();
  await expect(page).toHaveURL(/view=list/);
  await page.getByRole("region",{name:"検索結果一覧"}).locator("button[data-selected]").first().click();
  await expect(page).toHaveURL(/view=detail/);
  await expect(page.getByRole("button",{name:"検索結果へ戻る"})).toBeVisible();
});

test("all 20 screens remain horizontally bounded at all seven responsive widths",async({page})=>{
  test.setTimeout(480_000);
  for(const [width,height] of [[360,800],[390,844],[430,932],[768,1024],[834,1112],[1024,768],[1440,900]] as const){
    await page.setViewportSize({width,height});
    for(const [screenId,path] of canonicalRoutes()){
      await page.goto(`${webBase}${path}`);
      await expect(page.locator("main h1"),`${screenId}-${width}`).toBeVisible();
      await page.waitForLoadState("networkidle");
      expect(await page.locator("body").evaluate(body=>body.scrollWidth<=window.innerWidth),`${screenId} at ${width}px`).toBe(true);
    }
  }
});

test("assessor cannot reach administration and Chromium captures the 60 HITL images",async({browser,page,browserName})=>{
  test.setTimeout(360_000);
  const assessor=await browser.newContext();await addRole(assessor,"assessor");const assessorPage=await assessor.newPage();
  for(const path of ["/admin/contents","/admin/users","/admin/operations","/admin/approvals","/admin/analytics"]){await assessorPage.goto(`${webBase}${path}`);await expect(assessorPage.getByRole("heading",{name:"この画面を利用する権限がありません"})).toBeVisible();}
  await assessor.close();
  test.skip(browserName!=="chromium","formal 60-image evidence is captured once in Chromium");
  for(const [viewport,width,height] of [["mobile",390,844],["tablet",834,1112],["desktop",1440,900]] as const){
    await page.setViewportSize({width,height});for(const [screenId,path] of canonicalRoutes()){
      await page.goto(`${webBase}${path}`);await expect(page.locator("main h1"),`${screenId}-${viewport}`).toBeVisible();
      await page.waitForLoadState("networkidle");
      expect(await page.locator("body").evaluate(body=>body.scrollWidth<=window.innerWidth),`${screenId}-${viewport}`).toBe(true);
      await page.screenshot({path:resolve(screenshots,`${screenId}-${viewport}.png`),fullPage:viewport!=="mobile",animations:"disabled",caret:"initial"});
    }
  }
});
