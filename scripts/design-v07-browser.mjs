import {createRequire} from 'node:module';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const require=createRequire(new URL('../apps/web/package.json',import.meta.url));
const {chromium}=require('@playwright/test');
const out=new URL('../evidence/design-v07/',import.meta.url);
await mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true,channel:"chrome"});
const results=[];
const baseUrl=process.env.DESIGN_V07_BASE_URL??'http://127.0.0.1:3113';
assert.equal(new URL(baseUrl).hostname,'127.0.0.1','design checks require loopback');
try {
for(const width of [1100,390,320]) {
 const context=await browser.newContext({viewport:{width,height:900}});
 await context.addInitScript(()=>sessionStorage.setItem('hanamaru.sso.access',JSON.stringify({token:'synthetic-local-only',expiresAt:Date.now()+3600000})));
 let rows=[{id:'synthetic-1',businessDate:'2026-10-20',purchaseAmount:'9007199254740993',status:'confirmed',lockVersion:1}];
 let posts=0;
 await context.route('**/*',async route=>{
   const u=new URL(route.request().url());
   if(u.hostname!=='127.0.0.1')return route.abort();
   if(!u.pathname.startsWith('/api/v1/'))return route.continue();
   let body={items:[],hasMore:false,nextCursor:null,total:0};
   if(u.pathname.endsWith('/me'))body={id:'synthetic-manager',displayName:'合成検証担当',organizationName:'画面検証用・架空組織',branchName:'合成拠点',roles:['manager'],capabilities:['job:manage'],featureFlags:{market_price_search:true,expense_settlement:true,purchase_results:true,purchase_performance:true}};
   else if(u.pathname==='/api/v1/purchase-results') {
     if(route.request().method()==='POST'){posts++;rows=[...rows,{id:'synthetic-new',businessDate:'2026-10-20',purchaseAmount:JSON.parse(route.request().postData()).purchaseAmount,status:'draft',lockVersion:1}];body=rows.at(-1);}
     else body={items:rows};
   } else if(u.pathname.endsWith('/purchase-performance'))body={totalAmount:'9007199254740993',transactionCount:1,branches:[],assessors:[],branchOptions:[],cells:[],branchRankings:[],noResultBranches:[],noResultAssessors:[],startDate:'2026-10-20',endDate:'2026-10-20',asOf:'2026-10-20T00:00:00Z',coverage:'合成データ'};
   else return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:{code:'LOCAL_MOCK',message:'合成エラー状態の検証です'}})});
   return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});
 });
 const page=await context.newPage();
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto(`${baseUrl}/purchase-results`);
 await page.getByRole('heading',{name:'買取実績を記録'}).waitFor();
 await page.getByText('9,007,199,254,740,993円').waitFor();
 const bound=await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth);
 assert.equal(bound,true,`overflow at ${width}`);
 const input=page.getByLabel('買取金額（円）');
 assert.equal(await input.evaluate(el=>getComputedStyle(el).fontSize),'16px');
 await input.fill('0');await page.getByRole('button',{name:'下書きとして保存'}).click();
 assert.equal(posts,0,'invalid amount sent');
 await input.fill('12345');await page.getByRole('button',{name:'下書きとして保存'}).click();
 await page.getByText('12,345円').waitFor();assert.equal(posts,1);
 await page.screenshot({path:new URL(`purchase-${width}.png`,out).pathname,fullPage:true});
 if(width<768){
   const trigger=page.getByRole('button',{name:'その他',exact:true});await trigger.click();
   const dialog=page.getByRole('dialog');await dialog.waitFor();
   for(const label of ['買取実績','実績・ランキング','現場の知識','研修','経費・車両金精算','管理'])assert.equal(await dialog.getByRole('link',{name:new RegExp(`^${label}`)}).count(),1,label);
   await page.screenshot({path:new URL(`menu-${width}.png`,out).pathname,fullPage:true});
   await page.keyboard.press('Escape');assert.equal(await dialog.isVisible(),false);
   assert.equal(await trigger.evaluate(el=>el===document.activeElement),true);
   await trigger.click();await dialog.waitFor();
   await page.setViewportSize({width:1100,height:900});
   await page.waitForFunction(()=>!document.querySelector('dialog[open]'));
   assert.equal(await page.locator('main').evaluate(el=>el===document.activeElement),true);
   await page.setViewportSize({width,height:900});
 }
 await input.focus();
 const focus=await input.evaluate(el=>({width:getComputedStyle(el).outlineWidth,offset:getComputedStyle(el).outlineOffset}));
 assert.deepEqual(focus,{width:'3px',offset:'4px'});
 await page.goto(`${baseUrl}/performance`);await page.getByRole('heading',{name:'実績・ランキング',exact:true}).waitFor();
 await page.getByRole('heading',{name:'確定買取金額'}).waitFor();
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 await page.screenshot({path:new URL(`performance-${width}.png`,out).pathname,fullPage:true});
 const errorStateRoutes=['/','/visits','/visits/synthetic/import','/visits/synthetic/preparation','/visits/synthetic/transcription','/visits/synthetic/review/input','/visits/synthetic/review','/reviews','/knowledge/talks','/knowledge/flows','/knowledge/reference','/knowledge/manuals','/training/videos','/training/roleplay','/admin/contents','/admin/users','/admin/operations','/admin/approvals','/admin/analytics','/market-price','/expense-settlement','/login'];
 const routeChecks=[];
 for(const path of errorStateRoutes){
   await page.goto(`${baseUrl}${path}`);
   await page.locator('h1').first().waitFor();
   await page.waitForFunction(()=>!document.body.textContent.includes('利用者情報を確認しています'));
   const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);
   routeChecks.push({path,overflow,heading:await page.locator('h1').first().innerText()});
 }
 results.push({routeChecks,width,purchaseLayout:'pass',largeAmount:'pass',input:'16px',focus,localOnlySaveFlow:'pass',mobileMenu:width<768?'pass':'not-applicable',pageErrors:errors});
 assert.equal(errors.length,0);
 await context.close();
}
await writeFile(new URL('browser-results.json',out),JSON.stringify(results,null,2));
console.log(JSON.stringify(results,null,2));
} finally {await browser.close();}
