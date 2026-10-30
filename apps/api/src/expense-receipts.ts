import {createHash,randomUUID} from "node:crypto";
import type {RequestContext} from "@hanamaru/contracts";
import type {RepositoryTransaction} from "@hanamaru/database";
import {validateExpenseReceiptInput} from "@hanamaru/platform";
import {ApiProblem,denied,invalid,notFound} from "./errors.js";
import {expenseBranchLock,expensePersonalMutation} from "./expense-cash.js";
import {camel,type BackendService} from "./service.js";

type Input=Record<string,unknown>;
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const version=(value:unknown)=>{if(typeof value!=="number"||!Number.isSafeInteger(value)||value<1)throw invalid("版番号を確認してください");return value;};
const keys=(body:Input,allowed:string[])=>{if(Object.keys(body).some(key=>!allowed.includes(key)))throw invalid("許可されていない入力項目があります");};
type Day={id:string;branch_id:string;owner_membership_id:string;business_date:string};
type Receipt={id:string;batch_id:string;status:string;lock_version:string;expires_at:Date;day_id:string};

export class ExpenseReceiptsService {
  constructor(private readonly service:BackendService){}
  private async policy(tx:RepositoryTransaction,ctx:RequestContext,collect=false){
    if(ctx.roles.includes("system_admin"))throw denied();
    const flag=await tx.query("SELECT enabled FROM feature_flags WHERE organization_id=$1 AND flag_key='expense_settlement' AND (expires_at IS NULL OR expires_at>now())",[ctx.organizationId]);
    if(flag.rows[0]?.enabled!==true)throw notFound();
    const policy=await tx.query<{enabled:boolean;retention_days:number}>("SELECT enabled,retention_days FROM expense_receipt_policies WHERE organization_id=$1",[ctx.organizationId]);
    if(collect&&(!policy.rows[0]?.enabled||!policy.rows[0]?.retention_days))throw new ApiProblem("RECEIPT_POLICY_REQUIRED",409,"領収書の保存・AI読取方針の承認待ちです。手入力は利用できます");
    return policy.rows[0];
  }
  private async day(tx:RepositoryTransaction,ctx:RequestContext,id:string,write=false){
    if(!uuid.test(id))throw notFound();
    const result=await tx.query<Day>("SELECT id,branch_id,owner_membership_id,business_date::text FROM expense_days WHERE organization_id=$1 AND id=$2",[ctx.organizationId,id]);
    const day=result.rows[0];if(!day)throw notFound();
    const own=day.owner_membership_id===ctx.membershipId&&(ctx.authorizationScopes??[]).some(s=>s.scopeType==="self"&&s.scopeId===ctx.membershipId&&s.capabilities.includes("visit:self"));
    const manager=(ctx.authorizationScopes??[]).some(s=>s.capabilities.includes("visit:scope")&&((s.scopeType==="branch"&&s.scopeId===day.branch_id)||(s.scopeType==="organization"&&s.scopeId===ctx.organizationId)));
    if(!own&&!manager)throw notFound();
    if(write){
      if(!own)throw denied();
      await expenseBranchLock(tx,ctx.organizationId,day.branch_id,day.business_date);
      const closed=await tx.query("SELECT 1 FROM expense_branch_days WHERE organization_id=$1 AND branch_id=$2 AND business_date=$3 AND status<>'open'",[ctx.organizationId,day.branch_id,day.business_date]);
      if(closed.rowCount)throw denied("締め後の追加・訂正は役職者へ依頼してください");
    }
    return day;
  }
  private async receipt(tx:RepositoryTransaction,ctx:RequestContext,id:string,write=false){
    if(!uuid.test(id))throw notFound();
    const sql="SELECT r.id,r.batch_id,r.status,r.lock_version,r.expires_at,b.day_id FROM expense_receipts r JOIN expense_receipt_batches b ON b.organization_id=r.organization_id AND b.id=r.batch_id WHERE r.organization_id=$1 AND r.id=$2";
    const result=await tx.query<Receipt>(sql,[ctx.organizationId,id]);
    const receipt=result.rows[0];if(!receipt)throw notFound();
    const day=await this.day(tx,ctx,receipt.day_id,write);
    // Match the branch-closing lock order before acquiring a receipt row lock.
    const current=write?(await tx.query<Receipt>(sql+" FOR UPDATE OF r",[ctx.organizationId,id])).rows[0]:receipt;
    if(!current)throw notFound();return{receipt:current,day};
  }
  async options(ctx:RequestContext){
    return this.service.read(ctx,"expense.receipt.options","expense_receipt",async tx=>{
      const policy=await this.policy(tx,ctx);
      return {enabled:policy?.enabled===true,retentionDays:policy?.retention_days??null,limits:{imageCount:20,imageBytes:10_485_760,totalImageBytes:104_857_600,imagesPerReceipt:5},mimeTypes:["image/jpeg","image/png","image/webp"],heicSupported:false,ocrRequiresConfirmation:true};
    });
  }
  async operationResult(ctx:RequestContext,key:string,operation:string){
    const allowed=["expense.receipt.batch.create","expense.receipt.image.create","expense.receipt.image.complete","expense.receipt.image.renew","expense.receipt.analyze","expense.receipt.review","expense.receipt.register","expense.receipt.exclude"];
    if(!uuid.test(key)||!allowed.includes(operation))throw invalid("操作を確認してください");
    return this.service.read(ctx,"expense.receipt.operation.read","expense_receipt",async tx=>{
      await this.policy(tx,ctx);
      const saved=await tx.query<{resource_id:string}>("SELECT resource_id FROM idempotency_records WHERE organization_id=$1 AND membership_id=$2 AND endpoint_key=$3 AND idempotency_key=$4 AND expires_at>now() AND response_status BETWEEN 200 AND 299",[ctx.organizationId,ctx.membershipId,operation,key]);
      const resourceId=saved.rows[0]?.resource_id;if(!resourceId)return{status:"unknown",resourceId:null};
      let dayId:string|undefined;
      if(operation==="expense.receipt.batch.create")dayId=(await tx.query<{day_id:string}>("SELECT day_id FROM expense_receipt_batches WHERE organization_id=$1 AND id=$2",[ctx.organizationId,resourceId])).rows[0]?.day_id;
      else if(operation.startsWith("expense.receipt.image."))dayId=(await tx.query<{day_id:string}>("SELECT b.day_id FROM expense_receipt_images i JOIN expense_receipts r ON r.organization_id=i.organization_id AND r.id=i.receipt_id JOIN expense_receipt_batches b ON b.organization_id=r.organization_id AND b.id=r.batch_id WHERE i.organization_id=$1 AND i.id=$2",[ctx.organizationId,resourceId])).rows[0]?.day_id;
      else dayId=(await tx.query<{day_id:string}>("SELECT b.day_id FROM expense_receipts r JOIN expense_receipt_batches b ON b.organization_id=r.organization_id AND b.id=r.batch_id WHERE r.organization_id=$1 AND r.id=$2",[ctx.organizationId,resourceId])).rows[0]?.day_id;
      if(!dayId)throw notFound();await this.day(tx,ctx,dayId);
      return{status:"succeeded",operation,resourceId,dayId};
    });
  }
  async list(ctx:RequestContext,dayId:string){
    return this.service.read(ctx,"expense.receipt.list","expense_receipt",async tx=>{
      await this.policy(tx,ctx);await this.day(tx,ctx,dayId);
      const receipts=await tx.query("SELECT r.id,r.batch_id,r.status,r.reading_json,r.review_json,r.failure_class,r.registered_item_id,r.lock_version::int,r.expires_at,r.created_at FROM expense_receipts r JOIN expense_receipt_batches b ON b.organization_id=r.organization_id AND b.id=r.batch_id WHERE b.organization_id=$1 AND b.day_id=$2 ORDER BY r.created_at,r.id",[ctx.organizationId,dayId]);
      const images=await tx.query("SELECT i.id,i.receipt_id,i.declared_mime_type AS mime_type,i.declared_size_bytes AS size_bytes,i.completed_at,i.content_sha256 FROM expense_receipt_images i JOIN expense_receipts r ON r.organization_id=i.organization_id AND r.id=i.receipt_id JOIN expense_receipt_batches b ON b.organization_id=r.organization_id AND b.id=r.batch_id WHERE b.organization_id=$1 AND b.day_id=$2 ORDER BY i.created_at,i.id",[ctx.organizationId,dayId]);
      return{receipts:camel(receipts.rows),images:camel(images.rows)};
    });
  }
  async createBatch(ctx:RequestContext,dayId:string,key:string|undefined,b:Input){
    keys(b,[]);
    return this.service.write(ctx,"expense.receipt.batch.create",key,{dayId,...b},"expense.receipt.batch.created","expense_receipt_batch",async tx=>{
      await this.policy(tx,ctx,true);await this.day(tx,ctx,dayId,true);
      const id=randomUUID();await tx.query("INSERT INTO expense_receipt_batches(id,organization_id,day_id,owner_membership_id) VALUES($1,$2,$3,$4)",[id,ctx.organizationId,dayId,ctx.membershipId]);
      return{status:201,body:{id,dayId},resourceId:id};
    },async tx=>{await this.policy(tx,ctx,true);await this.day(tx,ctx,dayId,true);});
  }
  async addImage(ctx:RequestContext,batchId:string,key:string|undefined,b:Input){
    keys(b,["mimeType","sizeBytes","sha256","receiptId"]);
    if(!uuid.test(batchId))throw notFound();
    const mime=b.mimeType,size=b.sizeBytes,digest=b.sha256;
    if(!["image/jpeg","image/png","image/webp"].includes(String(mime)))throw invalid("JPEG・PNG・WebPを選択してください。HEICは端末でJPEGに変換してください");
    if(typeof size!=="number"||!Number.isSafeInteger(size)||size<12||size>10_485_760||typeof digest!=="string"||!/^[a-f0-9]{64}$/.test(digest))throw invalid("画像のサイズ・チェックサムを確認してください");
    const receiptId=b.receiptId===undefined?randomUUID():String(b.receiptId);
    if(!uuid.test(receiptId))throw invalid("領収書を確認してください");
    const authorize=async(tx:RepositoryTransaction)=>{
      const policy=await this.policy(tx,ctx,true);
      // The branch/day lock below serializes image limits and duplicates. The
      // append-only batch deliberately has no UPDATE grant; do not row-lock it.
      const batch=await tx.query<{day_id:string}>("SELECT day_id FROM expense_receipt_batches WHERE organization_id=$1 AND id=$2 AND owner_membership_id=$3",[ctx.organizationId,batchId,ctx.membershipId]);
      if(!batch.rows[0])throw notFound();const day=await this.day(tx,ctx,batch.rows[0].day_id,true);return {policy:policy!,day};
    };
    return this.service.write(ctx,"expense.receipt.image.create",key,{batchId,...b},"expense.receipt.image.created","expense_receipt_image",async tx=>{
      const {policy,day}=await authorize(tx);
      const totals=await tx.query<{count:number;bytes:string}>("SELECT count(*)::int count,coalesce(sum(i.declared_size_bytes),0)::text bytes FROM expense_receipt_images i JOIN expense_receipts r ON r.organization_id=i.organization_id AND r.id=i.receipt_id WHERE r.organization_id=$1 AND r.batch_id=$2",[ctx.organizationId,batchId]);
      if(totals.rows[0]!.count>=20||Number(totals.rows[0]!.bytes)+size>104_857_600)throw invalid("1回20枚・合計100MBまでです");
      // Prisma binds JS integers as int8; make_interval requires int4 just as pg inference does.
      if(b.receiptId===undefined)await tx.query("INSERT INTO expense_receipts(id,organization_id,batch_id,expires_at) VALUES($1,$2,$3,now()+make_interval(days=>$4::int))",[receiptId,ctx.organizationId,batchId,policy.retention_days]);
      else{
        const existing=await tx.query("SELECT id FROM expense_receipts WHERE organization_id=$1 AND id=$2 AND batch_id=$3 AND status IN ('uploading','uploaded') AND expires_at>now() FOR UPDATE",[ctx.organizationId,receiptId,batchId]);
        if(!existing.rowCount)throw notFound();
        const images=await tx.query<{count:number}>("SELECT count(*)::int count FROM expense_receipt_images WHERE organization_id=$1 AND receipt_id=$2",[ctx.organizationId,receiptId]);
        if(images.rows[0]!.count>=5)throw invalid("1領収書につき5画像までです");
      }
      const duplicate=await tx.query("SELECT 1 FROM expense_receipt_images i JOIN expense_receipts r ON r.organization_id=i.organization_id AND r.id=i.receipt_id JOIN expense_receipt_batches b ON b.organization_id=r.organization_id AND b.id=r.batch_id WHERE i.organization_id=$1 AND b.day_id=$2 AND b.owner_membership_id=$3 AND i.content_sha256=$4 AND r.status NOT IN ('excluded','deleted')",[ctx.organizationId,day.id,ctx.membershipId,digest]);
      if(duplicate.rowCount)throw new ApiProblem("RECEIPT_DUPLICATE_IMAGE",409,"この業務日に同じ画像を取り込んでいます。保存済みの領収書を確認してください");
      await expensePersonalMutation(tx,ctx,day);
      const id=randomUUID(),objectName=`organizations/${ctx.organizationId}/expense-receipts/${receiptId}/${id}/original`;
      await tx.query("INSERT INTO expense_receipt_images(id,organization_id,receipt_id,object_name,declared_mime_type,declared_size_bytes,content_sha256,upload_expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,now()+interval '15 minutes')",[id,ctx.organizationId,receiptId,objectName,mime,size,digest]);
      await tx.query("UPDATE expense_receipts SET status='uploading',lock_version=lock_version+1 WHERE organization_id=$1 AND id=$2",[ctx.organizationId,receiptId]);
      return{status:201,body:{id,receiptId},resourceId:id};
    },async tx=>{await authorize(tx);});
  }
  async uploadAccess(ctx:RequestContext,imageId:string){
    if(!uuid.test(imageId))throw notFound();
    return this.service.read(ctx,"expense.receipt.upload_access","expense_receipt_image",async tx=>{
      await this.policy(tx,ctx,true);
      const result=await tx.query("SELECT * FROM expense_receipt_images WHERE organization_id=$1 AND id=$2 AND completed_at IS NULL AND upload_expires_at>now()",[ctx.organizationId,imageId]);
      const image=result.rows[0];if(!image)throw notFound();await this.receipt(tx,ctx,image.receipt_id,true);
      return this.service.providers.storage.createUpload({organizationId:ctx.organizationId,objectName:image.object_name,mimeType:image.declared_mime_type,sizeBytes:Number(image.declared_size_bytes),sha256:image.content_sha256,expiresAt:new Date(image.upload_expires_at)});
    });
  }
  async renewImage(ctx:RequestContext,imageId:string,key:string|undefined,b:Input){
    keys(b,[]);
    if(!uuid.test(imageId))throw notFound();
    const authorize=async(tx:RepositoryTransaction)=>{
      await this.policy(tx,ctx,true);const found=await tx.query<{receipt_id:string}>("SELECT receipt_id FROM expense_receipt_images WHERE organization_id=$1 AND id=$2 AND completed_at IS NULL",[ctx.organizationId,imageId]);
      if(!found.rows[0])throw notFound();const {receipt}=await this.receipt(tx,ctx,found.rows[0].receipt_id,true);
      if(receipt.expires_at<=new Date()||!["uploading","uploaded"].includes(receipt.status))throw denied();return receipt;
    };
    return this.service.write(ctx,"expense.receipt.image.renew",key,{imageId,...b},"expense.receipt.upload_renewed","expense_receipt_image",async tx=>{
      await authorize(tx);await tx.query("UPDATE expense_receipt_images SET upload_expires_at=now()+interval '15 minutes' WHERE organization_id=$1 AND id=$2 AND completed_at IS NULL",[ctx.organizationId,imageId]);
      return{status:200,body:{id:imageId},resourceId:imageId};
    },async tx=>{await authorize(tx);});
  }
  async completeImage(ctx:RequestContext,imageId:string,key:string|undefined,b:Input){
    keys(b,[]);
    if(!uuid.test(imageId))throw notFound();
    const image=await this.service.repository.withContext(ctx,async tx=>{
      await this.policy(tx,ctx,true);const result=await tx.query("SELECT * FROM expense_receipt_images WHERE organization_id=$1 AND id=$2",[ctx.organizationId,imageId]);
      const image=result.rows[0];if(!image)throw notFound();await this.receipt(tx,ctx,image.receipt_id,true);return image;
    });
    // A retried completed request must not require the expired upload or repeat storage effects.
    if(image.completed_at)return this.service.write(ctx,"expense.receipt.image.complete",key,{imageId,...b},"expense.receipt.image.completed","expense_receipt_image",async()=>{throw new ApiProblem("VERSION_CONFLICT",409,"画像は取込済みです。再読込してください");},async tx=>{await this.policy(tx,ctx);await this.receipt(tx,ctx,image.receipt_id,true);});
    const stored=await this.service.providers.storage.verify({organizationId:ctx.organizationId,objectName:image.object_name,mimeType:image.declared_mime_type,sizeBytes:Number(image.declared_size_bytes),sha256:image.content_sha256,expiresAt:new Date(image.upload_expires_at)});
    const stream=await this.service.providers.storage.openRead(stored.objectName,stored.generation);
    const chunks:Buffer[]=[];let size=0;
    for await(const part of stream){const chunk=Buffer.from(part);size+=chunk.length;if(size>10_485_760){stream.destroy();throw invalid("画像のサイズを確認してください");}chunks.push(chunk);}
    try{validateExpenseReceiptInput({images:[{content:Buffer.concat(chunks),mimeType:image.declared_mime_type}]});}
    catch{throw new ApiProblem("FILE_TYPE_INVALID",422,"画像の形式と内容が一致しません。再撮影してください");}
    return this.service.write(ctx,"expense.receipt.image.complete",key,{imageId,...b},"expense.receipt.image.completed","expense_receipt_image",async tx=>{
      await this.policy(tx,ctx,true);const {receipt}=await this.receipt(tx,ctx,image.receipt_id,true);
      if(!["uploading","uploaded"].includes(receipt.status)||receipt.expires_at<=new Date())throw denied();
      const current=await tx.query("SELECT 1 FROM expense_receipt_images WHERE organization_id=$1 AND id=$2 AND completed_at IS NULL AND upload_expires_at>now() FOR UPDATE",[ctx.organizationId,imageId]);if(!current.rowCount)throw new ApiProblem("VERSION_CONFLICT",409,"画像の状態が変わりました");
      const storageId=randomUUID();await tx.query("INSERT INTO storage_objects(id,organization_id,bucket_name,object_name,object_generation,purpose,status,mime_type,size_bytes,sha256,retention_until) VALUES($1,$2,$3,$4,$5,'expense_receipt_original','available',$6,$7,$8,$9)",[storageId,ctx.organizationId,stored.bucket,stored.objectName,Number(stored.generation),stored.mimeType,stored.sizeBytes,stored.sha256,receipt.expires_at]);
      await tx.query("UPDATE expense_receipt_images SET original_storage_id=$3,completed_at=now() WHERE organization_id=$1 AND id=$2",[ctx.organizationId,imageId,storageId]);
      await tx.query("UPDATE expense_receipts SET status=CASE WHEN EXISTS(SELECT 1 FROM expense_receipt_images WHERE organization_id=$1 AND receipt_id=$2 AND completed_at IS NULL) THEN 'uploading' ELSE 'uploaded' END,lock_version=lock_version+1 WHERE organization_id=$1 AND id=$2",[ctx.organizationId,receipt.id]);
      return{status:200,body:{id:imageId,receiptId:receipt.id,uploaded:true},resourceId:imageId};
    },async tx=>{await this.policy(tx,ctx);await this.receipt(tx,ctx,image.receipt_id,true);});
  }
  async analyze(ctx:RequestContext,id:string,key:string|undefined,b:Input){
    keys(b,["expectedLockVersion","aiConsent"]);
    const expected=version(b.expectedLockVersion);
    if(b.aiConsent!==true)throw invalid("Google CloudのAIで領収書を読み取ることを確認してください");
    return this.service.write(ctx,"expense.receipt.analyze",key,{id,...b},"expense.receipt.reading_requested","expense_receipt",async tx=>{
      await this.policy(tx,ctx,true);const {receipt}=await this.receipt(tx,ctx,id,true);
      if(Number(receipt.lock_version)!==expected||!["uploaded","failed"].includes(receipt.status)||receipt.expires_at<=new Date())throw new ApiProblem("VERSION_CONFLICT",409,"領収書の状態が変わりました。再読込してください");
      const images=await tx.query("SELECT 1 FROM expense_receipt_images WHERE organization_id=$1 AND receipt_id=$2 AND completed_at IS NOT NULL",[ctx.organizationId,id]);if(!images.rowCount)throw invalid("画像を取り込んでください");
      const jobId=randomUUID(),jobInput={receiptId:id};
      await tx.query("INSERT INTO jobs(id,organization_id,job_type,entity_type,entity_id,idempotency_key,input_hash,input_redacted,max_attempts,requested_by_membership_id) VALUES($1,$2,'expense_receipt_reading','expense_receipt',$3,$4,$5,$6,2,$7)",[jobId,ctx.organizationId,id,key,createHash("sha256").update(JSON.stringify(jobInput)).digest("hex"),jobInput,ctx.membershipId]);
      await tx.query("UPDATE expense_receipts SET status='reading',job_id=$3,failure_class=NULL,lock_version=lock_version+1 WHERE organization_id=$1 AND id=$2",[ctx.organizationId,id,jobId]);
      await tx.query("INSERT INTO outbox_events(organization_id,event_type,aggregate_type,aggregate_id,payload_redacted,deduplication_key) VALUES($1,'job.dispatch','job',$2,$3,$4)",[ctx.organizationId,jobId,{job_id:jobId,job_type:"expense_receipt_reading"},`job:${jobId}`]);
      return{status:202,body:{id,jobId,status:"reading"},resourceId:id,auditMetadata:{aiConsent:true}};
    },async tx=>{await this.policy(tx,ctx,true);await this.receipt(tx,ctx,id,true);});
  }
  async imageFile(ctx:RequestContext,id:string){
    if(!uuid.test(id))throw notFound();
    return this.service.read(ctx,"expense.receipt.image.read","expense_receipt_image",async tx=>{
      await this.policy(tx,ctx);
      const result=await tx.query("SELECT i.receipt_id,o.object_name,o.object_generation::text,o.mime_type FROM expense_receipt_images i JOIN storage_objects o ON o.organization_id=i.organization_id AND o.id=i.original_storage_id AND o.status='available' JOIN expense_receipts r ON r.organization_id=i.organization_id AND r.id=i.receipt_id AND r.expires_at>now() AND r.status NOT IN ('deleting','deleted') WHERE i.organization_id=$1 AND i.id=$2",[ctx.organizationId,id]);
      const image=result.rows[0];if(!image)throw notFound();await this.receipt(tx,ctx,image.receipt_id);
      // The authenticated same-origin gateway deliberately rejects external
      // redirects. Stream the exact authorized generation instead of exposing
      // a signed URL or weakening that transport boundary for receipt images.
      const source=await this.service.providers.storage.openRead(image.object_name,image.object_generation);
      return {source,mimeType:image.mime_type};
    });
  }
  async exclude(ctx:RequestContext,id:string,key:string|undefined,b:Input){
    keys(b,["expectedLockVersion","reason"]);
    const expected=version(b.expectedLockVersion);
    if(typeof b.reason!=="string"||!b.reason.trim()||b.reason.length>500)throw invalid("登録対象外にする理由を500文字以内で入力してください");
    const reason=b.reason.trim();
    return this.service.write(ctx,"expense.receipt.exclude",key,{id,...b},"expense.receipt.excluded","expense_receipt",async tx=>{
      await this.policy(tx,ctx,true);const {receipt}=await this.receipt(tx,ctx,id,true);
      if(Number(receipt.lock_version)!==expected||!["uploading","uploaded","review_required","failed"].includes(receipt.status))throw new ApiProblem("VERSION_CONFLICT",409,"処理中または登録済みの領収書は除外できません");
      await tx.query("UPDATE expense_receipts SET status='excluded',excluded_reason=$3,lock_version=lock_version+1 WHERE organization_id=$1 AND id=$2",[ctx.organizationId,id,reason]);
      return{status:200,body:{id,status:"excluded"},resourceId:id};
    },async tx=>{await this.policy(tx,ctx,true);await this.receipt(tx,ctx,id,true);});
  }
  async saveReview(ctx:RequestContext,id:string,key:string|undefined,b:Input){
    keys(b,["expectedLockVersion","fields"]);
    const expected=version(b.expectedLockVersion),fields=reviewFields(b.fields,false);
    return this.service.write(ctx,"expense.receipt.review",key,{id,...b},"expense.receipt.review_saved","expense_receipt",async tx=>{
      await this.policy(tx,ctx,true);const {receipt}=await this.receipt(tx,ctx,id,true);
      if(Number(receipt.lock_version)!==expected||!["review_required","failed"].includes(receipt.status)||receipt.expires_at<=new Date())throw new ApiProblem("VERSION_CONFLICT",409,"領収書の状態が変わりました");
      await tx.query("UPDATE expense_receipts SET review_json=$3,lock_version=lock_version+1 WHERE organization_id=$1 AND id=$2",[ctx.organizationId,id,fields]);
      return{status:200,body:{id,lockVersion:expected+1},resourceId:id};
    },async tx=>{await this.policy(tx,ctx,true);await this.receipt(tx,ctx,id,true);});
  }
  async register(ctx:RequestContext,id:string,key:string|undefined,b:Input){
    keys(b,["expectedLockVersion","fields","reviewed","duplicateAcknowledged"]);
    const expected=version(b.expectedLockVersion),fields=reviewFields(b.fields,true);
    if(b.reviewed!==true)throw invalid("画像と入力値を確認してから登録してください");
    return this.service.write(ctx,"expense.receipt.register",key,{id,...b},"expense.receipt.registered","expense_receipt",async tx=>{
      await this.policy(tx,ctx,true);const {receipt,day}=await this.receipt(tx,ctx,id,true);
      if(Number(receipt.lock_version)!==expected||!["review_required","failed"].includes(receipt.status)||receipt.expires_at<=new Date())throw new ApiProblem("VERSION_CONFLICT",409,"登録済み、または別の操作で更新されました");
      const multiple=await tx.query("SELECT 1 FROM expense_receipts WHERE organization_id=$1 AND id=$2 AND reading_json->>'documentKind'='multiple_receipts'",[ctx.organizationId,id]);
      if(multiple.rowCount)throw invalid("複数の領収書が写っています。1件ずつ再撮影してください");
      if(fields.paidOn!==day.business_date)throw invalid("支払日と対象業務日が異なります。正しい日次で登録してください");
      const ready=await tx.query("SELECT 1 FROM expense_receipt_images WHERE organization_id=$1 AND receipt_id=$2 AND original_storage_id IS NOT NULL AND completed_at IS NOT NULL",[ctx.organizationId,id]);
      if(!ready.rowCount)throw invalid("証憑が取り込まれていません");
      const similar=await tx.query("SELECT 1 FROM expense_items WHERE organization_id=$1 AND day_id=$2 AND merchant=$3 AND amount=$4 AND status<>'excluded' LIMIT 1",[ctx.organizationId,day.id,fields.merchant,fields.amount]);
      if(similar.rowCount&&b.duplicateAcknowledged!==true)throw new ApiProblem("RECEIPT_SIMILAR_EXPENSE",409,"同じ日付・支払先・金額の明細があります。別の支出か確認してください");
      await expensePersonalMutation(tx,ctx,day);
      const itemId=randomUUID();
      await tx.query("INSERT INTO expense_items(id,organization_id,day_id,spent_by_membership_id,entered_by_membership_id,business_date,merchant,category,amount,payment_source,status,entry_source,receipt_status,note,confirmed_by_membership_id,confirmed_at) VALUES($1,$2,$3,$4,$4,$5,$6,$7,$8,$9,'confirmed','receipt_ocr','attached_unapproved',$10,$4,now())",[itemId,ctx.organizationId,day.id,ctx.membershipId,day.business_date,fields.merchant,fields.category,fields.amount,fields.paymentSource,fields.note]);
      await tx.query("UPDATE expense_receipts SET status='registered',review_json=$3,registered_item_id=$4,lock_version=lock_version+1 WHERE organization_id=$1 AND id=$2",[ctx.organizationId,id,fields,itemId]);
      return{status:201,body:{id,itemId,status:"registered",receiptStatus:"attached_unapproved"},resourceId:id,auditMetadata:{duplicateAcknowledged:b.duplicateAcknowledged===true}};
    },async tx=>{await this.policy(tx,ctx,true);await this.receipt(tx,ctx,id,true);});
  }
}

function reviewFields(input:unknown,complete:boolean){
  if(!input||typeof input!=="object"||Array.isArray(input))throw invalid("確認内容を入力してください");
  const b=input as Input;
  if(Object.keys(b).some(key=>!["paidOn","merchant","amount","currency","category","paymentSource","note"].includes(key)))throw invalid("確認項目を確認してください");
  const text=(key:string,max:number)=>{const value=b[key];if(value===null||value===undefined||value==="")return null;if(typeof value!=="string"||value.length>max)throw invalid("入力文字数を確認してください");return value.trim()||null;};
  const paidOn=text("paidOn",10),merchant=text("merchant",200),category=text("category",40),note=text("note",1000),currency=text("currency",3),paymentSource=text("paymentSource",20);
  if(paidOn&&(!/^\d{4}-\d{2}-\d{2}$/.test(paidOn)||!Number.isFinite(Date.parse(`${paidOn}T00:00:00Z`))||new Date(`${paidOn}T00:00:00Z`).toISOString().slice(0,10)!==paidOn))throw invalid("支払日を確認してください");
  const amount=b.amount===null||b.amount===undefined||b.amount===""?null:b.amount;
  if(amount!==null&&(typeof amount!=="number"||!Number.isSafeInteger(amount)||amount<1||amount>1_000_000_000))throw invalid("正の整数の円額を入力してください");
  if(currency!==null&&currency!=="JPY")throw invalid("初版の経費登録は日本円のみです。自動換算は行いません");
  if(paymentSource!==null&&!["company_wallet","personal"].includes(paymentSource))throw invalid("支払元を選択してください");
  if(complete&&(!paidOn||!merchant||!category||amount===null||currency!=="JPY"||!paymentSource))throw invalid("支払日・支払先・金額・通貨・費目・支払元を確認してください");
  return{paidOn,merchant,category,note,currency,paymentSource,amount};
}
