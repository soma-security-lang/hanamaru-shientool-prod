import {randomUUID} from 'node:crypto';
import type {RequestContext} from '@hanamaru/contracts';
import {beforeAll,afterAll,describe,it,expect} from 'vitest';
import type {FastifyInstance} from 'fastify';
import {createPool,developmentIds as d,HanamaruRepository} from '@hanamaru/database';
import {createLocalProviders} from '@hanamaru/platform';
import {buildApp} from './app.js';
import {loadConfig} from './config.js';
const url=process.env.DATABASE_URL;
describe.skipIf(!url)('買取台帳・限定ランキング公開',()=>{
 let app:FastifyInstance;let pool:ReturnType<typeof createPool>;
 const headers=(role='assessor',key=randomUUID())=>({'x-dev-role':role,'idempotency-key':key});
 beforeAll(async()=>{pool=createPool(url);app=await buildApp({repository:new HanamaruRepository(pool,'hanamaru_api','hanamaru_api_system'),providers:createLocalProviders(),config:{...loadConfig({NODE_ENV:'test',ALLOW_DEV_AUTH:'true',LOG_LEVEL:'silent'}),port:0}});});
 afterAll(async()=>{await app.close();});
 async function create(amount=10000,role='assessor',key=randomUUID()){
  const response=await app.inject({method:'POST',url:'/api/v1/purchase-results',headers:headers(role,key),payload:{businessDate:'2026-09-01',purchaseAmount:amount}});expect(response.statusCode,response.body).toBe(201);return response.json().id as string;
 }
 async function action(id:string,name:string,version:number,extra:Record<string,unknown>={},role='assessor'){
  return app.inject({method:'POST',url:`/api/v1/purchase-results/${id}/actions/${name}`,headers:headers(role),payload:{expectedLockVersion:version,...extra}});
 }
 const performance=async()=>{const r=await app.inject({method:'GET',url:'/api/v1/purchase-performance?date=2026-09-01&period=month',headers:headers()});expect(r.statusCode,r.body).toBe(200);return r.json();};
 it('拠点住所は任意項目で、更新しても既存の拠点IDを維持する',async()=>{
  const client=await pool.connect();
  try{await client.query('BEGIN');await client.query('UPDATE branches SET address=$2 WHERE id=$1',[d.branchId,'合成住所・実在の住所ではありません']);const r=await client.query('SELECT id,address FROM branches WHERE id=$1',[d.branchId]);expect(r.rows[0]).toEqual({id:d.branchId,address:'合成住所・実在の住所ではありません'});}finally{await client.query('ROLLBACK');client.release();}
 });
 it('同じ作成キーの並行再送は1取引、下書きは集計外',async()=>{
  const key=randomUUID(),payload={businessDate:'2026-09-01',purchaseAmount:10000};
  const responses=await Promise.all([1,2].map(()=>app.inject({method:'POST',url:'/api/v1/purchase-results',headers:headers('assessor',key),payload})));
  expect(responses.map(r=>r.statusCode)).toEqual([201,201]);expect(responses[0]!.json().id).toBe(responses[1]!.json().id);
  expect((await performance()).transactionCount).toBe(0);
  const listing=await app.inject({method:'GET',url:'/api/v1/purchase-results',headers:headers()});expect(listing.statusCode,listing.body).toBe(200);expect(listing.json().items).toHaveLength(1);
 });
 it('確定・理由付き訂正・取消で同じ版のグラフと順位を更新',async()=>{
  const id=await create();expect((await action(id,'confirm',1)).statusCode).toBe(200);
  const first=await performance();expect(first.totalAmount).toBe('10000');expect(first.assessors[0].rank).toBe(1);expect(first.series[0].amount).toBe('10000');
  expect((await action(id,'correct',1,{purchaseAmount:15000,reason:'合成訂正'})).statusCode).toBe(409);
  expect((await action(id,'correct',2,{purchaseAmount:15000,reason:'合成訂正'})).statusCode).toBe(200);
  expect((await performance()).totalAmount).toBe('15000');expect((await performance()).aggregationVersion).not.toBe(first.aggregationVersion);
  expect((await action(id,'cancel',3,{reason:'合成取消'})).statusCode).toBe(200);expect((await performance()).transactionCount).toBe(0);
  const r=await app.inject({method:'GET',url:`/api/v1/purchase-results/${id}`,headers:headers()});expect(r.json().revisions).toHaveLength(4);
 });
 it('査定員は他人の順位は見られるが取引詳細・訂正は不可',async()=>{
  const id=await create(20000,'manager');expect((await action(id,'confirm',1,{},'manager')).statusCode).toBe(200);
  const p=await performance();expect(p.assessors.some((r:{name:string})=>r.name==='鈴木 一郎')).toBe(true);
  const detail=await app.inject({method:'GET',url:`/api/v1/purchase-results/${id}`,headers:headers()});expect(detail.statusCode).toBe(404);
  expect((await action(id,'correct',2,{purchaseAmount:1,reason:'不正'})).statusCode).toBe(404);
  expect(JSON.stringify(p)).not.toContain(id);expect(JSON.stringify(p)).not.toContain('beforeJson');
 });
 it('通常のDB roleで他人の明細は不可、限定viewは集計のみ',async()=>{
  const repo=new HanamaruRepository(createPool(url),'hanamaru_api','hanamaru_api_system');
  const ctx:RequestContext={organizationId:d.organizationId,membershipId:d.membershipId,branchId:d.branchId,roles:['assessor'],capabilities:[],authorizationScopes:[],requestId:randomUUID(),traceId:randomUUID()};
  try{await repo.withContext(ctx,async tx=>{
    const other=await tx.query('SELECT * FROM purchase_results WHERE assessor_membership_id=$1',[d.managerMembershipId]);expect(other.rowCount).toBe(0);
    const aggregate=await tx.query('SELECT * FROM purchase_performance_cells');expect(aggregate.rowCount).toBeGreaterThan(0);expect(Object.keys(aggregate.rows[0]!)).not.toContain('id');
  });await repo.withContext({...ctx,organizationId:randomUUID()},async tx=>{expect((await tx.query('SELECT * FROM purchase_performance_cells')).rowCount).toBe(0);expect((await tx.query('SELECT * FROM purchase_results')).rowCount).toBe(0);});
  await repo.withContext({...ctx,membershipId:d.managerMembershipId,roles:['system_admin']},async tx=>{expect((await tx.query('SELECT * FROM purchase_performance_cells')).rowCount).toBe(0);});
  }finally{await repo.pool.end();}
 });
 it('日報は取引集計と旧手入力を別に返す',async()=>{
  const id=await create(3000);await action(id,'confirm',1);
  const day=await app.inject({method:'POST',url:'/api/v1/expense-days',headers:headers(),payload:{businessDate:'2026-09-01'}});expect(day.statusCode,day.body).toBe(200);
  const response=await app.inject({method:'GET',url:`/api/v1/expense-days/${day.json().id}`,headers:headers()});expect(response.statusCode,response.body).toBe(200);
  expect(response.json().purchaseLedger.confirmedAmount).toBe('3000');expect(response.json().day.purchaseTotal).toBeNull();
 });
 it('未設定の確定権限・フラグOFF・システム管理者を拒否',async()=>{
  const id=await create();await pool.query('UPDATE purchase_result_policies SET self_confirm_enabled=false WHERE organization_id=$1',[d.organizationId]);
  try{expect((await action(id,'confirm',1)).statusCode).toBe(403);}finally{await pool.query('UPDATE purchase_result_policies SET self_confirm_enabled=true WHERE organization_id=$1',[d.organizationId]);}
  const admin=await app.inject({method:'GET',url:'/api/v1/purchase-performance?date=2026-09-01',headers:headers('system_admin')});expect(admin.statusCode).toBe(403);
  await pool.query("UPDATE feature_flags SET enabled=false WHERE organization_id=$1 AND flag_key='purchase_performance'",[d.organizationId]);
  try{expect((await app.inject({method:'GET',url:'/api/v1/purchase-performance?date=2026-09-01',headers:headers()})).statusCode).toBe(404);}finally{await pool.query("UPDATE feature_flags SET enabled=true WHERE organization_id=$1 AND flag_key='purchase_performance'",[d.organizationId]);}
 });
 it('同一組織の別拠点を集計し、拠点絞込みと全員順位を分離する',async()=>{
  const branch=randomUUID();await pool.query('INSERT INTO branches(id,organization_id,branch_key,name) VALUES($1,$2,$3,$4)',[branch,d.organizationId,`synthetic-${branch}`,'合成・第二拠点']);
  await pool.query("INSERT INTO purchase_results(organization_id,branch_id,assessor_membership_id,business_date,purchase_amount,status) VALUES($1,$2,$3,'2026-09-02',750,'confirmed')",[d.organizationId,branch,d.managerMembershipId]);
  const all=await performance();expect(all.branches.some((r:{id:string})=>r.id===branch)).toBe(true);
  const only=await app.inject({method:'GET',url:`/api/v1/purchase-performance?date=2026-09-01&period=month&branchId=${branch}`,headers:headers()});expect(only.statusCode,only.body).toBe(200);expect(only.json().totalAmount).toBe('750');expect(only.json().assessors[0].name).toBe('鈴木 一郎');
 });
 it('105名全員の順位を省略せず返し、実績なしは最下位にしない',async()=>{
  const prefix=`合成ランキング専用-${randomUUID()}`;
  await pool.query(`WITH added AS (
   INSERT INTO users(provider_subject_hash,email_hash,email_masked,display_name)
   SELECT encode(digest($1||n::text,'sha256'),'hex'),encode(digest($1||n::text,'sha256'),'hex'),'s***@example.invalid',$1||lpad(n::text,3,'0') FROM generate_series(1,105) n RETURNING id
  ), members AS (
   INSERT INTO memberships(organization_id,user_id,branch_id,status) SELECT $2,id,$3,'active' FROM added RETURNING id
  ) INSERT INTO role_assignments(organization_id,membership_id,role_id,scope_type,scope_id)
    SELECT $2,m.id,r.id,'self',m.id FROM members m CROSS JOIN roles r WHERE r.role_code='assessor'`,[prefix,d.organizationId,d.branchId]);
  await pool.query(`INSERT INTO purchase_results(organization_id,branch_id,assessor_membership_id,business_date,purchase_amount,status)
   SELECT m.organization_id,m.branch_id,m.id,'2026-09-03',100+row_number() OVER(ORDER BY u.display_name),'confirmed' FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.organization_id=$1 AND u.display_name LIKE $2`,[d.organizationId,`${prefix}%`]);
  const response=await app.inject({method:'GET',url:'/api/v1/purchase-performance?date=2026-09-03&period=day',headers:headers()});expect(response.statusCode,response.body).toBe(200);
  const p=response.json();expect(p.assessors).toHaveLength(105);expect(p.assessors[104].rank).toBe(105);expect(p.totalAmount).toBe('16065');expect(p.branchRankings.find((r:{branchId:string})=>r.branchId===d.branchId).rows).toHaveLength(105);expect(p.noResultAssessors.some((r:{id:string})=>r.id===d.membershipId)).toBe(true);
 });
});
