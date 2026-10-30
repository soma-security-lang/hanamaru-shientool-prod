import {createHash,randomUUID} from "node:crypto";
import sharp from "sharp";
import type {RequestContext} from "@hanamaru/contracts";
import type {HanamaruRepository,RepositoryTransaction} from "@hanamaru/database";
import type {PlatformProviders,ExpenseReceiptReadInput} from "@hanamaru/platform";

type ReceiptJob={id:string;organization_id:string;entity_id:string;requested_by_membership_id:string};
type Image={id:string;original_storage_id:string;normalized_storage_id:string|null;object_name:string;object_generation:string;sha256:string;expires_at:Date};
async function activeReceipt(tx:RepositoryTransaction,job:ReceiptJob){
  const result=await tx.query<{id:string;expires_at:Date}>(`SELECT r.id,r.expires_at FROM expense_receipts r
    JOIN expense_receipt_batches b ON b.organization_id=r.organization_id AND b.id=r.batch_id
    JOIN expense_receipt_policies p ON p.organization_id=r.organization_id AND p.enabled
    JOIN feature_flags f ON f.organization_id=r.organization_id AND f.flag_key='expense_settlement' AND f.enabled AND (f.expires_at IS NULL OR f.expires_at>now())
    WHERE r.organization_id=$1 AND r.id=$2 AND r.job_id=$3 AND r.status='reading' AND r.expires_at>now()
      AND b.owner_membership_id=$4 AND expense_receipt_actor_active() FOR UPDATE OF r`,[job.organization_id,job.entity_id,job.id,job.requested_by_membership_id]);
  if(!result.rows[0])throw new Error("PROVIDER_PERMANENT: receipt is no longer authorized for reading");
  return result.rows[0];
}
export async function processExpenseReceipt(repository:HanamaruRepository,providers:PlatformProviders,ctx:RequestContext,job:ReceiptJob){
  const finished=await repository.withContext(ctx,tx=>tx.query("SELECT 1 FROM expense_receipts WHERE organization_id=$1 AND id=$2 AND job_id=$3 AND status IN ('review_required','registered','excluded') AND reading_json IS NOT NULL",[job.organization_id,job.entity_id,job.id]));
  if(finished.rowCount)return; // The result commit succeeded but the prior Job completion was lost.
  const images=await repository.withContext(ctx,async tx=>{
    const receipt=await activeReceipt(tx,job);
    const images=await tx.query<Image>(`SELECT i.id,i.original_storage_id,i.normalized_storage_id,o.object_name,o.object_generation::text,o.sha256
      FROM expense_receipt_images i JOIN storage_objects o ON o.organization_id=i.organization_id AND o.id=i.original_storage_id AND o.status='available'
      WHERE i.organization_id=$1 AND i.receipt_id=$2 AND i.completed_at IS NOT NULL ORDER BY i.created_at,i.id`,[job.organization_id,job.entity_id]);
    if(images.rows.length<1||images.rows.length>5)throw new Error("PROVIDER_PERMANENT: invalid receipt image group");
    return images.rows.map(image=>({...image,expires_at:receipt.expires_at}));
  });
  const input:ExpenseReceiptReadInput={images:[]};
  for(const image of images){
    await repository.withContext(ctx,tx=>activeReceipt(tx,job));
    const cached=image.normalized_storage_id?await repository.withContext(ctx,tx=>tx.query<{object_name:string;object_generation:string}>("SELECT object_name,object_generation::text FROM storage_objects WHERE organization_id=$1 AND id=$2 AND status='available' AND retention_until>now()",[job.organization_id,image.normalized_storage_id])):null;
    if(cached?.rows[0]){
      input.images.push({content:await readBounded(providers,cached.rows[0].object_name,cached.rows[0].object_generation,4*1024*1024),mimeType:"image/webp"});continue;
    }
    const original=await readBounded(providers,image.object_name,image.object_generation,10_485_760);
    if(createHash("sha256").update(original).digest("hex")!==image.sha256)throw new Error("PROVIDER_PERMANENT: receipt checksum mismatch");
    // Decoder validates the image; rotation is applied, metadata/EXIF is deliberately not copied.
    const decoder=sharp(original,{failOn:"warning",limitInputPixels:40_000_000});
    const metadata=await decoder.metadata();
    if(!["jpeg","png","webp"].includes(metadata.format??"")||(metadata.pages??1)>1)throw new Error("PROVIDER_PERMANENT: unsupported receipt image");
    const normalized=await decoder.rotate().resize({width:2048,height:2048,fit:"inside",withoutEnlargement:true}).webp({quality:90}).toBuffer();
    if(normalized.length>4*1024*1024)throw new Error("PROVIDER_PERMANENT: normalized receipt exceeds limit");
    const stored=await providers.storage.put({organizationId:job.organization_id,objectName:`organizations/${job.organization_id}/expense-receipts/${job.entity_id}/${image.id}/${randomUUID()}.webp`,mimeType:"image/webp",body:normalized});
    try{
      await repository.withContext(ctx,async tx=>{
        await activeReceipt(tx,job);const storageId=randomUUID();
        await tx.query("INSERT INTO storage_objects(id,organization_id,bucket_name,object_name,object_generation,purpose,status,mime_type,size_bytes,sha256,retention_until) VALUES($1,$2,$3,$4,$5,'expense_receipt_reading','available',$6,$7,$8,$9)",[storageId,job.organization_id,stored.bucket,stored.objectName,Number(stored.generation),stored.mimeType,stored.sizeBytes,stored.sha256,image.expires_at]);
        const result=await tx.query("UPDATE expense_receipt_images SET normalized_storage_id=$3 WHERE organization_id=$1 AND id=$2 AND normalized_storage_id IS NULL RETURNING id",[job.organization_id,image.id,storageId]);
        if(!result.rowCount)throw new Error("PROVIDER_PERMANENT: receipt normalization conflict");
      });
    }catch(error){
      // Delete only if rollback is proven. Ambiguous commits keep the object for retention cleanup.
      const referenced=await repository.withContext(ctx,tx=>tx.query("SELECT 1 FROM storage_objects WHERE organization_id=$1 AND object_name=$2 AND object_generation=$3",[job.organization_id,stored.objectName,Number(stored.generation)]));
      if(!referenced.rowCount)await providers.storage.delete(stored.objectName,stored.generation);
      throw error;
    }
    input.images.push({content:normalized,mimeType:"image/webp"});
  }
  const reading=await providers.ai.readExpenseReceipt(input);
  await repository.withContext(ctx,async tx=>{
    await activeReceipt(tx,job);
    await tx.query("UPDATE expense_receipts SET status='review_required',reading_json=$3,failure_class=NULL,lock_version=lock_version+1 WHERE organization_id=$1 AND id=$2",[job.organization_id,job.entity_id,reading]);
    await tx.audit("expense.receipt.reading_completed","expense_receipt",job.entity_id,"allowed",{imageCount:images.length,reviewRequired:true});
  });
}
async function readBounded(providers:PlatformProviders,name:string,generation:string,max:number){
  const stream=await providers.storage.openRead(name,generation);const chunks:Buffer[]=[];let bytes=0;
  for await(const part of stream){const chunk=Buffer.from(part);bytes+=chunk.length;if(bytes>max){stream.destroy();throw new Error("PROVIDER_PERMANENT: receipt exceeds byte limit");}chunks.push(chunk);}
  return Buffer.concat(chunks);
}

/** Deletes only receipt content with an explicit, elapsed policy deadline; accounting entries survive. */
export async function purgeExpiredExpenseReceipts(repository:HanamaruRepository,providers:PlatformProviders,ctx:RequestContext){
  const receipts=await repository.withContext(ctx,async tx=>{
    const rows=await tx.query<{id:string}>("SELECT id FROM expense_receipts WHERE organization_id=$1 AND expires_at<now() AND NOT legal_hold AND status<>'deleted' ORDER BY expires_at,id FOR UPDATE SKIP LOCKED LIMIT 100",[ctx.organizationId]);
    for(const receipt of rows.rows)await tx.query("UPDATE expense_receipts SET status='deleting',lock_version=lock_version+1 WHERE organization_id=$1 AND id=$2",[ctx.organizationId,receipt.id]);
    return rows.rows;
  });
  let count=0;
  for(const receipt of receipts){
    const images=await repository.withContext(ctx,tx=>tx.query<{id:string;object_name:string;original_storage_id:string|null;normalized_storage_id:string|null}>("SELECT id,object_name,original_storage_id,normalized_storage_id FROM expense_receipt_images WHERE organization_id=$1 AND receipt_id=$2 ORDER BY id",[ctx.organizationId,receipt.id]));
    for(const image of images.rows){
      const ids=[image.original_storage_id,image.normalized_storage_id].filter((id):id is string=>id!==null);
      const objects=await repository.withContext(ctx,tx=>tx.query<{id:string;object_name:string;object_generation:string}>("SELECT id,object_name,object_generation::text FROM storage_objects WHERE organization_id=$1 AND id=ANY($2::uuid[]) AND status<>'deleted'",[ctx.organizationId,ids]));
      for(const object of objects.rows){
        await providers.storage.delete(object.object_name,object.object_generation);
        await repository.withContext(ctx,tx=>tx.query("UPDATE storage_objects SET status='deleted',deleted_at=now(),updated_at=now() WHERE organization_id=$1 AND id=$2",[ctx.organizationId,object.id]));
      }
      if(!image.original_storage_id)await providers.storage.deleteIncompleteUpload(image.object_name);
    }
    await repository.withContext(ctx,async tx=>{
      await tx.query("UPDATE expense_receipts SET status='deleted',deleted_at=now(),reading_json=NULL,review_json=NULL,excluded_reason=NULL,lock_version=lock_version+1 WHERE organization_id=$1 AND id=$2 AND status='deleting' AND NOT legal_hold",[ctx.organizationId,receipt.id]);
      await tx.audit("expense.receipt.content_deleted","expense_receipt",receipt.id,"allowed",{accountingEntryPreserved:true});
    });
    count++;
  }
  return count;
}
