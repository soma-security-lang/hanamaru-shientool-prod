import {createHash,randomUUID} from "node:crypto";
import type {FastifyInstance} from "fastify";
import {afterAll,beforeAll,describe,expect,it} from "vitest";
import {createPool,developmentIds as ids,HanamaruRepository} from "@hanamaru/database";
import {createLocalProviders} from "@hanamaru/platform";
import {buildApp} from "./app.js";
import {loadConfig} from "./config.js";
const databaseUrl=process.env.DATABASE_URL;
const actor={"x-dev-role":"assessor"};
const key=()=>({...actor,"idempotency-key":randomUUID()});
// Synthetic one-pixel PNG, not a client's receipt. The AI provider is never called by this suite.
const png=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j8GQAAAAASUVORK5CYII=","base64");
describe.skipIf(!databaseUrl)("expense receipt API with isolated DB and synthetic bytes, mocked OCR checkpoint",()=>{
  let pool:ReturnType<typeof createPool>,app:FastifyInstance,dayId:string,batchId:string,receiptId:string,imageId:string;
  const businessDate="2001-01-09";
  beforeAll(async()=>{
    pool=createPool(databaseUrl);
    app=await buildApp({repository:new HanamaruRepository(pool),providers:createLocalProviders(),config:{...loadConfig({NODE_ENV:"test",ALLOW_DEV_AUTH:"true"}),port:0}});
    await pool.query("INSERT INTO expense_receipt_policies(organization_id,enabled) VALUES($1,false) ON CONFLICT(organization_id) DO UPDATE SET enabled=false",[ids.organizationId]);
    const day=await app.inject({method:"POST",url:"/api/v1/expense-days",headers:key(),payload:{businessDate}});expect(day.statusCode).toBe(200);dayId=day.json().id;
  });
  afterAll(async()=>{await pool.query("UPDATE expense_receipt_policies SET enabled=false WHERE organization_id=$1",[ids.organizationId]);await app.close();});
  it("requires explicit policy and does not grant manager/system-admin authority to write another person's receipts",async()=>{
    expect((await app.inject({url:"/api/v1/expense-receipt-options",headers:actor})).json().enabled).toBe(false);
    const denied=await app.inject({method:"POST",url:`/api/v1/expense-days/${dayId}/receipt-batches`,headers:key(),payload:{}});
    expect(denied.statusCode).toBe(409);expect(denied.json().error.code).toBe("RECEIPT_POLICY_REQUIRED");
    await pool.query("UPDATE expense_receipt_policies SET enabled=true,retention_days=1,approved_by_membership_id=$2,approved_at=now() WHERE organization_id=$1",[ids.organizationId,ids.managerMembershipId]);
    const batch=await app.inject({method:"POST",url:`/api/v1/expense-days/${dayId}/receipt-batches`,headers:key(),payload:{}});expect(batch.statusCode).toBe(201);batchId=batch.json().id;
    const manager=await app.inject({method:"POST",url:`/api/v1/expense-days/${dayId}/receipt-batches`,headers:{"x-dev-role":"manager","idempotency-key":randomUUID()},payload:{}});expect(manager.statusCode).toBe(403);
    expect((await app.inject({url:"/api/v1/expense-receipt-options",headers:{"x-dev-role":"system_admin"}})).statusCode).toBe(403);
  });
  it("uploads only declared bounded bytes, rejects duplicate image and keeps OCR candidates outside totals",async()=>{
    const declaration={mimeType:"image/png",sizeBytes:png.length,sha256:createHash("sha256").update(png).digest("hex")};
    const created=await app.inject({method:"POST",url:`/api/v1/expense-receipt-batches/${batchId}/images`,headers:key(),payload:declaration});expect(created.statusCode).toBe(201);imageId=created.json().id;receiptId=created.json().receiptId;
    const duplicate=await app.inject({method:"POST",url:`/api/v1/expense-receipt-batches/${batchId}/images`,headers:key(),payload:declaration});expect(duplicate.statusCode).toBe(409);
    const upload=(await app.inject({url:`/api/v1/expense-receipt-images/${imageId}/upload-access`,headers:actor})).json();
    expect((await app.inject({method:"PUT",url:upload.url,headers:{...actor,...upload.headers},payload:png})).statusCode).toBe(200);
    const headers=key(),complete=()=>app.inject({method:"POST",url:`/api/v1/expense-receipt-images/${imageId}/complete`,headers,payload:{}});
    expect((await complete()).statusCode).toBe(200);expect((await complete()).statusCode).toBe(200);
    const row=(await app.inject({url:`/api/v1/expense-days/${dayId}/receipts`,headers:actor})).json().receipts[0];
    const noConsent=await app.inject({method:"POST",url:`/api/v1/expense-receipts/${receiptId}/analyze`,headers:key(),payload:{expectedLockVersion:row.lockVersion}});expect(noConsent.statusCode).toBe(422);
    const analyzed=await app.inject({method:"POST",url:`/api/v1/expense-receipts/${receiptId}/analyze`,headers:key(),payload:{expectedLockVersion:row.lockVersion,aiConsent:true}});expect(analyzed.statusCode).toBe(202);
    const detail=(await app.inject({url:`/api/v1/expense-days/${dayId}`,headers:actor})).json();expect(detail.totals.companyWallet).toBe("0");expect(detail.items).toHaveLength(0);
    const outbox=await pool.query("SELECT payload_redacted FROM outbox_events WHERE organization_id=$1 AND aggregate_id=$2",[ids.organizationId,analyzed.json().jobId]);expect(outbox.rows[0].payload_redacted).toEqual({job_id:analyzed.json().jobId,job_type:"expense_receipt_reading"});
    // Emulate only the Worker result boundary; this is NOT a real OCR or Worker integration pass.
    await pool.query("UPDATE expense_receipts SET status='review_required',reading_json=$3,lock_version=lock_version+1 WHERE organization_id=$1 AND id=$2",[ids.organizationId,receiptId,{model:"explicit-test-mock",paidTotal:{value:"1000",evidence:"合成合計1000円"}}]);
  });
  it("registers human corrections exactly once; payment source and date are never inferred from OCR",async()=>{
    let row=(await app.inject({url:`/api/v1/expense-days/${dayId}/receipts`,headers:actor})).json().receipts[0];
    const fields={paidOn:businessDate,merchant:"合成駐車場",amount:1200,currency:"JPY",category:"駐車場",paymentSource:"personal",note:"合成の用途"};
    const saved=await app.inject({method:"PATCH",url:`/api/v1/expense-receipts/${receiptId}/review`,headers:key(),payload:{expectedLockVersion:row.lockVersion,fields}});expect(saved.statusCode).toBe(200);
    row=(await app.inject({url:`/api/v1/expense-days/${dayId}/receipts`,headers:actor})).json().receipts[0];expect(row.reviewJson).toEqual(fields);
    const headers=key(),payload={expectedLockVersion:row.lockVersion,fields,reviewed:true};
    const results=await Promise.all(Array.from({length:2},()=>app.inject({method:"POST",url:`/api/v1/expense-receipts/${receiptId}/register`,headers,payload})));
    expect(results.map(r=>r.statusCode)).toEqual([201,201]);expect(results[0]!.json().itemId).toBe(results[1]!.json().itemId);
    const detail=(await app.inject({url:`/api/v1/expense-days/${dayId}`,headers:actor})).json();expect(detail.items).toHaveLength(1);expect(detail.items[0]).toMatchObject({amount:"1200",paymentSource:"personal",entrySource:"receipt_ocr",receiptStatus:"attached_unapproved",note:"合成の用途"});expect(detail.totals).toMatchObject({companyWallet:"0",personal:"1200"});
    const audit=await pool.query("SELECT metadata_redacted FROM audit_events WHERE organization_id=$1 AND resource_id=$2",[ids.organizationId,receiptId]);expect(JSON.stringify(audit.rows)).not.toContain("合成駐車場");expect(JSON.stringify(audit.rows)).not.toContain("合成の用途");
    const operationPath=`/api/v1/expense-receipt-operations/${headers["idempotency-key"]}?operation=expense.receipt.register`;
    const result=(await app.inject({url:operationPath,headers:actor})).json();expect(result).toMatchObject({status:"succeeded",resourceId:receiptId,dayId});expect(result).not.toHaveProperty("fields");
    expect((await app.inject({url:operationPath,headers:{"x-dev-role":"manager"}})).json().status).toBe("unknown");
    expect((await app.inject({url:operationPath,headers:{"x-dev-role":"system_admin"}})).statusCode).toBe(403);
    await pool.query("UPDATE expense_receipt_policies SET enabled=false WHERE organization_id=$1",[ids.organizationId]);
    expect((await app.inject({method:"POST",url:`/api/v1/expense-receipts/${receiptId}/register`,headers,payload})).statusCode).toBe(409);
  });
  it("resumes an expired upload without changing its declaration and prevents pending receipts being marked input-complete",async()=>{
    await pool.query("UPDATE expense_receipt_policies SET enabled=true WHERE organization_id=$1",[ids.organizationId]);
    await pool.query("INSERT INTO expense_cash_permissions(organization_id,branch_id,membership_id,authority,can_close,valid_from) VALUES($1,$2,$3,'officer',false,now()) ON CONFLICT(organization_id,branch_id,membership_id) DO UPDATE SET authority='officer',can_close=false,valid_from=now(),valid_until=NULL",[ids.organizationId,ids.branchId,ids.managerMembershipId]);
    const manager={"x-dev-role":"manager"};
    const created=await app.inject({method:"POST",url:"/api/v1/expense-branch-days",headers:{...manager,"idempotency-key":randomUUID()},payload:{branchId:ids.branchId,businessDate,rosterNote:"合成の入力完了境界",memberIds:[ids.membershipId]}});expect(created.statusCode).toBe(201);const branchId=created.json().id;
    const day=(await app.inject({url:`/api/v1/expense-days/${dayId}`,headers:actor})).json().day;
    expect((await app.inject({method:"PATCH",url:`/api/v1/expense-days/${dayId}`,headers:key(),payload:{expectedLockVersion:day.lockVersion,openingWalletCash:0,purchaseTotal:0,purchaseSourceNote:"合成のゼロ件実績"}})).statusCode).toBe(200);
    const newBatch=(await app.inject({method:"POST",url:`/api/v1/expense-days/${dayId}/receipt-batches`,headers:key(),payload:{}})).json().id;
    const distinct=Buffer.concat([png,Buffer.from([0])]),digest=createHash("sha256").update(distinct).digest("hex");
    const added=await app.inject({method:"POST",url:`/api/v1/expense-receipt-batches/${newBatch}/images`,headers:key(),payload:{mimeType:"image/png",sizeBytes:distinct.length,sha256:digest}});expect(added.statusCode).toBe(201);const pendingImage=added.json().id,pendingReceipt=added.json().receiptId;
    await pool.query("UPDATE expense_receipt_images SET upload_expires_at=now()-interval '1 minute' WHERE id=$1",[pendingImage]);
    expect((await app.inject({url:`/api/v1/expense-receipt-images/${pendingImage}/upload-access`,headers:actor})).statusCode).toBe(404);
    expect((await app.inject({method:"POST",url:`/api/v1/expense-receipt-images/${pendingImage}/renew`,headers:key(),payload:{sha256:"b".repeat(64)}})).statusCode).toBe(422);
    expect((await app.inject({method:"POST",url:`/api/v1/expense-receipt-images/${pendingImage}/renew`,headers:key(),payload:{}})).statusCode).toBe(200);
    expect((await app.inject({url:`/api/v1/expense-receipt-images/${pendingImage}/upload-access`,headers:actor})).statusCode).toBe(200);
    expect((await pool.query("SELECT content_sha256 FROM expense_receipt_images WHERE id=$1",[pendingImage])).rows[0].content_sha256).toBe(digest);
    const markReady=async()=>{const current=(await app.inject({url:`/api/v1/expense-branch-days/${branchId}`,headers:manager})).json();return app.inject({method:"POST",url:`/api/v1/expense-branch-days/${branchId}/actions/ready`,headers:{...manager,"idempotency-key":randomUUID()},payload:{expectedLockVersion:current.day.lockVersion,dayId}});};
    const blocked=await markReady();expect(blocked.statusCode).toBe(422);expect(blocked.json().error.message).toContain("未確認の領収書");
    const receipt=(await app.inject({url:`/api/v1/expense-days/${dayId}/receipts`,headers:actor})).json().receipts.find((r:{id:string})=>r.id===pendingReceipt);
    expect((await app.inject({method:"POST",url:`/api/v1/expense-receipts/${pendingReceipt}/exclude`,headers:key(),payload:{expectedLockVersion:receipt.lockVersion,reason:"誤って選んだ合成画像"}})).statusCode).toBe(200);
    expect((await markReady()).statusCode).toBe(200);
    expect((await app.inject({url:`/api/v1/expense-days/${dayId}`,headers:actor})).json().items).toHaveLength(1);
  });
});
