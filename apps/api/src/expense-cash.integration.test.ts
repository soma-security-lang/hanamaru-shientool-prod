import {randomUUID} from 'node:crypto';
import type {FastifyInstance} from 'fastify';
import {beforeAll,afterAll,describe,expect,it} from 'vitest';
import {createPool,developmentIds as d,HanamaruRepository} from '@hanamaru/database';
import {createLocalProviders} from '@hanamaru/platform';
import {buildApp} from './app.js';
import {loadConfig} from './config.js';

const databaseUrl=process.env.DATABASE_URL;
describe.skipIf(!databaseUrl)('expense branch closing and correction',()=>{
 let app:FastifyInstance;
 beforeAll(async()=>{app=await buildApp({repository:new HanamaruRepository(createPool(databaseUrl)),providers:createLocalProviders(),config:{...loadConfig({NODE_ENV:'test',ALLOW_DEV_AUTH:'true',LOG_LEVEL:'silent'}),port:0}});});
 afterAll(async()=>{await app.close();});
 const headers=(role='manager',key=randomUUID())=>({'x-dev-role':role,'idempotency-key':key});
 const read=async(id:string,role='manager')=>{const r=await app.inject({method:'GET',url:`/api/v1/expense-branch-days/${id}`,headers:headers(role)});expect(r.statusCode,r.body).toBe(200);return r.json();};
 async function create(businessDate:string,branchId=d.branchId,memberIds:string[]=[d.membershipId]){const r=await app.inject({method:'POST',url:'/api/v1/expense-branch-days',headers:headers(),payload:{branchId,businessDate,rosterNote:'架空の当番表を確認',memberIds}});expect(r.statusCode,r.body).toBe(201);return r.json().id as string;}
 async function command(id:string,action:string,body:Record<string,unknown>,role='manager',status=200){const detail=await read(id);const r=await app.inject({method:'POST',url:`/api/v1/expense-branch-days/${id}/actions/${action}`,headers:headers(role),payload:{expectedLockVersion:detail.day.lockVersion,...body}});expect(r.statusCode,r.body).toBe(status);return r;}
 const expense={merchant:'架空駐車場',category:'駐車場',amount:1200,paymentSource:'company_wallet',humanConfirmed:true,note:'合成試験'};

 it('separates replenishment, expense, closing with a difference, report and later correction',async()=>{
  const id=await create('2026-06-02');const detail=await read(id);const dayId=detail.participants[0].id;
  await command(id,'ready',{dayId},'manager',422);
  await command(id,'entry',{dayId,entryType:'daily',openingWalletCash:200000,purchaseTotal:150000,purchaseSourceNote:'架空買取表 6/2'},'assessor');
  await command(id,'entry',{dayId,...expense},'assessor');
  await command(id,'entry',{dayId,...expense,merchant:'架空備品',amount:1000,paymentSource:'personal'});
  const unpaid=await app.inject({method:'POST',url:`/api/v1/expense-days/${dayId}/followups`,headers:headers('assessor'),payload:{kind:'unreplenished',amount:151200,reason:'帰社後に補充'}});expect(unpaid.statusCode).toBe(201);
  const transfer={dayId,amount:100000,performedBy:d.managerMembershipId,occurredAt:'2026-06-02T19:00:00+09:00',reason:'合成補充',unreplenishedId:unpaid.json().id};
  await command(id,'transfer',transfer);
  expect((await read(id)).unreplenished[0].status).toBe('open');
  await command(id,'transfer',{...transfer,amount:51200});
  expect((await read(id)).unreplenished[0].status).toBe('resolved');
  await command(id,'transfer',{...transfer,amount:1},'manager',422);
  let current=await read(id);expect(current.participants[0]).toMatchObject({companyExpense:'1200',personalExpense:'1000',purchaseTotal:'150000'});
  await command(id,'reconcile',{expectedCash:500000,actualCash:499500,reference:'合成残金表'},'assessor',403);
  await command(id,'reconcile',{expectedCash:500000,actualCash:499500,reference:'合成残金表'});
  await command(id,'close',{acknowledgeDifference:true,note:'原因調査中',assigneeId:d.managerMembershipId},'manager',422);
  await command(id,'ready',{dayId});
  await command(id,'close',{acknowledgeDifference:true,note:'原因調査中',assigneeId:d.managerMembershipId},'manager',409);
  await command(id,'reconcile',{expectedCash:500000,actualCash:499500,reference:'合成残金表'});
  await command(id,'close',{note:'原因調査中',assigneeId:d.managerMembershipId},'manager',422);
  const version=(await read(id)).day.lockVersion,key=randomUUID(),payload={expectedLockVersion:version,acknowledgeDifference:true,note:'原因調査中',assigneeId:d.managerMembershipId};
  const close=await Promise.all([1,2].map(()=>app.inject({method:'POST',url:`/api/v1/expense-branch-days/${id}/actions/close`,headers:headers('manager',key),payload})));
  expect(close.map(r=>r.statusCode)).toEqual([200,200]);
  current=await read(id);expect(current.day.status).toBe('closed_difference');expect(current.issues).toHaveLength(1);expect(current.closure.difference).toBe('-500');expect(current.report).toBeNull();
  const snapshotHash=current.closure.snapshotHash;
  const personalView=await app.inject({method:'GET',url:`/api/v1/expense-days/${dayId}`,headers:headers('assessor')});expect(personalView.json().branchClosingStatus).toBe('closed_difference');
  const oldItem=current.items.find((i:{paymentSource:string})=>i.paymentSource==='company_wallet');
  expect((await app.inject({method:'POST',url:`/api/v1/expense-days/${dayId}/items`,headers:headers('assessor'),payload:expense})).statusCode).toBe(403);
  await command(id,'entry',{dayId,...expense},'manager',403);
  await command(id,'correct',{dayId,...expense,itemId:oldItem.id,itemLockVersion:oldItem.lockVersion,amount:1400,reason:'合成訂正'},'assessor',403);
  await command(id,'correct',{dayId,...expense,itemId:oldItem.id,itemLockVersion:oldItem.lockVersion,amount:1400,reason:'合成訂正'});
  await command(id,'correct',{dayId,...expense,amount:300,reason:'前日の入力漏れ'});
  current=await read(id);expect(current.closure.snapshotHash).toBe(snapshotHash);expect(current.transfers).toHaveLength(2);expect(current.participants[0].companyExpense).toBe('1700');expect(current.day.reviewRequired).toBe(true);
  await command(id,'report',{reportedAt:'2026-06-03T09:00:00+09:00',note:'報告したことの自己記録'});
  expect((await read(id)).report.reportedAt).toBe('2026-06-03T09:00:00+09:00');
  expect((await app.inject({method:'GET',url:`/api/v1/expense-branch-days/${id}/logs`,headers:headers('assessor')})).statusCode).toBe(403);
  const logs=await app.inject({method:'GET',url:`/api/v1/expense-branch-days/${id}/logs`,headers:headers()});expect(logs.statusCode).toBe(200);expect(logs.json().some((l:{action:string;details:{before:unknown}})=>l.action==='correct'&&l.details.before)).toBe(true);
  const pending=await app.inject({method:'GET',url:`/api/v1/expense-branch-days?branchId=${d.branchId}&businessDate=2026-06-03`,headers:headers()});expect(pending.json().pending.some((i:{branchDayId:string})=>i.branchDayId===id)).toBe(true);
  await command(id,'resolve',{issueId:current.issues.find((i:{kind:string})=>i.kind==='cash_difference').id,note:'現物を再確認し別記録へ引継ぎ'});
  const correctionIssue=(await read(id)).issues.find((i:{kind:string})=>i.kind==='post_close_correction');await command(id,'resolve',{issueId:correctionIssue.id,note:'自動承認しない'},'manager',403);
  expect((await read(id)).day.status).toBe('closed_difference');
 });

 it('invalidates reconciliation on personal entry and rejects stale writes, foreign IDs and unconfirmed candidates',async()=>{
  const id=await create('2026-06-04'),dayId=(await read(id)).participants[0].id;
  await command(id,'entry',{entryType:'daily',dayId,openingWalletCash:0,purchaseTotal:0,purchaseSourceNote:'支出なしの確認資料'});
  const candidate=await app.inject({method:'POST',url:`/api/v1/expense-days/${dayId}/items`,headers:headers('assessor'),payload:expense});expect(candidate.statusCode).toBe(201);
  await command(id,'ready',{dayId},'manager',422);
  expect((await app.inject({method:'POST',url:`/api/v1/expense-days/${dayId}/items/${candidate.json().id}/confirm`,headers:headers('assessor'),payload:{expectedLockVersion:1}})).statusCode).toBe(200);
  await command(id,'ready',{dayId});await command(id,'reconcile',{expectedCash:0,actualCash:0,reference:'合成確認'});
  const before=await read(id);
  await app.inject({method:'PATCH',url:`/api/v1/expense-days/${dayId}`,headers:headers('assessor'),payload:{expectedLockVersion:2,purchaseSourceNote:'更新済み参照資料'}});
  const after=await read(id);expect(after.participants[0].readyAt).toBeNull();expect(after.day.reconciliationVersion).toBeNull();
  const stale=await app.inject({method:'POST',url:`/api/v1/expense-branch-days/${id}/actions/close`,headers:headers(),payload:{expectedLockVersion:before.day.lockVersion}});expect(stale.statusCode).toBe(409);
  await command(id,'entry',{dayId:randomUUID(),...expense},'manager',404);
  await command(id,'entry',{dayId,...expense,humanConfirmed:false},'manager',422);
  await command(id,'roster',{memberIds:[randomUUID()],rosterNote:'scope外'},'manager',403);
  expect((await app.inject({method:'GET',url:`/api/v1/expense-branch-days/${id}`,headers:headers('system_admin')})).statusCode).toBe(403);
  const noRole=await app.inject({method:'POST',url:'/api/v1/expense-branch-days',headers:headers(),payload:{branchId:randomUUID(),businessDate:'2026-06-04',rosterNote:'他支店',memberIds:[d.membershipId]}});expect(noRole.statusCode).toBe(403);
  await command(id,'ready',{dayId});await command(id,'reconcile',{expectedCash:0,actualCash:0,reference:'合成確認'});await command(id,'close',{});
  expect((await read(id)).day.status).toBe('closed_balanced');
 });

 it('serializes a personal update against closing and keeps successful operation results scoped',async()=>{
  const id=await create('2026-06-06'),dayId=(await read(id)).participants[0].id;
  await command(id,'entry',{entryType:'daily',dayId,openingWalletCash:0,purchaseTotal:0,purchaseSourceNote:'合成当日実績'});
  await command(id,'ready',{dayId});await command(id,'reconcile',{expectedCash:0,actualCash:0,reference:'合成残金表'});
  const initial=await read(id),key=randomUUID();
  const [closing,editing]=await Promise.all([
   app.inject({method:'POST',url:`/api/v1/expense-branch-days/${id}/actions/close`,headers:headers('manager',key),payload:{expectedLockVersion:initial.day.lockVersion}}),
   app.inject({method:'PATCH',url:`/api/v1/expense-days/${dayId}`,headers:headers('assessor'),payload:{expectedLockVersion:2,purchaseSourceNote:'合成実績の追記'}})
  ]);
  expect([[200,403],[409,200]]).toContainEqual([closing.statusCode,editing.statusCode]);
  if(closing.statusCode===409){await command(id,'ready',{dayId});await command(id,'reconcile',{expectedCash:0,actualCash:0,reference:'再照合'});await command(id,'close',{});}
  const current=await read(id);expect(current.day.status).toBe('closed_balanced');
  const other=await app.inject({method:'GET',url:`/api/v1/expense-branch-operations/${key}?operation=close`,headers:headers('assessor')});expect(other.json()).toMatchObject({status:'unknown',resourceId:null});
  const log=await app.inject({method:'GET',url:`/api/v1/expense-branch-days/${id}/logs`,headers:headers()});
  expect(log.json().some((e:{action:string})=>e.action==='締め時点の明細')).toBe(true);
  expect(log.json().some((e:{action:string})=>e.action==='expense_days.update')).toBe(true);
  const otherDay=await create('2026-06-07'),reportKey=randomUUID();
  const reportBody={branchDayId:randomUUID(),expectedLockVersion:current.day.lockVersion,reportedAt:'2026-06-07T10:00:00+09:00',note:'合成記録'};
  expect((await app.inject({method:'POST',url:`/api/v1/expense-branch-days/${id}/actions/report`,headers:headers('manager',reportKey),payload:reportBody})).statusCode).toBe(200);
  // The URL identity must participate in the request hash, even if an unknown
  // body field attempts to replace it. Never replay a different day's result.
  expect((await app.inject({method:'POST',url:`/api/v1/expense-branch-days/${otherDay}/actions/report`,headers:headers('manager',reportKey),payload:reportBody})).statusCode).toBe(409);
 });

 it('keeps branch policies fail closed, calculates a configured vault ledger once, and validates RLS',async()=>{
  const pool=createPool(databaseUrl),branch=randomUUID();
  try{
   await pool.query("INSERT INTO branches(id,organization_id,branch_key,name) VALUES($1,$2,$3,'合成計算拠点')",[branch,d.organizationId,`test-${branch}`]);
   await pool.query("INSERT INTO expense_cash_permissions(organization_id,branch_id,membership_id,authority,can_close,valid_from) VALUES($1,$2,$3,'officer',true,'2020-01-01')",[d.organizationId,branch,d.managerMembershipId]);
   // This test has a branch-specific synthetic membership, not a production role change.
   const member=randomUUID(),user=randomUUID();await pool.query("INSERT INTO users(id,provider_subject_hash,email_hash,email_masked,display_name) VALUES($1,$2,$2,'t***@example.invalid','合成検証担当')",[user,user.replaceAll('-','').padEnd(64,'0')]);await pool.query('INSERT INTO memberships(id,organization_id,user_id,branch_id) VALUES($1,$2,$3,$4)',[member,d.organizationId,user,branch]);
   const id=await create('2026-06-05',branch as typeof d.branchId,[member]),dayId=(await read(id)).participants[0].id;
   await command(id,'entry',{dayId,entryType:'daily',openingWalletCash:200000,purchaseTotal:150000,purchaseSourceNote:'合成買取資料'});
   await command(id,'entry',{dayId,...expense});await command(id,'ready',{dayId});
   await command(id,'reconcile',{expectedCash:0,actualCash:0,reference:'未設定'},'manager',403);
   await pool.query("INSERT INTO expense_cash_policies(organization_id,branch_id,reconciliation_mode,policy_reference,version) VALUES($1,$2,'vault_ledger_v1','合成計算契約',1)",[d.organizationId,branch]);
   await command(id,'transfer',{dayId,amount:151200,performedBy:d.managerMembershipId,occurredAt:'2026-06-05T18:00:00+09:00',reason:'合成補充'});
   await command(id,'reconcile',{openingVault:500000,externalInflow:100000,externalOutflow:0,actualCash:448800,reference:'金庫と財布を分けた合成資料'});
   expect((await read(id)).day.expectedCash).toBe('448800');
   const transfer=(await read(id)).transfers[0];await command(id,'reverse-transfer',{dayId,transferId:transfer.id,amount:151200,performedBy:d.managerMembershipId,occurredAt:'2026-06-05T18:00:00+09:00',reason:'入力誤りの取消'});
   await command(id,'reverse-transfer',{dayId,transferId:transfer.id,amount:151200,performedBy:d.managerMembershipId,occurredAt:'2026-06-05T18:00:00+09:00',reason:'二重取消'},'manager',409);
   await command(id,'reconcile',{openingVault:500000,externalInflow:100000,externalOutflow:0,actualCash:600000,reference:'取消反映'});expect((await read(id)).day.expectedCash).toBe('600000');
   await command(id,'close',{});
   const client=await pool.connect();try{
    await client.query('BEGIN');await client.query('SET LOCAL ROLE hanamaru_api');await client.query("SELECT set_config('app.organization_id',$1,true)",[randomUUID()]);
    for(const table of ['expense_cash_permissions','expense_cash_policies','expense_branch_days','expense_branch_participants','expense_cash_transfers','expense_branch_events','expense_branch_closures','expense_branch_issues'])expect((await client.query(`SELECT count(*)::int AS count FROM ${table}`)).rows[0].count).toBe(0);
    await client.query('ROLLBACK');
    await client.query('BEGIN');await client.query('SET LOCAL ROLE hanamaru_api');await client.query("SELECT set_config('app.organization_id',$1,true)",[d.organizationId]);
    await expect(client.query('UPDATE expense_branch_closures SET expected_cash=0')).rejects.toThrow();await client.query('ROLLBACK');
   }finally{client.release();}
   const log=await app.inject({method:'GET',url:`/api/v1/expense-branch-days/${id}/logs`,headers:headers()});expect(log.statusCode).toBe(200);
   await pool.query("UPDATE expense_cash_permissions SET valid_until=now()-interval '1 second' WHERE organization_id=$1 AND branch_id=$2",[d.organizationId,branch]);
   expect((await app.inject({method:'GET',url:`/api/v1/expense-branch-days/${id}`,headers:headers()})).statusCode).toBe(403);
  }finally{await pool.end();}
 });
});
