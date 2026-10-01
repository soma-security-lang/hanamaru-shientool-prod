import type {RequestContext} from "@hanamaru/contracts";
import type {RepositoryTransaction} from "@hanamaru/database";
import {camel} from "./service.js";
import type {BackendService} from "./service.js";
import {ApiProblem,denied,invalid,notFound} from "./errors.js";

type Input=Record<string,unknown>;
const date=(value:unknown)=>{
  if(typeof value!=="string"||!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(`${value}T00:00:00Z`))||new Date(`${value}T00:00:00Z`).toISOString().slice(0,10)!==value)throw invalid("業務日を確認してください",[{field:"businessDate",message:"YYYY-MM-DD形式の実在する日付を入力してください"}]);
  return value;
};
const string=(value:unknown,name:string,max:number)=>{
  if(typeof value!=="string"||!value.trim()||value.length>max)throw invalid("入力内容を確認してください",[{field:name,message:`1〜${max}文字で入力してください`}]);
  return value.trim();
};
const amount=(value:unknown,name:string,allowZero=false)=>{
  if(typeof value!=="number"||!Number.isSafeInteger(value)||value<(allowZero?0:1)||value>1_000_000_000)throw invalid("金額を確認してください",[{field:name,message:"安全な整数の円額を入力してください"}]);
  return value;
};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class ExpenseService {
  constructor(private readonly service:BackendService){}
  private async enabled(tx:RepositoryTransaction,ctx:RequestContext){
    const result=await tx.query("SELECT enabled FROM feature_flags WHERE organization_id=$1 AND flag_key='expense_settlement' AND (expires_at IS NULL OR expires_at>now())",[ctx.organizationId]);
    if(result.rows[0]?.enabled!==true)throw new ApiProblem("FEATURE_DISABLED",404,"経費・精算は現在利用できません");
  }
  private access(ctx:RequestContext,day:{owner_membership_id:string;branch_id:string}){
    if(ctx.roles.includes("system_admin"))throw denied();
    const own=day.owner_membership_id===ctx.membershipId&&(ctx.authorizationScopes??[]).some(s=>s.scopeType==="self"&&s.scopeId===ctx.membershipId&&s.capabilities.includes("visit:self"));
    const manager=(ctx.authorizationScopes??[]).some(s=>s.capabilities.includes("visit:scope")&&((s.scopeType==="branch"&&s.scopeId===day.branch_id)||(s.scopeType==="organization"&&s.scopeId===ctx.organizationId)));
    if(!own&&!manager)throw notFound();
    return {own,manager};
  }
  private async day(tx:RepositoryTransaction,ctx:RequestContext,id:string){
    if(!uuid.test(id))throw notFound();
    const result=await tx.query<{id:string;owner_membership_id:string;branch_id:string;business_date:string;lock_version:string}>("SELECT id,owner_membership_id,branch_id,business_date::text,lock_version FROM expense_days WHERE organization_id=$1 AND id=$2",[ctx.organizationId,id]);
    const row=result.rows[0];if(!row)throw notFound();return {row,access:this.access(ctx,row)};
  }
  async list(ctx:RequestContext){
    return this.service.read(ctx,"expense.days.read","expense_day",async tx=>{
      await this.enabled(tx,ctx);
      if(ctx.roles.includes("system_admin"))throw denied();
      const scope=(ctx.authorizationScopes??[]).filter(s=>s.capabilities.includes("visit:scope"));
      const organization=scope.some(s=>s.scopeType==="organization"&&s.scopeId===ctx.organizationId);
      const branches=scope.filter(s=>s.scopeType==="branch"&&s.scopeId).map(s=>s.scopeId);
      const self=(ctx.authorizationScopes??[]).some(s=>s.scopeType==="self"&&s.scopeId===ctx.membershipId&&s.capabilities.includes("visit:self"));
      if(!organization&&!branches.length&&!self)throw denied();
      const rows=await tx.query("SELECT id,branch_id,owner_membership_id,business_date::text AS business_date,opening_wallet_cash,purchase_total,status,lock_version::integer AS lock_version,created_at,updated_at FROM expense_days WHERE organization_id=$1 AND ($2::boolean OR branch_id=ANY($3::uuid[]) OR ($4::boolean AND owner_membership_id=$5)) ORDER BY business_date DESC,id DESC LIMIT 100",[ctx.organizationId,organization,branches,self,ctx.membershipId]);
      return {items:camel(rows.rows)};
    });
  }
  async createDay(ctx:RequestContext,key:string|undefined,b:Input){
    const businessDate=date(b.businessDate);
    return this.service.write(ctx,"expense.day.create",key,b,"expense.day.created","expense_day",async tx=>{
      await this.enabled(tx,ctx);
      if(ctx.roles.includes("system_admin")||!(ctx.authorizationScopes??[]).some(s=>s.scopeType==="self"&&s.scopeId===ctx.membershipId&&s.capabilities.includes("visit:self")))throw denied();
      const result=await tx.query<{id:string}>("INSERT INTO expense_days(organization_id,branch_id,owner_membership_id,business_date,created_by_membership_id) VALUES($1,$2,$3,$4,$3) ON CONFLICT(organization_id,owner_membership_id,business_date) DO UPDATE SET business_date=EXCLUDED.business_date RETURNING id",[ctx.organizationId,ctx.branchId,ctx.membershipId,businessDate]);
      const id=result.rows[0]!.id;return {status:200,body:{id},resourceId:id};
    });
  }
  async getDay(ctx:RequestContext,id:string){
    return this.service.read(ctx,"expense.day.read","expense_day",async tx=>{
      await this.enabled(tx,ctx);await this.day(tx,ctx,id);
      const day=await tx.query("SELECT id,branch_id,owner_membership_id,business_date::text AS business_date,opening_wallet_cash,purchase_total,status,lock_version::integer AS lock_version,created_at,updated_at FROM expense_days WHERE organization_id=$1 AND id=$2",[ctx.organizationId,id]);
      const items=await tx.query("SELECT id,day_id,spent_by_membership_id,entered_by_membership_id,business_date::text AS business_date,merchant,category,amount,payment_source,status,entry_source,receipt_status,note,excluded_reason,excluded_at,lock_version::integer AS lock_version,confirmed_at,created_at FROM expense_items WHERE organization_id=$1 AND day_id=$2 ORDER BY created_at,id",[ctx.organizationId,id]);
      const followups=await tx.query("SELECT id,kind,status,amount,reason,target_item_id,proposed_before,proposed_after,recorded_by_membership_id,occurred_at,created_at FROM expense_followups WHERE organization_id=$1 AND day_id=$2 ORDER BY occurred_at,id",[ctx.organizationId,id]);
      const totals=await tx.query("SELECT COALESCE(SUM(amount) FILTER(WHERE status='confirmed' AND payment_source='company_wallet'),0)::bigint AS company_wallet,COALESCE(SUM(amount) FILTER(WHERE status='confirmed' AND payment_source='personal'),0)::bigint AS personal,COUNT(*) FILTER(WHERE status='candidate')::int AS candidate_count FROM expense_items WHERE organization_id=$1 AND day_id=$2",[ctx.organizationId,id]);
      return {day:camel(day.rows[0]),items:camel(items.rows),followups:camel(followups.rows),totals:camel(totals.rows[0]),nextAction:"明細と未完了事項を確認してください",cashReconciliation:"unavailable",closeEnabled:false};
    });
  }
  async updateDay(ctx:RequestContext,id:string,key:string|undefined,b:Input){
    const expected=amount(b.expectedLockVersion,"expectedLockVersion");
    const opening=b.openingWalletCash===null?null:b.openingWalletCash===undefined?undefined:amount(b.openingWalletCash,"openingWalletCash",true);
    const purchase=b.purchaseTotal===null?null:b.purchaseTotal===undefined?undefined:amount(b.purchaseTotal,"purchaseTotal",true);
    if(opening===undefined&&purchase===undefined)throw invalid("更新する項目がありません",[{field:"body",message:"開始残高または買取金額を指定してください"}]);
    return this.service.write(ctx,"expense.day.update",key,{id,...b},"expense.day.updated","expense_day",async tx=>{
      await this.enabled(tx,ctx);const day=await this.day(tx,ctx,id);if(!day.access.own)throw denied();
      const result=await tx.query<{lock_version:string}>("UPDATE expense_days SET opening_wallet_cash=CASE WHEN $3::boolean THEN $4::bigint ELSE opening_wallet_cash END,purchase_total=CASE WHEN $5::boolean THEN $6::bigint ELSE purchase_total END,lock_version=lock_version+1 WHERE organization_id=$1 AND id=$2 AND lock_version=$7 RETURNING lock_version",[ctx.organizationId,id,opening!==undefined,opening??null,purchase!==undefined,purchase??null,expected]);
      if(!result.rowCount)throw new ApiProblem("VERSION_CONFLICT",409,"別の操作で日次記録が更新されました");
      return {status:200,body:{id,lockVersion:Number(result.rows[0]!.lock_version)},resourceId:id};
    });
  }
  async addItem(ctx:RequestContext,id:string,key:string|undefined,b:Input){
    const merchant=string(b.merchant,"merchant",200),category=string(b.category,"category",40),value=amount(b.amount,"amount");
    const paymentSource=b.paymentSource;if(paymentSource!=="company_wallet"&&paymentSource!=="personal")throw invalid("支払元を確認してください",[{field:"paymentSource",message:"会社の財布または個人立替を選択してください"}]);
    const entrySource=b.entrySource??"manual";if(entrySource!=="manual"&&entrySource!=="synthetic_ocr")throw invalid("入力元を確認してください",[{field:"entrySource",message:"手入力または合成OCRのみ対応"}]);
    if(entrySource==="synthetic_ocr"&&process.env.NODE_ENV==="production")throw denied("合成OCRはローカル検証専用です");
    const note=b.note===undefined||b.note===null?null:string(b.note,"note",1000);
    return this.service.write(ctx,"expense.item.create",key,{id,...b},"expense.item.created","expense_item",async tx=>{
      await this.enabled(tx,ctx);const day=await this.day(tx,ctx,id);if(!day.access.own)throw denied();
      const result=await tx.query<{id:string}>("INSERT INTO expense_items(organization_id,day_id,spent_by_membership_id,entered_by_membership_id,business_date,merchant,category,amount,payment_source,entry_source,note) VALUES($1,$2,$3,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id",[ctx.organizationId,id,ctx.membershipId,day.row.business_date,merchant,category,value,paymentSource,entrySource,note]);
      const itemId=result.rows[0]!.id;return{status:201,body:{id:itemId,status:"candidate"},resourceId:itemId};
    });
  }
  async confirmItem(ctx:RequestContext,id:string,itemId:string,key:string|undefined,b:Input){
    const expected=amount(b.expectedLockVersion,"expectedLockVersion");
    return this.service.write(ctx,"expense.item.confirm",key,{id,itemId,...b},"expense.item.confirmed","expense_item",async tx=>{
      await this.enabled(tx,ctx);const day=await this.day(tx,ctx,id);if(!day.access.own||!uuid.test(itemId))throw notFound();
      const result=await tx.query("UPDATE expense_items SET status='confirmed',confirmed_by_membership_id=$4,confirmed_at=now(),lock_version=lock_version+1 WHERE organization_id=$1 AND day_id=$2 AND id=$3 AND lock_version=$5 AND status='candidate' RETURNING id",[ctx.organizationId,id,itemId,ctx.membershipId,expected]);
      if(!result.rowCount)throw new ApiProblem("VERSION_CONFLICT",409,"明細の状態が変わりました。再読込してください");
      return{status:200,body:{id:itemId,status:"confirmed",receiptStatus:"not_attached"},resourceId:itemId};
    });
  }
  async updateCandidate(ctx:RequestContext,id:string,itemId:string,key:string|undefined,b:Input){
    const expected=amount(b.expectedLockVersion,"expectedLockVersion");
    const merchant=string(b.merchant,"merchant",200),category=string(b.category,"category",40),value=amount(b.amount,"amount");
    const paymentSource=b.paymentSource;
    if(paymentSource!=="company_wallet"&&paymentSource!=="personal")throw invalid("支払元を確認してください",[{field:"paymentSource",message:"会社の財布または個人立替を選択してください"}]);
    const note=b.note===undefined||b.note===null?null:string(b.note,"note",1000);
    return this.service.write(ctx,"expense.item.update",key,{id,itemId,...b},"expense.item.updated","expense_item",async tx=>{
      await this.enabled(tx,ctx);const day=await this.day(tx,ctx,id);if(!day.access.own||!uuid.test(itemId))throw notFound();
      const result=await tx.query<{lock_version:string}>("UPDATE expense_items SET merchant=$4,category=$5,amount=$6,payment_source=$7,note=$8,lock_version=lock_version+1 WHERE organization_id=$1 AND day_id=$2 AND id=$3 AND lock_version=$9 AND status='candidate' RETURNING lock_version",[ctx.organizationId,id,itemId,merchant,category,value,paymentSource,note,expected]);
      if(!result.rowCount)throw new ApiProblem("VERSION_CONFLICT",409,"候補が変更されています。再読込してください");
      return{status:200,body:{id:itemId,status:"candidate",lockVersion:Number(result.rows[0]!.lock_version)},resourceId:itemId};
    });
  }
  async excludeCandidate(ctx:RequestContext,id:string,itemId:string,key:string|undefined,b:Input){
    const expected=amount(b.expectedLockVersion,"expectedLockVersion"),reason=string(b.reason,"reason",1000);
    return this.service.write(ctx,"expense.item.exclude",key,{id,itemId,...b},"expense.item.excluded","expense_item",async tx=>{
      await this.enabled(tx,ctx);const day=await this.day(tx,ctx,id);if(!day.access.own||!uuid.test(itemId))throw notFound();
      const result=await tx.query("UPDATE expense_items SET status='excluded',excluded_reason=$4,excluded_at=now(),lock_version=lock_version+1 WHERE organization_id=$1 AND day_id=$2 AND id=$3 AND lock_version=$5 AND status='candidate' RETURNING id",[ctx.organizationId,id,itemId,reason,expected]);
      if(!result.rowCount)throw new ApiProblem("VERSION_CONFLICT",409,"候補が変更されています。再読込してください");
      return{status:200,body:{id:itemId,status:"excluded"},resourceId:itemId};
    });
  }
  async addFollowup(ctx:RequestContext,id:string,key:string|undefined,b:Input){
    const kind=b.kind;
    if(!["funding_request","unreplenished","vault_discrepancy","report","correction_proposal"].includes(String(kind)))throw denied("この記録種別は業務条件の確定待ちです");
    const reason=string(b.reason,"reason",1000);
    const value=b.amount===undefined||b.amount===null?null:amount(b.amount,"amount",true);
    if((kind==="funding_request"||kind==="unreplenished"||kind==="vault_discrepancy")&&value===null)throw invalid("金額を入力してください",[{field:"amount",message:"金額が必要です"}]);
    if(kind==="report"&&value!==null)throw invalid("報告に金額は指定できません",[{field:"amount",message:"報告記録は現金残高に影響しません"}]);
    const target=b.targetItemId===undefined||b.targetItemId===null?null:String(b.targetItemId);
    if(target&&!uuid.test(target))throw invalid("対象明細を確認してください",[{field:"targetItemId",message:"有効な明細IDが必要です"}]);
    if(kind==="correction_proposal"&&!target)throw invalid("訂正対象を選択してください",[{field:"targetItemId",message:"対象明細が必要です"}]);
    const proposedAmount=kind==="correction_proposal"?amount(b.proposedAmount,"proposedAmount"):null;
    return this.service.write(ctx,"expense.followup.create",key,{id,...b},"expense.followup.created","expense_followup",async tx=>{
      await this.enabled(tx,ctx);const day=await this.day(tx,ctx,id);if(!day.access.own)throw denied();
      let before:null|{amount:string;lockVersion:string}=null;
      if(target){const found=await tx.query<{amount:string;lock_version:string}>("SELECT amount,lock_version FROM expense_items WHERE organization_id=$1 AND day_id=$2 AND id=$3",[ctx.organizationId,id,target]);if(!found.rowCount)throw notFound();before={amount:found.rows[0]!.amount,lockVersion:found.rows[0]!.lock_version};}
      const result=await tx.query<{id:string}>("INSERT INTO expense_followups(organization_id,day_id,kind,amount,reason,target_item_id,proposed_before,proposed_after,recorded_by_membership_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id",[ctx.organizationId,id,kind,value,reason,target,kind==="correction_proposal"?before:null,kind==="correction_proposal"?{amount:proposedAmount}:null,ctx.membershipId]);
      const followupId=result.rows[0]!.id;return{status:201,body:{id:followupId,kind,status:"open",effectOnBalance:"none",externalDelivery:"not_verified"},resourceId:followupId};
    });
  }
  async unavailable(ctx:RequestContext,id:string){
    return this.service.read(ctx,"expense.operation.denied","expense_day",async tx=>{await this.enabled(tx,ctx);await this.day(tx,ctx,id);throw denied("補充・金庫照合・締め・訂正適用は権限と計算条件の確定待ちです");});
  }
}
