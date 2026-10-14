import AxeBuilder from '@axe-core/playwright';
import {expect,test} from '@playwright/test';
import {createLiveSession,installLiveSession} from './auth';

test.skip(process.env.LIVE_PURCHASE_READBACK!=='1','Explicit purchase release readback is required');
test('deployed purchase rankings and registered branches are available without modifying real records',async({browser})=>{
 test.setTimeout(120000);
 const token=process.env.LIVE_E2E_IDENTITY_PLATFORM_ID_TOKEN;
 expect(token,'Approved live manager identity is required').toBeTruthy();
 const expected=JSON.parse(process.env.LIVE_PURCHASE_EXPECTED_BRANCH_KEYS??'[]') as string[];
 expect(expected.length,'Expected operational branch names must be supplied').toBeGreaterThan(0);
 const session=await createLiveSession(token!);
 expect(session.me.featureFlags.purchase_results).toBe(true);
 expect(session.me.featureFlags.purchase_performance).toBe(true);
 const date=new Date(Date.now()+9*60*60*1000).toISOString().slice(0,10);
 const response=await session.api.get(`purchase-performance?date=${date}&period=month`);
 expect(response.ok()).toBeTruthy();
 const data=await response.json() as {branchOptions:Array<{id:string;name:string}>};
 for(const name of expected)expect(data.branchOptions.some(b=>b.name===name),`Registered branch ${name} unavailable`).toBe(true);
 const context=await browser.newContext({viewport:{width:390,height:844}});
 try{
  await installLiveSession(context,session);const page=await context.newPage();
  const base=process.env.E2E_WEB_BASE_URL!;
  await page.goto(`${base}/performance?date=${date}&period=month`);
  await expect(page.getByRole('heading',{name:'実績・ランキング',exact:true})).toBeVisible();
  await expect(page.getByRole('list',{name:'グラフの拠点凡例'})).toContainText(expected[0]!);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  expect((await new AxeBuilder({page}).analyze()).violations.filter(v=>v.impact==='serious'||v.impact==='critical')).toEqual([]);
  await page.getByLabel('対象拠点',{exact:true}).selectOption(data.branchOptions.find(b=>b.name===expected[0])!.id);
  await expect(page.getByRole('list',{name:'グラフの拠点凡例'}).getByRole('listitem')).toHaveCount(1);
  await page.goto(`${base}/purchase-results`);
  await expect(page.getByRole('heading',{name:'買取実績を記録',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'下書きとして保存'})).toBeVisible();
  expect((await new AxeBuilder({page}).analyze()).violations.filter(v=>v.impact==='serious'||v.impact==='critical')).toEqual([]);
 }finally{await context.close();await session.api.dispose();}
});
