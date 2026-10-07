import {randomUUID} from "node:crypto";
import type {FastifyInstance} from "fastify";
import {beforeAll,afterAll,describe,expect,it} from "vitest";
import {createPool,developmentIds,HanamaruRepository} from "@hanamaru/database";
import {createLocalProviders} from "@hanamaru/platform";
import {buildApp} from "./app.js";
import {loadConfig} from "./config.js";

const databaseUrl=process.env.DATABASE_URL;
const actor={"x-dev-role":"assessor"};
const key=()=>({...actor,"idempotency-key":randomUUID()});

describe.skipIf(!databaseUrl)("expense settlement confirmed local records",()=>{
  let app:FastifyInstance;
  beforeAll(async()=>{app=await buildApp({repository:new HanamaruRepository(createPool(databaseUrl)),providers:createLocalProviders(),config:{...loadConfig({NODE_ENV:"test",ALLOW_DEV_AUTH:"true"}),port:0}});});
  afterAll(async()=>{await app.close();});

  it("preserves the business date, excludes candidates, separates payment sources and keeps cash operations closed",async()=>{
    const businessDate="2026-09-23";
    const created=await app.inject({method:"POST",url:"/api/v1/expense-days",headers:key(),payload:{businessDate}});
    expect(created.statusCode).toBe(200);
    const dayId=created.json().id as string;
    const open=await app.inject({method:"GET",url:`/api/v1/expense-days/${dayId}`,headers:actor});
    expect(open.statusCode).toBe(200);
    expect(open.json().day.businessDate).toBe(businessDate);
    expect(open.json().day.openingWalletCash).toBeNull();
    expect(open.json().day.purchaseTotal).toBeNull();
    expect(open.json().day.purchaseSourceNote).toBeNull();
    const set=await app.inject({method:"PATCH",url:`/api/v1/expense-days/${dayId}`,headers:key(),payload:{expectedLockVersion:open.json().day.lockVersion,openingWalletCash:0,purchaseTotal:50000,purchaseSourceNote:"匿名の買取実績表・当日分"}});
    expect(set.statusCode).toBe(200);
    expect((await app.inject({method:"GET",url:`/api/v1/expense-days/${dayId}`,headers:actor})).json().day.purchaseSourceNote).toBe("匿名の買取実績表・当日分");
    const stale=await app.inject({method:"PATCH",url:`/api/v1/expense-days/${dayId}`,headers:key(),payload:{expectedLockVersion:open.json().day.lockVersion,purchaseTotal:1}});
    expect(stale.statusCode).toBe(409);
    const payload={merchant:"架空駐車場",category:"駐車場",amount:1200,paymentSource:"company_wallet",entrySource:"synthetic_ocr",note:"訪問先の駐車料金"};
    const sameKey=key();
    const item=await app.inject({method:"POST",url:`/api/v1/expense-days/${dayId}/items`,headers:sameKey,payload});
    expect(item.statusCode).toBe(201);
    const replay=await app.inject({method:"POST",url:`/api/v1/expense-days/${dayId}/items`,headers:sameKey,payload});
    expect(replay.statusCode).toBe(201);
    expect(replay.json().id).toBe(item.json().id);
    const operation=await app.inject({method:"GET",url:`/api/v1/expense-operations/${sameKey["idempotency-key"]}?operation=expense.item.create`,headers:actor});
    expect(operation.json()).toMatchObject({status:"succeeded",resourceId:item.json().id});
    expect((await app.inject({method:"GET",url:`/api/v1/expense-operations/${sameKey["idempotency-key"]}?operation=expense.item.create`,headers:{"x-dev-role":"manager"}})).json()).toMatchObject({status:"unknown",resourceId:null});
    expect((await app.inject({method:"GET",url:`/api/v1/expense-operations/${sameKey["idempotency-key"]}?operation=expense.item.create`,headers:{"x-dev-role":"system_admin"}})).statusCode).toBe(403);
    const personal=await app.inject({method:"POST",url:`/api/v1/expense-days/${dayId}/items`,headers:key(),payload:{merchant:"架空備品店",category:"備品",amount:800,paymentSource:"personal"}});
    expect(personal.statusCode).toBe(201);
    const before=await app.inject({method:"GET",url:`/api/v1/expense-days/${dayId}`,headers:actor});
    expect(before.json().totals).toMatchObject({companyWallet:"0",personal:"0",candidateCount:2});
    expect(before.json().items).toHaveLength(2);
    expect(before.json().items.find((record:{id:string})=>record.id===item.json().id).note).toBe("訪問先の駐車料金");
    const corrected=await app.inject({method:"PATCH",url:`/api/v1/expense-days/${dayId}/items/${personal.json().id}`,headers:key(),payload:{expectedLockVersion:1,merchant:"架空備品店",category:"備品",amount:900,paymentSource:"personal",note:""}});
    expect(corrected.statusCode).toBe(200);
    const staleCandidate=await app.inject({method:"PATCH",url:`/api/v1/expense-days/${dayId}/items/${personal.json().id}`,headers:key(),payload:{expectedLockVersion:1,merchant:"架空備品店",category:"備品",amount:1,paymentSource:"company_wallet"}});
    expect(staleCandidate.statusCode).toBe(409);
    const excluded=await app.inject({method:"POST",url:`/api/v1/expense-days/${dayId}/items/${personal.json().id}/exclude`,headers:key(),payload:{expectedLockVersion:2,reason:"匿名テストの重複候補"}});
    expect(excluded.statusCode).toBe(200);
    const excludedRead=await app.inject({method:"GET",url:`/api/v1/expense-days/${dayId}`,headers:actor});
    expect(excludedRead.json().totals).toMatchObject({companyWallet:"0",personal:"0",candidateCount:1});
    expect(excludedRead.json().items.find((record:{id:string})=>record.id===personal.json().id)).toMatchObject({status:"excluded",amount:"900",excludedReason:"匿名テストの重複候補"});
    expect((await app.inject({method:"POST",url:`/api/v1/expense-days/${dayId}/items/${personal.json().id}/confirm`,headers:key(),payload:{expectedLockVersion:3}})).statusCode).toBe(409);
    const confirm=await app.inject({method:"POST",url:`/api/v1/expense-days/${dayId}/items/${item.json().id}/confirm`,headers:key(),payload:{expectedLockVersion:1}});
    expect(confirm.statusCode).toBe(200);
    const after=await app.inject({method:"GET",url:`/api/v1/expense-days/${dayId}`,headers:actor});
    expect(after.json().totals).toMatchObject({companyWallet:"1200",personal:"0",candidateCount:0});
    expect(after.json().day.openingWalletCash).toBe("0");
    expect(after.json().cashReconciliation).toBe("unavailable");
    expect(after.json().closeEnabled).toBe(false);

    for(const [kind,amount] of [["funding_request",10000],["unreplenished",1200],["vault_discrepancy",500]] as const){
      const result=await app.inject({method:"POST",url:`/api/v1/expense-days/${dayId}/followups`,headers:key(),payload:{kind,amount,reason:"匿名の確認待ち"}});
      expect(result.statusCode).toBe(201);
      expect(result.json()).toMatchObject({effectOnBalance:"none",status:"open"});
    }
    const correction=await app.inject({method:"POST",url:`/api/v1/expense-days/${dayId}/followups`,headers:key(),payload:{kind:"correction_proposal",targetItemId:item.json().id,proposedAmount:1500,reason:"架空領収書との差を確認"}});
    expect(correction.statusCode).toBe(201);
    const actualReportedAt=new Date(Date.now()-86_400_000).toISOString();
    const report=await app.inject({method:"POST",url:`/api/v1/expense-days/${dayId}/followups`,headers:key(),payload:{kind:"report",reason:"匿名の報告記録",reportedAt:actualReportedAt}});
    expect(report.statusCode).toBe(201);
    expect((await app.inject({method:"POST",url:`/api/v1/expense-days/${dayId}/followups`,headers:key(),payload:{kind:"report",reason:"未来の報告",reportedAt:new Date(Date.now()+86_400_000).toISOString()}})).statusCode).toBe(422);
    const final=await app.inject({method:"GET",url:`/api/v1/expense-days/${dayId}`,headers:actor});
    expect(final.json().totals.companyWallet).toBe("1200");
    expect(final.json().followups.find((f:{kind:string})=>f.kind==="correction_proposal")).toMatchObject({proposedBefore:{amount:"1200"},proposedAfter:{amount:1500}});
    const savedReport=final.json().followups.find((f:{id:string})=>f.id===report.json().id);
    expect(savedReport.reportedAt).toBe(actualReportedAt);
    expect(new Date(savedReport.createdAt).getTime()).toBeGreaterThan(new Date(savedReport.reportedAt).getTime());
    for(const endpoint of ["cash-transfers","reconcile","close"]){
      const blocked=await app.inject({method:"POST",url:`/api/v1/expense-days/${dayId}/${endpoint}`,headers:key(),payload:{amount:1200}});
      expect(blocked.statusCode).toBe(403);
    }
    const admin=await app.inject({method:"GET",url:`/api/v1/expense-days/${dayId}`,headers:{"x-dev-role":"system_admin"}});
    expect(admin.statusCode).toBe(403);
    const pool=createPool(databaseUrl);
    try{
      const other=await pool.query<{id:string}>("INSERT INTO expense_days(organization_id,branch_id,owner_membership_id,business_date,created_by_membership_id) VALUES($1,$2,$3,$4,$3) RETURNING id",[developmentIds.organizationId,developmentIds.branchId,developmentIds.managerMembershipId,"2026-09-24"]);
      const otherId=other.rows[0]!.id;
      expect((await app.inject({method:"GET",url:`/api/v1/expense-days/${otherId}`,headers:actor})).statusCode).toBe(404);
      expect((await app.inject({method:"GET",url:`/api/v1/expense-days/${otherId}`,headers:{"x-dev-role":"manager"}})).statusCode).toBe(200);
      expect((await app.inject({method:"PATCH",url:`/api/v1/expense-days/${dayId}`,headers:{...key(),"x-dev-role":"manager"},payload:{expectedLockVersion:2,purchaseTotal:1}})).statusCode).toBe(403);
      expect((await app.inject({method:"POST",url:`/api/v1/expense-days/${dayId}/items/${item.json().id}/exclude`,headers:{...key(),"x-dev-role":"manager"},payload:{expectedLockVersion:2,reason:"管理者は本人候補を変更できない"}})).statusCode).toBe(404);
    }finally{await pool.end();}
  });

  it("pages more than 100 saved days, filters by business date and serializes the same expense operation",async()=>{
    const pool=createPool(databaseUrl);
    try{
      await pool.query("INSERT INTO expense_days(organization_id,branch_id,owner_membership_id,business_date,created_by_membership_id) SELECT $1,$2,$3,DATE '2025-01-01'+n,$3 FROM generate_series(0,104) n ON CONFLICT(organization_id,owner_membership_id,business_date) DO NOTHING",[developmentIds.organizationId,developmentIds.branchId,developmentIds.membershipId]);
      const first=await app.inject({method:"GET",url:"/api/v1/expense-days",headers:actor});
      expect(first.statusCode).toBe(200);
      expect(first.json().items).toHaveLength(100);
      expect(first.json().nextCursor).toBeTruthy();
      const second=await app.inject({method:"GET",url:`/api/v1/expense-days?cursor=${encodeURIComponent(first.json().nextCursor)}`,headers:actor});
      expect(second.statusCode).toBe(200);
      expect(second.json().items.length).toBeGreaterThanOrEqual(5);
      expect(new Set([...first.json().items,...second.json().items].map((row:{id:string})=>row.id)).size).toBe(first.json().items.length+second.json().items.length);
      const filter=await app.inject({method:"GET",url:"/api/v1/expense-days?businessDate=2025-01-01",headers:actor});
      expect(filter.statusCode).toBe(200);
      expect(filter.json().items).toHaveLength(1);
      const dayId=filter.json().items[0].id as string;
      const body={merchant:"匿名の別支出",category:"駐車場",amount:500,paymentSource:"company_wallet",note:""};
      const headers=key();
      const requests=await Promise.all([1,2].map(()=>app.inject({method:"POST",url:`/api/v1/expense-days/${dayId}/items`,headers,payload:body})));
      expect(requests.map(r=>r.statusCode)).toEqual([201,201]);
      expect(requests[0]!.json().id).toBe(requests[1]!.json().id);
      const separate=await app.inject({method:"POST",url:`/api/v1/expense-days/${dayId}/items`,headers:key(),payload:body});
      expect(separate.statusCode).toBe(201);
      expect(separate.json().id).not.toBe(requests[0]!.json().id);
      const read=await app.inject({method:"GET",url:`/api/v1/expense-days/${dayId}`,headers:actor});
      expect(read.json().items.filter((item:{id:string})=>item.id===requests[0]!.json().id)).toHaveLength(1);
      expect(read.json().items).toHaveLength(2);
      expect(read.json().items[0].note).toBeNull();
      await pool.query("UPDATE idempotency_records SET expires_at=now()-interval '1 second' WHERE organization_id=$1 AND membership_id=$2 AND endpoint_key='expense.item.create' AND idempotency_key=$3",[developmentIds.organizationId,developmentIds.membershipId,headers["idempotency-key"]]);
      const expired=await app.inject({method:"GET",url:`/api/v1/expense-operations/${headers["idempotency-key"]}?operation=expense.item.create`,headers:actor});
      expect(expired.json()).toMatchObject({status:"unknown",resourceId:null});
    }finally{await pool.end();}
  });
});
