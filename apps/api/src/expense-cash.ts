import {createHash} from 'node:crypto';
import type {RequestContext} from '@hanamaru/contracts';
import type {RepositoryTransaction} from '@hanamaru/database';
import type {BackendService} from './service.js';
import {camel} from './service.js';
import {ApiProblem,denied,invalid,notFound} from './errors.js';

type Input=Record<string,unknown>;
type BranchDay={id:string;branch_id:string;business_date:string;status:string;lock_version:string;expected_cash:string|null;actual_cash:string|null;reconciliation_version:string|null;reconciliation_input:Input|null};
type Authority={authority:'officer'|'delegate';can_close:boolean};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const text=(v:unknown,max=1000)=>{if(typeof v!=='string'||!v.trim()||v.length>max)throw invalid('入力内容を確認してください');return v.trim();};
const id=(v:unknown)=>{if(typeof v!=='string'||!uuid.test(v))throw invalid('対象を選択してください');return v;};
const money=(v:unknown)=>{if(typeof v!=='number'||!Number.isSafeInteger(v)||v<0||v>1_000_000_000)throw invalid('金額は0以上の整数で入力してください');return v;};
const date=(v:unknown)=>{const s=text(v,10);if(!/^\d{4}-\d{2}-\d{2}$/.test(s)||!Number.isFinite(Date.parse(s))||new Date(s).toISOString().slice(0,10)!==s)throw invalid('業務日を確認してください');return s;};
const time=(v:unknown)=>{const s=text(v,40);if(!/(Z|[+-]\d{2}:\d{2})$/.test(s)||!Number.isFinite(Date.parse(s))||Date.parse(s)>Date.now())throw invalid('実施日時は未来ではないタイムゾーン付き日時を指定してください');return s;};
const conflict=(message:string)=>new ApiProblem('VERSION_CONFLICT',409,message);
export const expenseCashActions=['roster','entry','ready','transfer','reverse-transfer','reconcile','close','correct','report','resolve'] as const;
type Action=typeof expenseCashActions[number];

// Shared by ordinary personal entry and branch closing: same lock order prevents
// a close snapshot from racing an expense edit or a roster change.
export async function expenseBranchLock(tx:RepositoryTransaction,org:string,branch:string,day:string){
 await tx.query('SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))',[`${org}:expense-branch:${branch}`,day]);
}
export async function expensePersonalMutation(tx:RepositoryTransaction,ctx:RequestContext,day:{id:string;branch_id:string;business_date:string}){
 await expenseBranchLock(tx,ctx.organizationId,day.branch_id,day.business_date);
 const closed=await tx.query<{status:string}>('SELECT status FROM expense_branch_days WHERE organization_id=$1 AND branch_id=$2 AND business_date=$3',[ctx.organizationId,day.branch_id,day.business_date]);
 if(closed.rows[0]&&closed.rows[0].status!=='open')throw denied('締め後の追加・訂正は役職者の訂正画面で行ってください');
 await tx.query('UPDATE expense_branch_participants SET ready_at=NULL,ready_by=NULL WHERE organization_id=$1 AND day_id=$2',[ctx.organizationId,day.id]);
 await tx.query('UPDATE expense_branch_days SET lock_version=lock_version+1,reconciliation_version=NULL WHERE organization_id=$1 AND branch_id=$2 AND business_date=$3',[ctx.organizationId,day.branch_id,day.business_date]);
}

export class ExpenseCashService {
 constructor(private service:BackendService){}
 private async enabled(tx:RepositoryTransaction,ctx:RequestContext){
  if(ctx.roles.includes('system_admin'))throw denied();
  const flag=await tx.query("SELECT 1 FROM feature_flags WHERE organization_id=$1 AND flag_key='expense_settlement' AND enabled AND (expires_at IS NULL OR expires_at>now())",[ctx.organizationId]);
  if(!flag.rowCount)throw new ApiProblem('FEATURE_DISABLED',404,'経費・精算は現在利用できません');
 }
 private async authority(tx:RepositoryTransaction,ctx:RequestContext,branch:string){
  await this.enabled(tx,ctx);
  const permission=await tx.query<Authority>(`SELECT p.authority,p.can_close FROM expense_cash_permissions p JOIN memberships m ON m.organization_id=p.organization_id AND m.id=p.membership_id WHERE p.organization_id=$1 AND p.branch_id=$2 AND p.membership_id=$3 AND m.status='active' AND p.valid_from<=now() AND (p.valid_until IS NULL OR p.valid_until>now())`,[ctx.organizationId,branch,ctx.membershipId]);
  if(!permission.rows[0])throw denied('この拠点の現金業務担当としての指定が必要です');
  return permission.rows[0];
 }
 private async get(tx:RepositoryTransaction,ctx:RequestContext,branchDayId:string,lock=false){
  const found=await tx.query<BranchDay>('SELECT *,business_date::text FROM expense_branch_days WHERE organization_id=$1 AND id=$2',[ctx.organizationId,id(branchDayId)]);
  const day=found.rows[0];if(!day)throw notFound();
  const permission=await this.authority(tx,ctx,day.branch_id);
  if(lock){await expenseBranchLock(tx,ctx.organizationId,day.branch_id,day.business_date);const latest=await tx.query<BranchDay>('SELECT *,business_date::text FROM expense_branch_days WHERE organization_id=$1 AND id=$2 FOR UPDATE',[ctx.organizationId,day.id]);return {day:latest.rows[0]!,permission};}
  return {day,permission};
 }
 private async event(tx:RepositoryTransaction,ctx:RequestContext,dayId:string,action:string,details:unknown){
  await tx.query('INSERT INTO expense_branch_events(organization_id,branch_day_id,action,actor_id,details) VALUES($1,$2,$3,$4,$5)',[ctx.organizationId,dayId,action,ctx.membershipId,details]);
 }
 private async members(tx:RepositoryTransaction,ctx:RequestContext,branch:string){
  return (await tx.query<{id:string;display_name:string}>(`SELECT m.id,u.display_name FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.organization_id=$1 AND m.branch_id=$2 AND m.status='active' ORDER BY m.id`,[ctx.organizationId,branch])).rows;
 }
 async options(ctx:RequestContext){return this.service.read(ctx,'expense.branch.options','expense_branch_day',async tx=>{
  await this.enabled(tx,ctx);
  const branches=await tx.query(`SELECT b.id,b.name,p.authority,p.can_close,c.reconciliation_mode,c.policy_reference,c.version AS policy_version FROM expense_cash_permissions p JOIN branches b ON b.organization_id=p.organization_id AND b.id=p.branch_id JOIN memberships m ON m.organization_id=p.organization_id AND m.id=p.membership_id LEFT JOIN expense_cash_policies c ON c.organization_id=p.organization_id AND c.branch_id=p.branch_id WHERE p.organization_id=$1 AND p.membership_id=$2 AND m.status='active' AND p.valid_from<=now() AND (p.valid_until IS NULL OR p.valid_until>now()) ORDER BY b.id`,[ctx.organizationId,ctx.membershipId]);
  return camel(branches.rows);
 });}
 async list(ctx:RequestContext,branch:string,businessDate:string){return this.service.read(ctx,'expense.branch.list','expense_branch_day',async tx=>{
  await this.authority(tx,ctx,id(branch));
  const days=await tx.query('SELECT id,business_date::text,status,lock_version::integer,review_required FROM expense_branch_days WHERE organization_id=$1 AND branch_id=$2 AND business_date=$3',[ctx.organizationId,branch,date(businessDate)]);
  const pending=await tx.query(`SELECT i.id,i.branch_day_id,i.kind,i.amount,i.note,i.assignee_id,d.business_date::text FROM expense_branch_issues i JOIN expense_branch_days d ON d.organization_id=i.organization_id AND d.id=i.branch_day_id WHERE i.organization_id=$1 AND d.branch_id=$2 AND i.status='open' ORDER BY d.business_date,i.id`,[ctx.organizationId,branch]);
  return {days:camel(days.rows),members:camel(await this.members(tx,ctx,branch)),pending:camel(pending.rows)};
 });}
 async read(ctx:RequestContext,branchDayId:string){return this.service.read(ctx,'expense.branch.read','expense_branch_day',async tx=>{
  const {day,permission}=await this.get(tx,ctx,branchDayId);
  const participants=await tx.query(`SELECT d.id,d.owner_membership_id,u.display_name,d.opening_wallet_cash,d.purchase_total,d.purchase_source_note,p.ready_at,
    (SELECT COALESCE(sum(i.amount),0)::text FROM expense_items i WHERE i.organization_id=d.organization_id AND i.day_id=d.id AND i.status='confirmed' AND i.payment_source='company_wallet') AS company_expense,
    (SELECT COALESCE(sum(i.amount),0)::text FROM expense_items i WHERE i.organization_id=d.organization_id AND i.day_id=d.id AND i.status='confirmed' AND i.payment_source='personal') AS personal_expense,
    (SELECT count(*)::int FROM expense_items i WHERE i.organization_id=d.organization_id AND i.day_id=d.id AND i.status='candidate') AS candidate_count
    FROM expense_branch_participants p JOIN expense_days d ON d.organization_id=p.organization_id AND d.id=p.day_id JOIN memberships m ON m.organization_id=d.organization_id AND m.id=d.owner_membership_id JOIN users u ON u.id=m.user_id WHERE p.organization_id=$1 AND p.branch_day_id=$2 ORDER BY d.id`,[ctx.organizationId,day.id]);
  const items=await tx.query(`SELECT i.id,i.day_id,i.merchant,i.category,i.amount,i.payment_source,i.status,i.note,i.lock_version::integer FROM expense_items i JOIN expense_branch_participants p ON p.organization_id=i.organization_id AND p.day_id=i.day_id WHERE p.organization_id=$1 AND p.branch_day_id=$2 ORDER BY i.created_at,i.id`,[ctx.organizationId,day.id]);
  const transfers=await tx.query('SELECT id,day_id,amount,performed_by,occurred_at,reverses_id,unreplenished_id FROM expense_cash_transfers WHERE organization_id=$1 AND branch_day_id=$2 ORDER BY created_at,id',[ctx.organizationId,day.id]);
  const outstanding=await tx.query(`SELECT f.id,f.day_id,f.amount,f.status,f.reason,
   (SELECT COALESCE(sum(CASE WHEN t.reverses_id IS NULL THEN t.amount ELSE -t.amount END),0)::text FROM expense_cash_transfers t WHERE t.organization_id=f.organization_id AND t.unreplenished_id=f.id) AS replenished_amount
   FROM expense_followups f JOIN expense_days origin ON origin.organization_id=f.organization_id AND origin.id=f.day_id
   WHERE f.organization_id=$1 AND f.kind='unreplenished' AND origin.branch_id=$3 AND origin.business_date<=$4
   AND origin.owner_membership_id IN (SELECT d.owner_membership_id FROM expense_branch_participants p JOIN expense_days d ON d.organization_id=p.organization_id AND d.id=p.day_id WHERE p.organization_id=$1 AND p.branch_day_id=$2)
   ORDER BY origin.business_date,f.id`,[ctx.organizationId,day.id,day.branch_id,day.business_date]);
  const issues=await tx.query('SELECT id,kind,status,amount,note,assignee_id,resolution_note FROM expense_branch_issues WHERE organization_id=$1 AND branch_day_id=$2 ORDER BY created_at,id',[ctx.organizationId,day.id]);
  const closure=await tx.query('SELECT expected_cash,actual_cash,difference,closed_at,snapshot_hash FROM expense_branch_closures WHERE organization_id=$1 AND branch_day_id=$2',[ctx.organizationId,day.id]);
  const report=await tx.query("SELECT details->>'reportedAt' AS reported_at,created_at FROM expense_branch_events WHERE organization_id=$1 AND branch_day_id=$2 AND action='report' ORDER BY created_at DESC,id DESC LIMIT 1",[ctx.organizationId,day.id]);
  return {day:camel({...day,lock_version:Number(day.lock_version)}),permission:camel(permission),participants:camel(participants.rows),items:camel(items.rows),transfers:camel(transfers.rows),unreplenished:camel(outstanding.rows),issues:camel(issues.rows),closure:camel(closure.rows[0]??null),report:camel(report.rows[0]??null)};
 });}
 async logs(ctx:RequestContext,branchDayId:string){return this.service.read(ctx,'expense.branch.logs.read','expense_branch_day',async tx=>{
  const {day,permission}=await this.get(tx,ctx,branchDayId);if(permission.authority!=='officer')throw denied('記録ログは役職者のみ閲覧できます');
  const events=await tx.query('SELECT action,actor_id,details,created_at FROM expense_branch_events WHERE organization_id=$1 AND (branch_day_id=$2 OR day_id IN (SELECT day_id FROM expense_branch_participants WHERE organization_id=$1 AND branch_day_id=$2)) ORDER BY created_at,id',[ctx.organizationId,day.id]);
  const snapshot=await tx.query("SELECT '締め時点の明細' AS action,closed_by AS actor_id,snapshot AS details,closed_at AS created_at FROM expense_branch_closures WHERE organization_id=$1 AND branch_day_id=$2",[ctx.organizationId,day.id]);
  return camel([...events.rows,...snapshot.rows]);
 });}
 async create(ctx:RequestContext,key:string|undefined,b:Input){
  const branch=id(b.branchId),businessDate=date(b.businessDate),note=text(b.rosterNote);
  await this.service.read(ctx,'expense.branch.create.check','expense_branch_day',tx=>this.authority(tx,ctx,branch));
  return this.service.write(ctx,'expense.branch.create',key,b,'expense.branch.created','expense_branch_day',async tx=>{
   await this.authority(tx,ctx,branch);await expenseBranchLock(tx,ctx.organizationId,branch,businessDate);
   const existing=await tx.query('SELECT id FROM expense_branch_days WHERE organization_id=$1 AND branch_id=$2 AND business_date=$3',[ctx.organizationId,branch,businessDate]);
   if(existing.rowCount)throw conflict('この拠点・業務日の取りまとめは作成済みです。日付から開いてください');
   const result=await tx.query<{id:string}>('INSERT INTO expense_branch_days(organization_id,branch_id,business_date,roster_note) VALUES($1,$2,$3,$4) RETURNING id',[ctx.organizationId,branch,businessDate,note]);
   const dayId=result.rows[0]!.id;await this.roster(tx,ctx,{id:dayId,branch_id:branch,business_date:businessDate},b.memberIds);
   await tx.query("UPDATE expense_branch_days SET review_required=EXISTS(SELECT 1 FROM expense_branch_issues i JOIN expense_branch_days d ON d.organization_id=i.organization_id AND d.id=i.branch_day_id WHERE i.organization_id=$1 AND d.branch_id=$2 AND d.business_date<=$3 AND i.kind='post_close_correction' AND i.status='open') WHERE organization_id=$1 AND id=$4",[ctx.organizationId,branch,businessDate,dayId]);
   await this.event(tx,ctx,dayId,'create',{rosterNote:note,memberIds:b.memberIds});
   return {status:201,body:{id:dayId},resourceId:dayId};
  });
 }
 private async roster(tx:RepositoryTransaction,ctx:RequestContext,day:{id:string;branch_id:string;business_date:string},value:unknown){
  if(!Array.isArray(value)||!value.length||value.length>200||new Set(value).size!==value.length)throw invalid('当日の対象者を1名以上選択してください');
  const members=await this.members(tx,ctx,day.branch_id);for(const member of value)if(!members.some(m=>m.id===id(member)))throw denied('対象者はこの拠点の有効な所属者を指定してください');
  const existing=await tx.query<{day_id:string;owner_membership_id:string}>(`SELECT p.day_id,d.owner_membership_id FROM expense_branch_participants p JOIN expense_days d ON d.organization_id=p.organization_id AND d.id=p.day_id WHERE p.organization_id=$1 AND p.branch_day_id=$2`,[ctx.organizationId,day.id]);
  for(const participant of existing.rows){if(!value.includes(participant.owner_membership_id)){
   const used=await tx.query('SELECT 1 FROM expense_cash_transfers WHERE organization_id=$1 AND branch_day_id=$2 AND day_id=$3',[ctx.organizationId,day.id,participant.day_id]);
   const financial=await tx.query("SELECT 1 FROM expense_items WHERE organization_id=$1 AND day_id=$2 AND status<>'excluded' UNION ALL SELECT 1 FROM expense_days WHERE organization_id=$1 AND id=$2 AND purchase_total>0",[ctx.organizationId,participant.day_id]);
   if(used.rowCount||financial.rowCount)throw invalid('支出・買取・補充記録のある対象者は一覧から外せません');
   await tx.query('DELETE FROM expense_branch_participants WHERE organization_id=$1 AND branch_day_id=$2 AND day_id=$3',[ctx.organizationId,day.id,participant.day_id]);
  }}
  for(const member of value){const d=await tx.query<{id:string;branch_id:string}>(`INSERT INTO expense_days(organization_id,branch_id,owner_membership_id,business_date,created_by_membership_id) VALUES($1,$2,$3,$4,$5) ON CONFLICT(organization_id,owner_membership_id,business_date) DO UPDATE SET business_date=EXCLUDED.business_date RETURNING id,branch_id`,[ctx.organizationId,day.branch_id,member,day.business_date,ctx.membershipId]);
   if(d.rows[0]!.branch_id!==day.branch_id)throw denied('別の拠点の日次には関連付けできません');
   await tx.query('INSERT INTO expense_branch_participants(organization_id,branch_day_id,day_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[ctx.organizationId,day.id,d.rows[0]!.id]);
  }
 }
 async result(ctx:RequestContext,key:string,operation:string){return this.service.read(ctx,'expense.branch.result','expense_branch_day',async tx=>{
  await this.enabled(tx,ctx);id(key);
  if(operation!=='create'&&!expenseCashActions.includes(operation as Action))throw invalid('操作種別を確認してください');
  const found=await tx.query<{resource_id:string}>('SELECT resource_id FROM idempotency_records WHERE organization_id=$1 AND membership_id=$2 AND endpoint_key=$3 AND idempotency_key=$4 AND expires_at>now()',[ctx.organizationId,ctx.membershipId,`expense.branch.${operation}`,key]);
  const target=found.rows[0]?.resource_id;if(!target)return {status:'unknown',resourceId:null};
  const {permission}=await this.get(tx,ctx,target);this.actionAuthority(permission,operation);
  return {status:'succeeded',resourceId:target};
 });}
 private actionAuthority(p:Authority,action:string){
  if(['correct','resolve','reverse-transfer'].includes(action)&&p.authority!=='officer')throw denied('この操作は役職者のみ実行できます');
  if(['close','reconcile'].includes(action)&&!p.can_close)throw denied('照合・締め権限が必要です');
 }
 async command(ctx:RequestContext,branchDayId:string,action:string,key:string|undefined,b:Input){
  if(!expenseCashActions.includes(action as Action))throw notFound();
  // Revalidate permission even for a cached idempotent replay.
  await this.service.read(ctx,'expense.branch.command.check','expense_branch_day',async tx=>{const {permission}=await this.get(tx,ctx,branchDayId);this.actionAuthority(permission,action);});
  return this.service.write(ctx,`expense.branch.${action}`,key,{...b,branchDayId},`expense.branch.${action}`,'expense_branch_day',async tx=>{
   const {day,permission}=await this.get(tx,ctx,branchDayId,true);this.actionAuthority(permission,action);
   if(money(b.expectedLockVersion)!==Number(day.lock_version))throw conflict('別の操作で更新されました。再読込して内容を確認してください');
   if(day.status!=='open'&&!['correct','report','resolve'].includes(action))throw denied('締め済みです。経費の変更は役職者の後日訂正から行ってください');
   let details:unknown=b;
   if(action==='roster'){await this.roster(tx,ctx,day,b.memberIds);await tx.query('UPDATE expense_branch_days SET roster_note=$3 WHERE organization_id=$1 AND id=$2',[ctx.organizationId,day.id,text(b.rosterNote)]);}
   if(action==='entry'||action==='ready'||action==='correct')details=await this.entry(tx,ctx,day,action,b);
   if(action==='transfer'||action==='reverse-transfer')details=await this.transfer(tx,ctx,day,action,b);
   if(action==='reconcile')details=await this.reconcile(tx,ctx,day,b);
   if(action==='close')details=await this.close(tx,ctx,day,b);
   if(action==='report')details={reportedAt:time(b.reportedAt),note:text(b.note),externalDelivery:'self_recorded'};
   if(action==='resolve'){
    const issue=await tx.query<{kind:string}>('UPDATE expense_branch_issues SET status=\'resolved\',resolution_note=$4,resolved_by=$5,resolved_at=now() WHERE organization_id=$1 AND branch_day_id=$2 AND id=$3 AND status=\'open\' RETURNING kind',[ctx.organizationId,day.id,id(b.issueId),text(b.note),ctx.membershipId]);
    if(!issue.rowCount)throw conflict('対象の未解決事項は更新されています');
    if(issue.rows[0]!.kind!=='cash_difference')throw denied('訂正後の再承認・再報告の手順が未確定です');
   }
   await this.event(tx,ctx,day.id,action,details);
   const updated=await tx.query<{lock_version:string}>('UPDATE expense_branch_days SET lock_version=lock_version+1,reconciliation_version=CASE WHEN $3 THEN reconciliation_version ELSE NULL END WHERE organization_id=$1 AND id=$2 RETURNING lock_version',[ctx.organizationId,day.id,['reconcile','close','report','resolve'].includes(action)]);
   // Report/resolve do not change the inputs used for reconciliation.
   if(['report','resolve'].includes(action)&&day.reconciliation_version===day.lock_version)await tx.query('UPDATE expense_branch_days SET reconciliation_version=lock_version WHERE organization_id=$1 AND id=$2',[ctx.organizationId,day.id]);
   return {status:200,body:{id:day.id,lockVersion:Number(updated.rows[0]!.lock_version)},resourceId:day.id};
  });
 }
 private async participant(tx:RepositoryTransaction,ctx:RequestContext,day:BranchDay,dayId:unknown){
  const result=await tx.query<{id:string;owner_membership_id:string;opening_wallet_cash:string|null;purchase_total:string|null;purchase_source_note:string|null}>(`SELECT d.* FROM expense_days d JOIN expense_branch_participants p ON p.organization_id=d.organization_id AND p.day_id=d.id WHERE p.organization_id=$1 AND p.branch_day_id=$2 AND d.id=$3`,[ctx.organizationId,day.id,id(dayId)]);
  if(!result.rows[0])throw notFound();return result.rows[0];
 }
 private async entry(tx:RepositoryTransaction,ctx:RequestContext,day:BranchDay,action:string,b:Input){
  const participant=await this.participant(tx,ctx,day,b.dayId);
  if(action==='ready'){
   const candidates=await tx.query("SELECT 1 FROM expense_items WHERE organization_id=$1 AND day_id=$2 AND status='candidate' LIMIT 1",[ctx.organizationId,participant.id]);
   if(candidates.rowCount||participant.opening_wallet_cash===null||participant.purchase_total===null||!participant.purchase_source_note)throw invalid('開始財布額・買取金・参照元・未確認候補を確認してください');
   await tx.query('UPDATE expense_branch_participants SET ready_at=now(),ready_by=$4 WHERE organization_id=$1 AND branch_day_id=$2 AND day_id=$3',[ctx.organizationId,day.id,participant.id,ctx.membershipId]);return {dayId:participant.id};
  }
  if(action==='entry'&&b.entryType==='daily'){
   const opening=money(b.openingWalletCash),purchase=money(b.purchaseTotal),source=text(b.purchaseSourceNote);
   await tx.query('UPDATE expense_days SET opening_wallet_cash=$3,purchase_total=$4,purchase_source_note=$5,lock_version=lock_version+1 WHERE organization_id=$1 AND id=$2',[ctx.organizationId,participant.id,opening,purchase,source]);
   await tx.query('UPDATE expense_branch_participants SET ready_at=NULL,ready_by=NULL WHERE organization_id=$1 AND branch_day_id=$2 AND day_id=$3',[ctx.organizationId,day.id,participant.id]);
   return {dayId:participant.id,before:{opening:participant.opening_wallet_cash,purchase:participant.purchase_total,source:participant.purchase_source_note},after:{opening,purchase,source}};
  }
  if(b.humanConfirmed!==true)throw invalid('人が確認した内容だけを登録してください');
  const value=money(b.amount);if(value===0)throw invalid('経費は1円以上で入力してください');
  const merchant=text(b.merchant,200),category=text(b.category,40),note=b.note?text(b.note):null;
  if(!['company_wallet','personal'].includes(String(b.paymentSource)))throw invalid('支払元を確認してください');
  const reason=action==='correct'?text(b.reason):null;
  let before:unknown=null,itemId:string;
  if(action==='correct'&&b.itemId){
   const old=await tx.query(`SELECT id,merchant,category,amount,payment_source,note,lock_version FROM expense_items WHERE organization_id=$1 AND day_id=$2 AND id=$3 AND status='confirmed' FOR UPDATE`,[ctx.organizationId,participant.id,id(b.itemId)]);
   if(!old.rows[0])throw notFound();before=old.rows[0];
   if(Number(old.rows[0].lock_version)!==money(b.itemLockVersion))throw conflict('訂正対象の版が変わりました');itemId=id(b.itemId);
   await tx.query('UPDATE expense_items SET merchant=$4,category=$5,amount=$6,payment_source=$7,note=$8,lock_version=lock_version+1 WHERE organization_id=$1 AND day_id=$2 AND id=$3',[ctx.organizationId,participant.id,itemId,merchant,category,value,b.paymentSource,note]);
  }else{
   const inserted=await tx.query<{id:string}>(`INSERT INTO expense_items(organization_id,day_id,spent_by_membership_id,entered_by_membership_id,business_date,merchant,category,amount,payment_source,note,status,confirmed_by_membership_id,confirmed_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'confirmed',$4,now()) RETURNING id`,[ctx.organizationId,participant.id,participant.owner_membership_id,ctx.membershipId,day.business_date,merchant,category,value,b.paymentSource,note]);itemId=inserted.rows[0]!.id;
  }
  await tx.query('UPDATE expense_branch_participants SET ready_at=NULL,ready_by=NULL WHERE organization_id=$1 AND branch_day_id=$2 AND day_id=$3',[ctx.organizationId,day.id,participant.id]);
  if(action==='correct'&&day.status!=='open'){
   await tx.query("INSERT INTO expense_branch_issues(organization_id,branch_day_id,kind,note,assignee_id) VALUES($1,$2,'post_close_correction',$3,$4)",[ctx.organizationId,day.id,reason,ctx.membershipId]);
   await tx.query('UPDATE expense_branch_days SET review_required=true WHERE organization_id=$1 AND branch_id=$2 AND business_date>=$3',[ctx.organizationId,day.branch_id,day.business_date]);
  }
  return {dayId:participant.id,itemId,businessDate:day.business_date,reason,before,after:{merchant,category,amount:value,paymentSource:b.paymentSource,note},cashMovementCreated:false,reapproval:'not_determined'};
 }
 private async transfer(tx:RepositoryTransaction,ctx:RequestContext,day:BranchDay,action:string,b:Input){
  const participant=await this.participant(tx,ctx,day,b.dayId);
  const value=money(b.amount);if(!value)throw invalid('補充額は1円以上で入力してください');
  const occurred=time(b.occurredAt),performer=id(b.performedBy),reason=text(b.reason);
  const actor=await tx.query(`SELECT 1 FROM expense_cash_permissions p JOIN memberships m ON m.organization_id=p.organization_id AND m.id=p.membership_id WHERE p.organization_id=$1 AND p.branch_id=$2 AND p.membership_id=$3 AND p.valid_from<=$4::timestamptz AND (p.valid_until IS NULL OR p.valid_until>$4::timestamptz) AND m.status='active'`,[ctx.organizationId,day.branch_id,performer,occurred]);
  if(!actor.rowCount)throw denied('実施日時に現金取扱権限がある担当者を指定してください');
  if(new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Tokyo'}).format(new Date(occurred))!==day.business_date)throw invalid('補充実績は実際に補充した業務日に記録してください');
  let outstanding:string|null=b.unreplenishedId?id(b.unreplenishedId):null,reverses:string|null=null;
  if(action==='reverse-transfer'){
   reverses=id(b.transferId);const original=await tx.query<{amount:string;unreplenished_id:string|null}>('SELECT amount,unreplenished_id FROM expense_cash_transfers WHERE organization_id=$1 AND branch_day_id=$2 AND day_id=$3 AND id=$4 AND reverses_id IS NULL',[ctx.organizationId,day.id,participant.id,reverses]);
   if(!original.rows[0]||Number(original.rows[0].amount)!==value)throw invalid('取消対象と金額が一致しません');
   if((await tx.query('SELECT 1 FROM expense_cash_transfers WHERE organization_id=$1 AND reverses_id=$2',[ctx.organizationId,reverses])).rowCount)throw conflict('この補充は取消済みです');outstanding=original.rows[0].unreplenished_id;
  }
  if(outstanding){
   const f=await tx.query<{amount:string}>(`SELECT f.amount FROM expense_followups f JOIN expense_days d ON d.organization_id=f.organization_id AND d.id=f.day_id WHERE f.organization_id=$1 AND f.id=$2 AND f.kind='unreplenished' AND d.branch_id=$3 AND d.owner_membership_id=$4 AND d.business_date<=$5 FOR UPDATE OF f`,[ctx.organizationId,outstanding,day.branch_id,participant.owner_membership_id,day.business_date]);
   if(!f.rows[0])throw invalid('同じ財布の未補充記録を選択してください');
   const sum=await tx.query<{total:string}>('SELECT COALESCE(sum(CASE WHEN reverses_id IS NULL THEN amount ELSE -amount END),0)::text AS total FROM expense_cash_transfers WHERE organization_id=$1 AND unreplenished_id=$2',[ctx.organizationId,outstanding]);
   const next=Number(sum.rows[0]!.total)+(reverses?-value:value);if(next>Number(f.rows[0].amount)||next<0)throw invalid('未補充額を超える補充です。別の補充として記録してください');
   await tx.query("UPDATE expense_followups SET status=CASE WHEN $3 THEN 'resolved' ELSE 'open' END,resolved_at=CASE WHEN $3 THEN now() ELSE NULL END,lock_version=lock_version+1 WHERE organization_id=$1 AND id=$2",[ctx.organizationId,outstanding,next===Number(f.rows[0].amount)]);
  }
  const created=await tx.query<{id:string}>('INSERT INTO expense_cash_transfers(organization_id,branch_day_id,day_id,amount,performed_by,recorded_by,occurred_at,unreplenished_id,reverses_id,reason) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id',[ctx.organizationId,day.id,participant.id,value,performer,ctx.membershipId,occurred,outstanding,reverses,reason]);
  return {id:created.rows[0]!.id,dayId:participant.id,amount:value,performedBy:performer,occurredAt:occurred,unreplenishedId:outstanding,reversesId:reverses,reason,expenseEffect:0};
 }
 private async policy(tx:RepositoryTransaction,ctx:RequestContext,day:BranchDay){
  const found=await tx.query<{reconciliation_mode:string;policy_reference:string;version:number}>('SELECT * FROM expense_cash_policies WHERE organization_id=$1 AND branch_id=$2',[ctx.organizationId,day.branch_id]);
  if(!found.rows[0])throw denied('この拠点の照合方式が未設定です');return found.rows[0];
 }
 private async reconcile(tx:RepositoryTransaction,ctx:RequestContext,day:BranchDay,b:Input){
  const policy=await this.policy(tx,ctx,day),actual=money(b.actualCash),reference=text(b.reference);
  let expected:number,inputs:Input={};
  if(policy.reconciliation_mode==='external_reference'){expected=money(b.expectedCash);inputs={expectedCash:expected};}
  else {const opening=money(b.openingVault),inflow=money(b.externalInflow),outflow=money(b.externalOutflow);
   const sum=await tx.query<{total:string}>('SELECT COALESCE(sum(CASE WHEN reverses_id IS NULL THEN amount ELSE -amount END),0)::text AS total FROM expense_cash_transfers WHERE organization_id=$1 AND branch_day_id=$2',[ctx.organizationId,day.id]);
   expected=opening+inflow-outflow-Number(sum.rows[0]!.total);if(expected<0||!Number.isSafeInteger(expected))throw invalid('計算残高と資金記録を確認してください');inputs={openingVault:opening,externalInflow:inflow,externalOutflow:outflow,netReplenishment:Number(sum.rows[0]!.total)};
  }
  await tx.query('UPDATE expense_branch_days SET expected_cash=$3,actual_cash=$4,reconciliation_input=$5,reconciliation_version=lock_version+1 WHERE organization_id=$1 AND id=$2',[ctx.organizationId,day.id,expected,actual,{...inputs,reference,policy}]);
  return {expectedCash:expected,actualCash:actual,difference:actual-expected,reference,policy};
 }
 private async close(tx:RepositoryTransaction,ctx:RequestContext,day:BranchDay,b:Input){
  if(day.reconciliation_version!==day.lock_version||day.expected_cash===null||day.actual_cash===null)throw conflict('最新の入力内容で金庫を照合してください');
  const policy=await this.policy(tx,ctx,day);
  const old=day.reconciliation_input?.policy as {version?:number;reconciliation_mode?:string;policy_reference?:string}|undefined;
  if(old?.version!==policy.version||old?.reconciliation_mode!==policy.reconciliation_mode||old?.policy_reference!==policy.policy_reference)throw conflict('照合設定が変更されました。再照合してください');
  const participants=await tx.query('SELECT * FROM expense_branch_participants WHERE organization_id=$1 AND branch_day_id=$2',[ctx.organizationId,day.id]);
  if(!participants.rows.length||participants.rows.some(p=>!p.ready_at))throw invalid('当日の対象者全員の入力完了を確認してください');
  const difference=Number(day.actual_cash)-Number(day.expected_cash),note=difference?text(b.note):null;
  if(difference&&b.acknowledgeDifference!==true)throw invalid('差異を残して締めることを確認してください');
  const assignee=difference?id(b.assigneeId):ctx.membershipId;
  if(difference){await this.authority(tx,{...ctx,membershipId:assignee},day.branch_id);
   await tx.query("INSERT INTO expense_branch_issues(organization_id,branch_day_id,kind,amount,note,assignee_id) VALUES($1,$2,'cash_difference',$3,$4,$5)",[ctx.organizationId,day.id,difference,note,assignee]);}
  const records=await tx.query(`SELECT d.id,d.owner_membership_id,d.opening_wallet_cash,d.purchase_total,d.purchase_source_note,COALESCE((SELECT jsonb_agg(to_jsonb(i) ORDER BY i.id) FROM expense_items i WHERE i.organization_id=d.organization_id AND i.day_id=d.id),'[]'::jsonb) AS items FROM expense_days d JOIN expense_branch_participants p ON p.organization_id=d.organization_id AND p.day_id=d.id WHERE p.organization_id=$1 AND p.branch_day_id=$2 ORDER BY d.id`,[ctx.organizationId,day.id]);
  const transfers=await tx.query('SELECT * FROM expense_cash_transfers WHERE organization_id=$1 AND branch_day_id=$2 ORDER BY id',[ctx.organizationId,day.id]);
  const snapshot={records:records.rows,participants:participants.rows,transfers:transfers.rows,reconciliation:day.reconciliation_input,note,assigneeId:assignee};
  const hash=createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
  await tx.query('INSERT INTO expense_branch_closures(organization_id,branch_day_id,expected_cash,actual_cash,difference,snapshot,snapshot_hash,closed_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[ctx.organizationId,day.id,day.expected_cash,day.actual_cash,difference,snapshot,hash,ctx.membershipId]);
  await tx.query('UPDATE expense_branch_days SET status=$3,closed_at=now() WHERE organization_id=$1 AND id=$2',[ctx.organizationId,day.id,difference?'closed_difference':'closed_balanced']);
  return {difference,note,assigneeId:assignee,snapshotHash:hash};
 }
}
