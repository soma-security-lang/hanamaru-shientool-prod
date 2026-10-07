import AxeBuilder from "@axe-core/playwright";
import {expect,test,type BrowserContext,request,type APIRequestContext,type Page} from "@playwright/test";
import {mkdir} from "node:fs/promises";
import {resolve} from "node:path";
import {PDFDocument,StandardFonts} from "pdf-lib";

test.skip(process.env.OFFLINE_STACK_E2E!=="1","OFFLINE_STACK_E2E=1 is required");
test.describe.configure({mode:"serial"});

const webBase=process.env.E2E_WEB_BASE_URL??"http://127.0.0.1:3100";
const apiBase=process.env.E2E_API_BASE_URL??"http://127.0.0.1:3200/api/v1";
const screenshots=resolve(process.env.OFFLINE_E2E_SCREENSHOT_DIR??".artifacts/offline-e2e-screenshots");
test('expense branch workflow closes with a difference and preserves later corrections',async({browser,browserName})=>{
 test.setTimeout(90000);
 const context=await browser.newContext({viewport:{width:390,height:844}});await addRole(context);
 const page=await context.newPage();page.on('dialog',dialog=>void dialog.accept());
 const businessDate=browserName==='webkit'?'2026-04-12':'2026-04-11';
 const panel=page.locator('details[name="expense-branch"]');
 async function section(title:string){await panel.locator('summary').filter({hasText:new RegExp(`^${title}$`)}).click();return panel.getByRole('group',{name:title,exact:true});}
 try{
  await page.goto(`${webBase}/expense-settlement`);await panel.locator(':scope > summary').click();
  await panel.getByLabel('取りまとめ業務日').fill(businessDate);await panel.getByRole('button',{name:'拠点の日次を検索',exact:true}).click();
  await panel.getByLabel('佐藤 花子',{exact:true}).check();await panel.getByLabel('対象者の確認メモ',{exact:true}).fill('合成当番表：当日1名');
  await panel.getByRole('button',{name:'拠点の日次を作成',exact:true}).click();await expect(panel.getByRole('heading',{name:`${businessDate}の拠点取りまとめ`})).toBeVisible();
  const url=page.url();const branchId=new URL(url).searchParams.get('branchDayId');expect(branchId).toBeTruthy();
 let group=await section('日次の代理入力');await group.getByRole('combobox',{name:'対象者の日次',exact:true}).selectOption({label:'佐藤 花子'});await group.getByLabel('開始財布額（円）').fill('200000');await group.getByLabel('買取金額（円）').fill('150000');await group.getByLabel('買取金額の参照元').fill('合成買取実績');await group.getByRole('button',{name:'保存する'}).click();await expect(panel.getByText('150,000円',{exact:true})).toBeVisible();
  group=await section('確認済み経費の代理入力');await group.getByLabel('対象者の日次').selectOption({label:'佐藤 花子'});await group.getByLabel('支払先',{exact:true}).fill('架空駐車場');await group.getByLabel('費目',{exact:true}).fill('駐車場');await group.getByLabel('支出額（円）').fill('1200');await group.getByLabel('支払元',{exact:true}).selectOption('company_wallet');await group.getByLabel('支出日・支出者・金額を人が確認しました').check();await group.getByRole('button',{name:'確認した経費を登録'}).click();await expect(panel.getByText('1,200円',{exact:true})).toBeVisible();
  group=await section('財布への補充実績');await group.getByLabel('対象者の日次').selectOption({label:'佐藤 花子'});await group.getByLabel('実際の補充額（円）').fill('151200');await group.getByLabel('実際の現金取扱者').selectOption({label:'鈴木 一郎'});await group.getByLabel('補充した日時（日本時間）').fill(`${businessDate}T19:00`);await group.getByLabel('補充の記録メモ').fill('合成補充');
  let aborted=false;await page.route(`${apiBase}/expense-branch-days/*/actions/transfer`,async route=>{if(aborted){await route.fallback();return;}aborted=true;const response=await route.fetch({headers:{...route.request().headers(),'x-dev-role':'manager'}});expect(response.status()).toBe(200);await route.abort('failed');});
  await group.getByRole('button',{name:'補充実績を記録'}).click();await expect(panel.getByRole('button',{name:'拠点の保存結果を確認'})).toBeVisible();
  await page.reload();await panel.getByRole('button',{name:'拠点の保存結果を確認'}).click();await expect(panel.getByText(/補充 151,200円/)).toHaveCount(1);
  await panel.getByRole('button',{name:'この人の入力完了を記録'}).click();await expect(panel.getByText('入力完了 1 / 1 人')).toBeVisible();
  group=await section('金庫の最終照合');await group.getByLabel('資料で確認した金庫残高（円）').fill('500000');await group.getByLabel('実際に数えた金庫残高（円）').fill('499500');await group.getByLabel('照合元資料・対象範囲').fill('合成残金表');await group.getByRole('button',{name:'照合結果を保存'}).click();await expect(panel.getByText('差額：-500円')).toBeVisible();
  group=await section('日次の締め');await group.getByLabel('差異の状況（原因調査中でも可）').fill('原因調査中');await group.getByLabel('調査担当者').selectOption({label:'鈴木 一郎'});await group.getByLabel('差異と調査事項を残して締めます').check();await group.getByRole('button',{name:'差異を残して締める'}).click();await expect(panel.getByText('締め済み・差異あり',{exact:true})).toBeVisible();
  await page.reload();await expect(panel.getByText('締め済み・差異あり',{exact:true})).toBeVisible();
  group=await section('役職者による経費の後日追加・訂正');await group.getByLabel('対象者の日次').selectOption({label:'佐藤 花子'});await group.getByLabel('支払先',{exact:true}).fill('架空高速道路');await group.getByLabel('費目',{exact:true}).fill('交通費');await group.getByLabel('支出額（円）').fill('300');await group.getByLabel('支払元',{exact:true}).selectOption('company_wallet');await group.getByLabel('支出日・支出者・金額を人が確認しました').check();await group.getByLabel('追加・訂正の理由').fill('前日の経費入力漏れ');await group.getByRole('button',{name:'理由を残して経費を訂正'}).click();await expect(panel.getByText('1,500円',{exact:true})).toBeVisible();await expect(panel.getByText(/締め時差異：-500円/)).toBeVisible();
  group=await section('報告実績の記録');await group.getByLabel('実際に報告した日時（日本時間）').fill(`${businessDate}T20:00`);await group.getByLabel('報告先・内容のメモ').fill('合成報告先への自己記録');await group.getByRole('button',{name:'報告実績を記録',exact:true}).click();await expect(panel.getByText(/実報告日時：/)).toBeVisible();
  await panel.getByRole('button',{name:'記録ログを表示'}).click();await expect(panel.locator('pre').filter({hasText:'前日の経費入力漏れ'})).toHaveCount(1);
  expect((await new AxeBuilder({page}).analyze()).violations.filter(v=>v.impact==='serious'||v.impact==='critical')).toEqual([]);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await mkdir(screenshots,{recursive:true});await page.screenshot({path:resolve(screenshots,`expense-branch-${browserName}-390.png`),fullPage:true});
  await page.setViewportSize({width:1440,height:1000});await page.screenshot({path:resolve(screenshots,`expense-branch-${browserName}-1440.png`),fullPage:true});
  const employee=await browser.newContext({viewport:{width:390,height:844}});await addRole(employee,'assessor');const employeePage=await employee.newPage();await employeePage.goto(url);await expect(employeePage.getByRole('button',{name:'記録ログを表示'})).toHaveCount(0);await expect(employeePage.getByText('役職者による経費の後日追加・訂正',{exact:true})).toHaveCount(0);await expect(employeePage.getByText('締め済み・差異あり',{exact:true})).toBeVisible();const branchData=await employeePage.request.get(`${apiBase}/expense-branch-days/${branchId}`,{headers:{'x-dev-role':'assessor'}});const ownDay=(await branchData.json()).participants[0].id;await employeePage.goto(`${url}&dayId=${ownDay}`);await expect(employeePage.getByText('この業務日は締め済みです。',{exact:false})).toBeVisible();await expect(employeePage.getByRole('button',{name:'候補として保存',exact:true})).toHaveCount(0);await employee.close();
 }finally{await context.close();}
});
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
  ["SCR-021","/market-price"],
] as const;}

async function waitForResolvedScreen(page:Page,path:string){
  await expect(page.locator("main")).toBeVisible();
  if(path!=="/login"){
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
    "ホーム","訪問","買取相場","振り返り","その他",
  ]);
}

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

test("expense day records survive reload and mobile entry keeps cash operations unavailable",async({browser,browserName})=>{
  const context=await browser.newContext({viewport:{width:390,height:844}});await addRole(context,"assessor");
  const page=await context.newPage();
  try{
    await page.goto(`${webBase}/`);
    await page.getByRole("button",{name:"その他"}).click();
    await page.getByRole("link",{name:/経費・車両金精算/}).click();
    await expect(page.getByRole("heading",{name:"経費・車両金精算"})).toBeVisible();
    await page.getByLabel("業務日",{exact:true}).fill(browserName==="webkit"?"2026-09-30":"2026-09-29");
    await page.getByRole("button",{name:"日次記録を開く"}).click();
    await expect(page.getByRole("heading",{name:/の取りまとめ/})).toBeVisible();
    await page.getByLabel("実際の開始財布残高（任意）").fill("0");
    await page.getByLabel("買取金の参照元メモ（任意）").fill("匿名の当日買取一覧");
    await page.getByRole("button",{name:"入力値を保存"}).click();
    await page.getByLabel("支払先").fill("匿名駐車場");
    await page.getByLabel("支払額（円）").fill("1200");
    await page.getByLabel("用途・補足（任意）").fill("訪問先の駐車料金");
    await page.getByRole("button",{name:"候補として保存"}).click();
    await expect(page.getByText("確認待ち候補",{exact:true}).locator("..")).toContainText("1件");
    await page.getByRole("button",{name:"候補を修正"}).click();
    await page.getByLabel("候補の支払額（円）").fill("1300");
    await page.getByRole("button",{name:"候補を保存"}).click();
    await expect(page.getByText("1,300円",{exact:false}).first()).toBeVisible();
    await page.getByLabel("支払先").fill("匿名の重複候補");
    await page.getByLabel("支払額（円）").fill("500");
    await page.getByRole("button",{name:"候補として保存"}).click();
    await expect(page.getByText("確認待ち候補",{exact:true}).locator("..")).toContainText("2件");
    const duplicate=page.getByRole("article").filter({hasText:"匿名の重複候補"});
    await duplicate.getByRole("button",{name:"候補を除外"}).click();
    await duplicate.getByLabel("集計対象外にする理由").fill("匿名テストの重複");
    await duplicate.getByRole("button",{name:"理由を記録して除外"}).click();
    await expect(page.getByText("確認待ち候補",{exact:true}).locator("..")).toContainText("1件");
    await page.getByRole("button",{name:"内容を確認済みにする"}).click();
    await expect(page.getByText("確定・会社の財布",{exact:true}).locator("..")).toContainText("1,300円");
    await page.reload();
    await expect(page.getByText("確定・会社の財布",{exact:true}).locator("..")).toContainText("1,300円");
    await expect(page.getByText("対象外の理由：匿名テストの重複")).toBeVisible();
    await expect(page.getByText("用途・補足：訪問先の駐車料金")).toBeVisible();
    await expect(page.getByLabel("買取金の参照元メモ（任意）")).toHaveValue("匿名の当日買取一覧");
    await page.getByLabel("記録の種類").selectOption("report");
    await page.getByLabel("実際に報告した日時（任意・日本時間）").fill("2026-09-23T18:30");
    await page.getByLabel("理由・内容").fill("匿名の報告を自己記録");
    await page.getByRole("button",{name:"記録を残す"}).click();
    await expect(page.getByText(/実報告日時：2026\/9\/23 18:30/)).toBeVisible();
    const savedUrl=page.url();
    await page.getByLabel("業務日",{exact:true}).fill(browserName==="webkit"?"2026-09-28":"2026-09-27");
    await page.getByRole("button",{name:"日次記録を開く"}).click();
    await expect(page.getByRole("heading",{name:/の取りまとめ/})).toBeVisible();
    await expect.poll(()=>page.url()).not.toBe(savedUrl);
    await page.goBack();
    await expect(page.getByText("用途・補足：訪問先の駐車料金")).toBeVisible();
    expect(page.url()).toBe(savedUrl);
    await page.goForward();
    await expect(page.getByText("支出明細はありません。")).toBeVisible();
    await page.goBack();
    await expect(page.getByText("用途・補足：訪問先の駐車料金")).toBeVisible();
    await page.reload();
    await expect(page.getByText(/実報告日時：2026\/9\/23 18:30/)).toBeVisible();
    expect(page.url()).toBe(savedUrl);
    await page.getByLabel("保存済み日次を業務日で検索").fill(browserName==="webkit"?"2026-09-30":"2026-09-29");
    await page.getByRole("button",{name:"検索",exact:true}).click();
    await expect(page.getByRole("heading",{name:/の取りまとめ/})).toBeVisible();
    await page.goBack();
    await expect(page.getByText("用途・補足：訪問先の駐車料金")).toBeVisible();
    await page.goto(`${webBase}/expense-settlement?dayId=00000000-0000-4000-8000-999999999999`);
    await expect(page.getByText(/指定された日次記録を確認できません/)).toBeVisible();
    await page.goto(savedUrl);
    await expect(page.getByText("用途・補足：訪問先の駐車料金")).toBeVisible();
    await page.getByLabel("支払先").fill("未保存の下書き");
    page.once("dialog",dialog=>void dialog.dismiss());
    await page.getByRole("link",{name:"買取支援ホームへ戻る"}).click();
    await expect(page.getByLabel("支払先")).toHaveValue("未保存の下書き");
    await page.getByLabel("支払先").fill("");
    await expect(page.getByText("財布残高・金庫残高：")).toContainText("未算定");
    const managerContext=await browser.newContext({viewport:{width:390,height:844}});
    try{
      await addRole(managerContext,"manager");
      const managerPage=await managerContext.newPage();
      await managerPage.goto(`${webBase}/expense-settlement${new URL(page.url()).search}`);
      await expect(managerPage.getByText("別の査定員（閲覧のみ）")).toBeVisible();
      await expect(managerPage.getByRole("button",{name:"候補として保存"})).toHaveCount(0);
      await expect(managerPage.getByRole("button",{name:"日次記録を開く"})).toHaveCount(0);
      await expect(managerPage.getByText("対象外の理由：匿名テストの重複")).toBeVisible();
    }finally{await managerContext.close();}
    const results=await new AxeBuilder({page}).withTags(["wcag2a","wcag2aa","wcag21aa"]).analyze();
    expect(results.violations.filter(item=>item.impact==="serious"||item.impact==="critical")).toEqual([]);
  }finally{await context.close();}
});

test("expense write with a lost response resumes by operation key without a duplicate",async({browser,browserName})=>{
  const context=await browser.newContext({viewport:{width:browserName==="webkit"?390:1440,height:900}});
  await addRole(context,"assessor");
  const page=await context.newPage();
  try{
    await page.goto(`${webBase}/expense-settlement`);
    await page.getByLabel("業務日",{exact:true}).fill(browserName==="webkit"?"2026-09-25":"2026-09-26");
    await page.getByRole("button",{name:"日次記録を開く"}).click();
    await expect(page.getByRole("heading",{name:/の取りまとめ/})).toBeVisible();
    const itemUrl=`${apiBase}/expense-days/*/items`;
    let intercepted=0;
    await page.route(itemUrl,async route=>{
      intercepted++;
      const response=await route.fetch({headers:{...route.request().headers(),"x-dev-role":"assessor"}});
      expect(response.status()).toBe(201);
      await route.abort("failed");
    },{times:1});
    await page.getByLabel("支払先").fill("匿名の通信断テスト");
    await page.getByLabel("支払額（円）").fill("700");
    await page.getByRole("button",{name:"候補として保存"}).click();
    await expect(page.getByRole("heading",{name:"保存結果の確認"})).toBeVisible();
    expect(intercepted).toBe(1);
    await page.getByRole("button",{name:"保存結果を確認"}).click();
    await expect(page.getByRole("heading",{name:"保存結果の確認"})).toHaveCount(0);
    await expect(page.getByText("匿名の通信断テスト")).toHaveCount(1);
    await page.reload();
    await expect(page.getByText("匿名の通信断テスト")).toHaveCount(1);
    expect(await page.evaluate(()=>Object.keys(sessionStorage).filter(key=>key.startsWith("hanamaru:expense:pending:")))).toEqual([]);
    await page.evaluate(()=>{
      const original=Storage.prototype.setItem;
      Storage.prototype.setItem=function(key:string,value:string){
        if(key.startsWith("hanamaru:expense:pending:"))throw new DOMException("Storage unavailable","QuotaExceededError");
        return original.call(this,key,value);
      };
    });
    await page.getByLabel("支払先").fill("送信前停止の確認");
    await page.getByLabel("支払額（円）").fill("900");
    await page.getByRole("button",{name:"候補として保存"}).click();
    await expect(page.getByText(/一時保存できません。保存を開始せずに停止/)).toBeVisible();
    await expect(page.getByText("送信前停止の確認",{exact:true})).toHaveCount(0);
  }finally{await context.close();}
});

test("all 21 API-backed screens render and remain free of serious accessibility violations",async({page})=>{
  test.setTimeout(240_000);
  await page.goto(`${webBase}/`);
  expect(await page.evaluate(()=>Object.keys(localStorage).filter(key=>key.startsWith("firebase:authUser:")))).toEqual([]);
  for(const [screenId,path] of canonicalRoutes()){
    await page.goto(`${webBase}${path}`);await waitForResolvedScreen(page,path);
    await expect(page.locator("main h1"),screenId).toBeVisible();
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

test("market price completes image-assisted, manual-assisted, and manual-direct workflows",async({page,browserName})=>{
  test.setTimeout(180_000);
  const browserErrors:string[]=[];
  page.on("pageerror",error=>browserErrors.push(error.message));
  page.on("console",message=>{if(message.type()==="error")browserErrors.push(message.text());});
  async function start(mode:"画像＋AI補助"|"手入力＋AI補助"|"手入力のみ",suffix:string){
    await page.goto(`${webBase}/market-price`);await waitForResolvedScreen(page,"/market-price");
    await page.getByRole("radio",{name:new RegExp(mode)}).check();
    if(mode==="画像＋AI補助"){
      const png=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEUlEQVQImWMIyOv5D8IMMAYATgAJJbPQh8gAAAAASUVORK5CYII=","base64");
      await page.locator('input[type="file"]').setInputFiles({name:`market-${suffix}.png`,mimeType:"image/png",buffer:png});
    }
    await page.getByLabel(/商品名/).fill(`Canon EOS R6 ボディ ${suffix}`);
    if(mode!=="手入力のみ"){
      await page.getByLabel(/ブランド/).fill("Canon");
      await page.getByLabel(/型番/).fill(`EOS R6 ${suffix}`);
    }
    if(mode==="手入力のみ")await page.getByLabel(/検索キーワード/).fill(`Canon EOS R6 ボディ ${suffix}`);
    await page.getByRole("button",{name:/検索条件を確認/}).click();
    await expect(page).toHaveURL(/\/market-price\?view=identify&searchId=[0-9a-f-]{36}/);
    if(mode!=="手入力のみ"){
      await page.getByRole("button",{name:"採用して編集"}).first().click({timeout:30_000});
      await page.getByRole("radio",{name:/Canon EOS R6/}).first().check();
    }
    await page.getByRole("button",{name:/選択した取得元で検索/}).click();
    await expect(page.getByRole("heading",{name:"落札候補を確認"})).toBeVisible({timeout:60_000});
  }

  await start("画像＋AI補助",`${browserName}-image`);
  const firstToggle=page.getByRole("button",{name:"集計から除外"}).first();await firstToggle.click();
  await expect(page.getByRole("button",{name:"集計へ戻す"}).first()).toBeVisible();
  await page.getByRole("button",{name:"集計へ戻す"}).first().click();
  await page.getByRole("button",{name:"基準を再適用"}).click();
  await page.getByRole("button",{name:/この相場を確定/}).click();
  await expect(page.getByText("相場を確定しました")).toBeVisible({timeout:30_000});
  const confirmedUrl=page.url();await page.reload();await expect(page).toHaveURL(confirmedUrl);await expect(page.getByText("相場を確定しました")).toBeVisible();
  await page.getByRole("button",{name:"履歴を見る"}).click();await expect(page.getByRole("heading",{name:"買取相場の履歴"})).toBeVisible();

  await start("手入力＋AI補助",`${browserName}-assisted`);
  await start("手入力のみ",`${browserName}-direct`);

  await page.goto(`${webBase}/market-price`);await waitForResolvedScreen(page,"/market-price");
  await page.getByRole("radio",{name:/手入力のみ/}).check();
  await page.getByLabel(/商品名/).fill(`PlayStation 5 Slim ${browserName}`);
  await page.getByLabel(/型番/).fill("CFI-2000A01");
  await page.getByRole("button",{name:/検索条件を確認/}).click();
  await page.getByRole("radio",{name:/型番を優先して検索/}).check();
  await expect(page.getByText(/「CFI-2000A01」が一致する商品だけを集計/)).toBeVisible();
  await page.getByRole("button",{name:/選択した取得元で検索/}).click();
  await expect(page.getByRole("heading",{name:"落札候補を確認"})).toBeVisible({timeout:60_000});
  await expect(page.getByText("型番一致").first()).toBeVisible();
  await expect(page.getByText(/CFI-2000A01 ボディ/).first()).toBeVisible();

  await page.goto(`${webBase}/market-price`);await waitForResolvedScreen(page,"/market-price");
  await page.getByRole("radio",{name:/手入力のみ/}).check();
  await page.getByLabel(/商品名/).fill(`Canon EOS R6 比較 ${browserName}`);
  await page.getByLabel(/検索キーワード/).fill(`Canon EOS R6 比較 ${browserName}`);
  await page.getByRole("button",{name:/検索条件を確認/}).click();
  await page.getByRole("radio",{name:/両方を比較/}).check();
  await page.getByRole("button",{name:/選択した取得元で検索/}).click();
  await expect(page.getByText("取得元を比較中")).toBeVisible({timeout:30_000});
  await expect(page.getByRole("button",{name:/結果を確認/})).toHaveCount(2,{timeout:60_000});
  await page.getByRole("button",{name:/結果を確認/}).first().click();
  await expect(page.getByRole("heading",{name:"落札候補を確認"})).toBeVisible();
  await expect(page.getByRole("button",{name:/オークファンの結果へ切替|ヤフオクの結果へ切替/})).toBeVisible();
  const accessibility=await new AxeBuilder({page}).withTags(["wcag2a","wcag2aa","wcag21aa","wcag22aa"]).analyze();
  expect(accessibility.violations.filter(item=>item.impact==="serious"||item.impact==="critical")).toEqual([]);
  expect(browserErrors,"browser console and page errors").toEqual([]);
});

test("mobile navigation and progressive panes preserve URL-addressable state",async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await page.goto(`${webBase}/`);
  const mobileNav=page.getByRole("navigation",{name:"モバイルナビゲーション"});
  await expectCurrentMobileNavigation(page);
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
  const searchResults=page.getByRole("button",{name:/検索結果を見る/});
  await expect(searchResults).toContainText("60件");
  await searchResults.click();
  await expect(page).toHaveURL(/view=list/);
  await page.getByRole("region",{name:"検索結果一覧"}).locator("button[data-selected]").first().click();
  await expect(page).toHaveURL(/view=detail/);
  await expect(page.getByRole("button",{name:"検索結果へ戻る"})).toBeVisible();
});

test("keyboard focus uses the high-visibility DADS double indicator",async({page})=>{
  await page.goto(`${webBase}/visits`);await waitForResolvedScreen(page,"/visits");
  const action=page.getByRole("link",{name:"PDFから訪問を登録"});
  await action.focus();
  const focusStyle=await action.evaluate(element=>{const style=getComputedStyle(element);return{outlineColor:style.outlineColor,outlineWidth:style.outlineWidth,boxShadow:style.boxShadow};});
  expect(focusStyle.outlineColor).toBe("rgb(0, 0, 0)");
  expect(focusStyle.outlineWidth).toBe("2px");
  expect(focusStyle.boxShadow).toContain("rgb(255, 212, 61)");
});

test("smartphone business content and navigation use the readable typography scale",async({page})=>{
  test.setTimeout(240_000);
  await page.setViewportSize({width:390,height:844});
  const allUndersized:Array<{screenId:string;tag:string;text:string;fontSize:string}>=[];
  for(const [screenId,path] of canonicalRoutes()){
    await page.goto(`${webBase}${path}`);await waitForResolvedScreen(page,path);await page.waitForLoadState("networkidle");
    const undersized=await page.locator("main").evaluate(main=>{
      const ignoredTags=new Set(["SCRIPT","STYLE","SVG","PATH"]);
      return [...main.querySelectorAll<HTMLElement>("*")].filter(element=>{
        if(ignoredTags.has(element.tagName)||element.closest('[aria-hidden="true"]'))return false;
        const style=getComputedStyle(element);const rect=element.getBoundingClientRect();
        if(style.display==="none"||style.visibility==="hidden"||rect.width===0||rect.height===0)return false;
        const hasOwnText=[...element.childNodes].some(node=>node.nodeType===Node.TEXT_NODE&&node.textContent?.trim());
        const isTextControl=element instanceof HTMLInputElement||element instanceof HTMLTextAreaElement||element instanceof HTMLSelectElement;
        if(!hasOwnText&&!isTextControl)return false;
        return Number.parseFloat(style.fontSize)<13;
      }).map(element=>({tag:element.tagName,text:(element.textContent??element.getAttribute("aria-label")??"").trim().slice(0,60),fontSize:getComputedStyle(element).fontSize}));
    });
    allUndersized.push(...undersized.map(item=>({screenId,...item})));
  }
  expect(allUndersized,"visible smartphone main content below 13px").toEqual([]);

  await page.goto(`${webBase}/`);await waitForResolvedScreen(page,"/");
  await expect(page.locator("main h1")).toHaveCSS("font-size","26px");
  await expect(page.locator("main textarea")).toHaveCSS("font-size","16px");
  await expect(page.getByRole("navigation",{name:"モバイルナビゲーション"}).getByRole("link",{name:"ホーム"})).toHaveCSS("font-size","12px");

  await page.setViewportSize({width:768,height:1024});
  await expect(page.locator("main h1")).toHaveCSS("font-size","32px");
});

test("market price input methods stay readable at panel and smartphone widths",async({page})=>{
  async function assertSingleColumn(width:number,height:number){
    await page.setViewportSize({width,height});
    await page.goto(`${webBase}/market-price`);await waitForResolvedScreen(page,"/market-price");
    const cards=page.locator('main input[name="inputMode"]').locator("..");
    await expect(cards).toHaveCount(3);
    const cardBoxes=await cards.evaluateAll(elements=>elements.map(element=>{const rect=element.getBoundingClientRect();return{x:rect.x,y:rect.y,width:rect.width,height:rect.height};}));
    expect(cardBoxes[0].width).toBeGreaterThan(width<=430?280:400);
    expect(cardBoxes[1].y).toBeGreaterThan(cardBoxes[0].y+cardBoxes[0].height-1);
    expect(cardBoxes[2].y).toBeGreaterThan(cardBoxes[1].y+cardBoxes[1].height-1);
    const titles=cards.locator("strong");
    for(let index=0;index<await titles.count();index++){
      const metrics=await titles.nth(index).evaluate(element=>{const style=getComputedStyle(element);return{height:element.getBoundingClientRect().height,lineHeight:Number.parseFloat(style.lineHeight)};});
      expect(metrics.height).toBeLessThanOrEqual(metrics.lineHeight*1.25);
    }
  }
  await assertSingleColumn(1440,900);
  await assertSingleColumn(390,844);
  await assertSingleColumn(360,800);
});

test("200 percent reflow and a reduced keyboard viewport keep focused input above navigation",async({page})=>{
  await page.setViewportSize({width:640,height:720});
  await page.goto(`${webBase}/knowledge/manuals`);await waitForResolvedScreen(page,"/knowledge/manuals");
  expect(await page.locator("body").evaluate(body=>body.scrollWidth<=window.innerWidth),"1280px desktop at 200% effective width").toBe(true);

  await page.setViewportSize({width:390,height:568});
  await page.goto(`${webBase}/`);await waitForResolvedScreen(page,"/");
  const composer=page.locator("main textarea");await composer.focus();await composer.fill("訪問前に確認したい内容");await composer.scrollIntoViewIfNeeded();
  const geometry=async()=>page.evaluate(()=>{
    const input=document.querySelector<HTMLElement>("main textarea")?.getBoundingClientRect();
    const navigation=document.querySelector<HTMLElement>('[aria-label="モバイルナビゲーション"]')?.getBoundingClientRect();
    return {inputBottom:input?.bottom??Number.POSITIVE_INFINITY,navigationTop:navigation?.top??0,scrollWidth:document.body.scrollWidth,viewport:window.innerWidth,scrollY:window.scrollY,scrollHeight:document.documentElement.scrollHeight};
  });
  await expect.poll(async()=>{const bounds=await geometry();return bounds.inputBottom-bounds.navigationTop;}).toBeLessThanOrEqual(0);
  const bounds=await geometry();
  expect(bounds.scrollWidth).toBeLessThanOrEqual(bounds.viewport);
  expect(bounds.inputBottom).toBeLessThanOrEqual(bounds.navigationTop);
});

test("all 21 screens remain horizontally bounded at all eight responsive widths",async({page})=>{
  test.setTimeout(480_000);
  for(const [width,height] of [[320,720],[360,800],[390,844],[430,932],[768,1024],[834,1112],[1024,768],[1440,900]] as const){
    await page.setViewportSize({width,height});
    for(const [screenId,path] of canonicalRoutes()){
      await page.goto(`${webBase}${path}`);
      await waitForResolvedScreen(page,path);
      await expect(page.locator("main h1"),`${screenId}-${width}`).toBeVisible();
      await page.waitForLoadState("networkidle");
      expect(await page.locator("body").evaluate(body=>body.scrollWidth<=window.innerWidth),`${screenId} at ${width}px`).toBe(true);
    }
  }
});

test("assessor cannot reach administration and Chromium captures formal and core-width HITL images",async({browser,page,browserName})=>{
  test.setTimeout(360_000);
  const assessor=await browser.newContext();await addRole(assessor,"assessor");const assessorPage=await assessor.newPage();
  for(const path of ["/admin/contents","/admin/users","/admin/operations","/admin/approvals","/admin/analytics"]){await assessorPage.goto(`${webBase}${path}`);await expect(assessorPage.getByRole("heading",{name:"この画面を利用する権限がありません"})).toBeVisible();}
  await assessor.close();
  test.skip(browserName!=="chromium","formal 60-image evidence is captured once in Chromium");
  for(const [viewport,width,height] of [["mobile",390,844],["tablet",834,1112],["desktop",1440,900]] as const){
    await page.setViewportSize({width,height});for(const [screenId,path] of canonicalRoutes()){
      await page.goto(`${webBase}${path}`);await waitForResolvedScreen(page,path);await expect(page.locator("main h1"),`${screenId}-${viewport}`).toBeVisible();
      await page.waitForLoadState("networkidle");
      expect(await page.locator("body").evaluate(body=>body.scrollWidth<=window.innerWidth),`${screenId}-${viewport}`).toBe(true);
      if(viewport==="mobile"&&path!=="/login")await expectCurrentMobileNavigation(page);
      await page.screenshot({path:resolve(screenshots,`${screenId}-${viewport}.png`),fullPage:viewport!=="mobile",animations:"disabled",caret:"initial"});
    }
  }
  const coreRoutes=canonicalRoutes().filter(([screenId])=>Number(screenId.slice(-3))>=3&&Number(screenId.slice(-3))<=9);
  for(const [width,height] of [[360,800],[430,932]] as const){
    await page.setViewportSize({width,height});
    for(const [screenId,path] of coreRoutes){
      await page.goto(`${webBase}${path}`);await waitForResolvedScreen(page,path);await page.waitForLoadState("networkidle");
      await page.screenshot({path:resolve(screenshots,`${screenId}-${width}.png`),fullPage:false,animations:"disabled",caret:"initial"});
    }
  }
});
