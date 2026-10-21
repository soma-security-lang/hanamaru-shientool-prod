import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
async function waitUntil(predicate, timeout=10000){
 const deadline=Date.now()+timeout;
 while(Date.now()<deadline){if(await predicate())return;await new Promise(r=>setTimeout(r,100));}
 throw Error('Read-only UI condition did not settle before timeout');
}
async function absent(locator){await waitUntil(async()=>await locator.count()===0);}
const apiOrigin='https://hanamaru-pilot-api-tpqjzqidwa-an.a.run.app';
export const isBusinessMutation=request=>new URL(request.url()).origin===apiOrigin&&new URL(request.url()).pathname.startsWith('/api/v1/')&&!['GET','HEAD','OPTIONS'].includes(request.method());
export default async function uiGate({context,pages,roots,command}){
 const result={id:command.id,phase:command.phase,status:'FAIL',readOnly:true,checkedAt:new Date().toISOString()};
 if(command.phase==='baseline'){
  result.publicRuntime={};
  for(const phase of ['stage','fixed']){ const p=pages[phase];result.publicRuntime[phase]={closed:p.isClosed(),origin:new URL(p.url()).origin};try{result.publicRuntime[phase].config=await p.evaluate(()=>window.__HANAMARU_RUNTIME_CONFIG??null);}catch(e){result.publicRuntime[phase].readError=e.name;} }
  result.status='PASS';return result;
 }
 const phase=command.phase;const page=pages[phase];const base=roots[phase];
 const mutations=[];let me;let visitId;const errors=[];
 const routeHandler=async route=>{if(isBusinessMutation(route.request())){mutations.push(new URL(route.request().url()).pathname.replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/g,'[id]'));await route.abort();}else await route.continue();};
 const errorHandler=e=>{if(!e.message.includes('_rsc=')||!e.message.includes('access control checks'))errors.push(e.name);};
 const responseHandler=async response=>{try{
  const url=new URL(response.url());if(url.origin!==apiOrigin||response.status()!==200)return;
  if(url.pathname==='/api/v1/me')me=await response.json();
  if(url.pathname==='/api/v1/visits'){const body=await response.json();visitId=body.items?.[0]?.id;}
 }catch{}};
 try{
  assert.equal(command.readOnly,true);assert.match(command.expectedSourceSha,/^[0-9a-f]{40}$/);
  await context.route('**/*',routeHandler);page.on('pageerror',errorHandler);page.on('response',responseHandler);
  const htmlResponse=await page.request.get(base+'/login');assert.equal(htmlResponse.status(),200);
  assert.ok((htmlResponse.headers()['cache-control']??'').includes('no-store'));
  const html=await htmlResponse.text();const assets=[...html.matchAll(/(?:src|href)="([^"]*\/_next\/static\/[^\"]+\.(?:js|css)(?:\?[^\"]*)?)"/g)].map(x=>x[1].replaceAll('&amp;','&'));
  assert.ok(assets.length>0);assert.ok(assets.every(x=>new URL(x,base).searchParams.get('dpl')===command.expectedSourceSha),'Deployment ID must match the exact main SHA');
  await page.goto(base+'/',{waitUntil:'domcontentloaded'});
  await waitUntil(()=>Boolean(me),30000);
  assert.ok(me.roles.includes('manager'));assert.ok(!me.roles.includes('system_admin'),'Business UI requires an existing manager identity, not system_admin');
  await page.goto(base+'/visits',{waitUntil:'domcontentloaded'});await page.locator('main h1').first().waitFor({state:'visible'});
  await waitUntil(()=>Boolean(visitId),15000);assert.match(visitId,/^[0-9a-f-]{36}$/);
  const flags=me.featureFlags??{};
  const screens=[['SCR-002','/'],['SCR-003','/visits'],['SCR-004',`/visits/${visitId}/import`],['SCR-005',`/visits/${visitId}/preparation`],['SCR-006',`/visits/${visitId}/transcription`],['SCR-007',`/visits/${visitId}/review/input`],['SCR-008',`/visits/${visitId}/review`],['SCR-009','/reviews'],['SCR-010','/knowledge/talks'],['SCR-011','/knowledge/flows'],['SCR-012','/knowledge/reference'],['SCR-013','/knowledge/manuals'],['SCR-014','/training/videos'],['SCR-015','/training/roleplay'],['SCR-016','/admin/contents'],['SCR-017','/admin/users'],['SCR-018','/admin/operations'],['SCR-019','/admin/approvals','content_approval'],['SCR-020','/admin/analytics','team_analytics'],['SCR-021','/market-price','market_price_search'],['PURCHASE','/purchase-results','purchase_results'],['PERFORMANCE','/performance','purchase_performance'],['EXPENSE','/expense-settlement','expense_settlement']];
  result.screens=[];
  for(const width of [1440,834,390,320]){
   await page.setViewportSize({width,height:1000});
   for(const [id,path,flag] of screens){
    const response=await page.goto(base+path,{waitUntil:'domcontentloaded'});assert.equal(response.status(),200);
    await page.locator('main h1').first().waitFor({state:'visible'});
    await absent(page.getByRole('heading',{name:'利用者情報を確認しています',exact:true}));
    await absent(page.getByRole('heading',{name:'ログインが必要です',exact:true}));
    await absent(page.getByRole('heading',{name:'利用者情報を確認できません',exact:true}));
    if(!flag||flags[flag])await absent(page.getByRole('heading',{name:'この画面を利用する権限がありません',exact:true}));
    const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);assert.equal(overflow,false,`${id}/${width} overflow`);
    result.screens.push({id,width,rendered:true,featureEnabled:flag?Boolean(flags[flag]):true});
   }
  }
  const anonymous=await context.browser().newContext();
  try{
   const api=await anonymous.request.get(apiOrigin+'/api/v1/me');assert.equal(api.status(),401);
   const guest=await anonymous.newPage();await guest.goto(base+'/admin/users');await guest.getByRole('heading',{name:'ログインが必要です',exact:true}).waitFor({state:'visible'});
  }finally{await anonymous.close();}
  assert.deepEqual(mutations,[]);assert.deepEqual(errors,[]);
  result.status='PASS';result.sourceSha=command.expectedSourceSha;result.businessMutations=0;result.apiAnonymousStatus=401;result.managerVerified=true;result.customerRecordsSaved=false;
 }catch(e){result.failure=e.name;result.message=String(e.message).replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/g,'[id]').slice(0,500);result.businessMutations=mutations.length;}
 finally{page.off('pageerror',errorHandler);page.off('response',responseHandler);await context.unroute('**/*',routeHandler);}
 writeFileSync(new URL(`../../purchase-ui-${phase}-gate-result.json`,import.meta.url),JSON.stringify(result,null,2),{mode:0o600});
 return result;
}
