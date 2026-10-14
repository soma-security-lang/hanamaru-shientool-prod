import {rankPurchaseAmounts,purchasePeriod,type RequestContext,type PurchasePerformanceDto} from '@hanamaru/contracts';
import {createHash} from 'node:crypto';
import type {RepositoryTransaction} from '@hanamaru/database';
import type {BackendService} from './service.js';
import {camel} from './service.js';
import {ApiProblem,denied,invalid,notFound} from './errors.js';
import {expenseBranchLock} from './expense-cash.js';
type Input=Record<string,unknown>;
type Result={id:string;branch_id:string;assessor_membership_id:string;business_date:string;purchase_amount:string;status:string;lock_version:number};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const date=(v:unknown)=>{if(typeof v!=='string')throw invalid('業務日を指定してください');try{purchasePeriod(v,'day');}catch{throw invalid('実在する業務日を指定してください');}return v;};
const money=(v:unknown)=>{if(typeof v!=='number'||!Number.isSafeInteger(v)||v<1||v>1_000_000_000)throw invalid('買取金額は1円以上の整数で指定してください');return v;};
export class PurchaseResultService {
 constructor(private readonly service:BackendService){}
 private async enabled(tx:RepositoryTransaction,ctx:RequestContext,flag='purchase_results'){
  if(ctx.roles.includes('system_admin')||!ctx.roles.some(r=>r==='assessor'||r==='manager'))throw denied();
  const member=await tx.query("SELECT 1 FROM memberships WHERE organization_id=$1 AND id=$2 AND status='active'",[ctx.organizationId,ctx.membershipId]);if(!member.rowCount)throw denied();
  const f=await tx.query("SELECT enabled FROM feature_flags WHERE organization_id=$1 AND flag_key=$2 AND (expires_at IS NULL OR expires_at>now())",[ctx.organizationId,flag]);if(f.rows[0]?.enabled!==true)throw new ApiProblem('FEATURE_DISABLED',404,'実績機能は現在利用できません');
 }
 private scope(ctx:RequestContext,r:Result){
  if(r.assessor_membership_id===ctx.membershipId)return;
  if(ctx.roles.includes('manager')&&(ctx.authorizationScopes??[]).some(s=>s.capabilities.includes('visit:scope')&&(s.scopeType==='organization'&&s.scopeId===ctx.organizationId||s.scopeType==='branch'&&s.scopeId===r.branch_id)))return;
  throw notFound();
 }
 private async row(tx:RepositoryTransaction,ctx:RequestContext,id:string,lock=false){
  if(!uuid.test(id))throw notFound();
  const q=await tx.query<Result>(`SELECT *,business_date::text,purchase_amount::text FROM purchase_results WHERE organization_id=$1 AND id=$2 ${lock?'FOR UPDATE':''}`,[ctx.organizationId,id]);const r=q.rows[0];if(!r)throw notFound();this.scope(ctx,r);return r;
 }
 async list(ctx:RequestContext){return this.service.read(ctx,'purchase.list','purchase_result',async tx=>{
  await this.enabled(tx,ctx);const q=await tx.query<Result>('SELECT p.*,p.business_date::text,p.purchase_amount::text FROM purchase_results p WHERE p.organization_id=$1 ORDER BY p.business_date DESC,p.created_at DESC LIMIT 100',[ctx.organizationId]);
  return {items:camel(q.rows.filter(r=>{try{this.scope(ctx,r);return true;}catch{return false;}}))};
 });}
 async get(ctx:RequestContext,id:string){return this.service.read(ctx,'purchase.read','purchase_result',async tx=>{await this.enabled(tx,ctx);const r=await this.row(tx,ctx,id);const revisions=await tx.query('SELECT version,action,reason,actor_id,created_at FROM purchase_result_revisions WHERE organization_id=$1 AND result_id=$2 ORDER BY version',[ctx.organizationId,id]);return {result:camel(r),revisions:camel(revisions.rows)};});}
 async create(ctx:RequestContext,key:string|undefined,b:Input){const businessDate=date(b.businessDate),amount=money(b.purchaseAmount);
  if(businessDate>new Date(Date.now()+9*60*60*1000).toISOString().slice(0,10))throw invalid('未来の業務日は登録できません');
  return this.service.write(ctx,'purchase.create',key,b,'purchase.created','purchase_result',async tx=>{
   await this.enabled(tx,ctx);if(!ctx.branchId)throw denied();await this.aggregateLock(tx,ctx);
   const r=await tx.query<Result>("INSERT INTO purchase_results(organization_id,branch_id,assessor_membership_id,business_date,purchase_amount) VALUES($1,$2,$3,$4,$5) RETURNING *,business_date::text,purchase_amount::text",[ctx.organizationId,ctx.branchId,ctx.membershipId,businessDate,amount]);const row=r.rows[0]!;
   await this.revision(tx,ctx,row,null,'draft',null);return {status:201,body:{id:row.id,lockVersion:row.lock_version},resourceId:row.id};
  },async tx=>{await this.enabled(tx,ctx);});
 }
 async change(ctx:RequestContext,id:string,action:string,key:string|undefined,b:Input){
  if(!['edit','confirm','correct','cancel'].includes(action))throw notFound();
  if(!Number.isSafeInteger(b.expectedLockVersion)||Number(b.expectedLockVersion)<1)throw invalid('版を確認してください');
  return this.service.write(ctx,`purchase.${action}`,key,{id,...b},`purchase.${action}`,'purchase_result',async tx=>{
   await this.enabled(tx,ctx);await this.aggregateLock(tx,ctx);
   // First acquire the shared branch/day lock, then the row lock: matches closing.
   const current=await this.row(tx,ctx,id);await expenseBranchLock(tx,ctx.organizationId,current.branch_id,current.business_date);
   const before=await this.row(tx,ctx,id,true);
   if(before.assessor_membership_id!==ctx.membershipId)throw denied('取引変更は本人のみです。代理操作の業務権限は未設定です');
   if(before.lock_version!==b.expectedLockVersion)throw new ApiProblem('VERSION_CONFLICT',409,'他の更新があります。再読み込みしてください');
   const closing=await tx.query("SELECT status FROM expense_branch_days WHERE organization_id=$1 AND branch_id=$2 AND business_date=$3",[ctx.organizationId,before.branch_id,before.business_date]);if(closing.rows[0]&&closing.rows[0].status!=='open')throw denied('締め済み業務日の取引訂正・取消は運用確認待ちです');
   const policy=await tx.query('SELECT self_confirm_enabled,changes_enabled FROM purchase_result_policies WHERE organization_id=$1',[ctx.organizationId]);
   if(action==='confirm'&&!policy.rows[0]?.self_confirm_enabled||['correct','cancel'].includes(action)&&!policy.rows[0]?.changes_enabled)throw denied('取引確定・訂正の運用設定が必要です');
   if(action==='edit'&&before.status!=='draft'||action==='confirm'&&before.status!=='draft'||['correct','cancel'].includes(action)&&before.status!=='confirmed')throw new ApiProblem('VERSION_CONFLICT',409,'現在の状態では実行できません');
   let reason:string|null=null;if(['correct','cancel'].includes(action)){if(typeof b.reason!=='string'||!b.reason.trim()||b.reason.length>1000)throw invalid('訂正・取消の理由を入力してください');reason=b.reason.trim();}
   const amount=['edit','correct'].includes(action)?money(b.purchaseAmount):Number(before.purchase_amount),status=action==='confirm'?'confirmed':action==='cancel'?'cancelled':before.status;
   const q=await tx.query<Result>('UPDATE purchase_results SET purchase_amount=$3,status=$4,lock_version=lock_version+1,updated_at=clock_timestamp() WHERE organization_id=$1 AND id=$2 RETURNING *,business_date::text,purchase_amount::text',[ctx.organizationId,id,amount,status]);const after=q.rows[0]!;await this.revision(tx,ctx,after,before,action,reason);
   if(action!=='edit'){
    await tx.query('UPDATE expense_branch_participants p SET ready_at=NULL,ready_by=NULL FROM expense_days d WHERE p.organization_id=$1 AND p.day_id=d.id AND d.organization_id=p.organization_id AND d.branch_id=$2 AND d.business_date=$3 AND d.owner_membership_id=$4',[ctx.organizationId,before.branch_id,before.business_date,before.assessor_membership_id]);
    await tx.query('UPDATE expense_branch_days SET lock_version=lock_version+1,reconciliation_version=NULL WHERE organization_id=$1 AND branch_id=$2 AND business_date=$3',[ctx.organizationId,before.branch_id,before.business_date]);
   }
   return {status:200,body:{id,lockVersion:after.lock_version},resourceId:id};
  },async tx=>{await this.enabled(tx,ctx);await this.row(tx,ctx,id);});
 }
 private async revision(tx:RepositoryTransaction,ctx:RequestContext,row:Result,before:Result|null,action:string,reason:string|null){await tx.query('INSERT INTO purchase_result_revisions(organization_id,result_id,version,action,before_json,after_json,reason,actor_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[ctx.organizationId,row.id,row.lock_version,action,before,row,reason,ctx.membershipId]);}
 private async aggregateLock(tx:RepositoryTransaction,ctx:RequestContext){await tx.query('SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))',[ctx.organizationId,'purchase.aggregate']);}
 async performance(ctx:RequestContext,b:Input):Promise<PurchasePerformanceDto>{
  const businessDate=date(b.date),period=b.period??'day';if(!['day','week','month'].includes(String(period)))throw invalid('期間を確認してください');const window=purchasePeriod(businessDate,period as 'day'|'week'|'month');
  const branch=b.branchId===undefined||b.branchId===''?null:String(b.branchId);if(branch&&!uuid.test(branch))throw invalid('拠点を確認してください');
  return this.service.read(ctx,'purchase.performance','purchase_performance',async tx=>{
   await this.enabled(tx,ctx,'purchase_performance');await this.aggregateLock(tx,ctx);
   const options=await tx.query<{id:string;name:string}>('SELECT id,name FROM branches WHERE organization_id=$1 ORDER BY name,id',[ctx.organizationId]);
   if(branch&&!options.rows.some(o=>o.id===branch))throw notFound('対象拠点が見つかりません');
   const cells=await tx.query<{branchId:string;branchName:string;businessDate:string;assessorId:string;assessorName:string;amount:string;count:number}>(`SELECT branch_id AS "branchId",branch_name AS "branchName",business_date::text AS "businessDate",assessor_membership_id AS "assessorId",assessor_name AS "assessorName",amount,transaction_count AS count FROM purchase_performance_cells WHERE organization_id=$1 AND business_date BETWEEN $2 AND $3 AND ($4::uuid IS NULL OR branch_id=$4) ORDER BY business_date,branch_id,assessor_membership_id`,[ctx.organizationId,window.startDate,window.endDate,branch]);
   const versions={version:createHash('sha256').update(JSON.stringify({window,branch,cells:cells.rows})).digest('hex'),as_of:new Date().toISOString()};
   const aggregate=(type:'branch'|'assessor')=>{const rows=new Map<string,{id:string;name:string;amount:string;count:number}>();for(const c of cells.rows){const id=type==='branch'?c.branchId:c.assessorId,name=type==='branch'?c.branchName:c.assessorName,prev=rows.get(id);rows.set(id,{id,name,amount:String(BigInt(prev?.amount??'0')+BigInt(c.amount)),count:(prev?.count??0)+c.count});}return rankPurchaseAmounts([...rows.values()]);};
   const series=new Map<string,{businessDate:string;amount:string;count:number}>();for(const c of cells.rows){const prev=series.get(c.businessDate);series.set(c.businessDate,{businessDate:c.businessDate,amount:String(BigInt(prev?.amount??'0')+BigInt(c.amount)),count:(prev?.count??0)+c.count});}
   const branches=aggregate('branch'),assessors=aggregate('assessor');
   const people=await tx.query<{id:string;name:string;branchId:string}>(`SELECT m.id,u.display_name AS name,m.branch_id AS "branchId" FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.organization_id=$1 AND m.status='active' AND ($2::uuid IS NULL OR m.branch_id=$2) AND EXISTS(SELECT 1 FROM role_assignments a JOIN roles r ON r.id=a.role_id WHERE a.organization_id=m.organization_id AND a.membership_id=m.id AND r.role_code IN ('assessor','manager') AND a.valid_from<=now() AND (a.valid_until IS NULL OR a.valid_until>now())) ORDER BY u.display_name,m.id`,[ctx.organizationId,branch]);
   const branchRankings=options.rows.filter(b=>!branch||b.id===branch).map(b=>{const members=new Map<string,{id:string;name:string;amount:string;count:number}>();for(const c of cells.rows.filter(c=>c.branchId===b.id)){const previous=members.get(c.assessorId);members.set(c.assessorId,{id:c.assessorId,name:c.assessorName,amount:String(BigInt(previous?.amount??'0')+BigInt(c.amount)),count:(previous?.count??0)+c.count});}return {branchId:b.id,branchName:b.name,rows:rankPurchaseAmounts([...members.values()]),unranked:people.rows.filter(p=>p.branchId===b.id&&!members.has(p.id)).map(({id,name})=>({id,name}))};});
   return {...window,asOf:versions.as_of,totalAmount:String(cells.rows.reduce((sum,c)=>sum+BigInt(c.amount),0n)),transactionCount:cells.rows.reduce((sum,c)=>sum+c.count,0),branches,assessors,branchOptions:options.rows,noResultBranches:options.rows.filter(o=>(!branch||o.id===branch)&&!branches.some(b=>b.id===o.id)),noResultAssessors:people.rows.filter(p=>!assessors.some(a=>a.id===p.id)),branchRankings,series:[...series.values()],cells:cells.rows.map(({branchId,branchName,businessDate,amount,count})=>({branchId,branchName,businessDate,amount,count})),coverage:'確定した取引台帳のみ。旧日報の手入力合計は含みません。確定実績なしは未入力・休み・取消などを区別できないため順位を付けません。',aggregationVersion:versions.version};
  });
 }
}
