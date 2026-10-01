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
    const set=await app.inject({method:"PATCH",url:`/api/v1/expense-days/${dayId}`,headers:key(),payload:{expectedLockVersion:open.json().day.lockVersion,openingWalletCash:0,purchaseTotal:50000}});
    expect(set.statusCode).toBe(200);
    const stale=await app.inject({method:"PATCH",url:`/api/v1/expense-days/${dayId}`,headers:key(),payload:{expectedLockVersion:open.json().day.lockVersion,purchaseTotal:1}});
    expect(stale.statusCode).toBe(409);
    const payload={merchant:"架空駐車場",category:"駐車場",amount:1200,paymentSource:"company_wallet",entrySource:"synthetic_ocr"};
    const sameKey=key();
    const item=await app.inject({method:"POST",url:`/api/v1/expense-days/${dayId}/items`,headers:sameKey,payload});
    expect(item.statusCode).toBe(201);
    const replay=await app.inject({method:"POST",url:`/api/v1/expense-days/${dayId}/items`,headers:sameKey,payload});
    expect(replay.statusCode).toBe(201);
    expect(replay.json().id).toBe(item.json().id);
    const personal=await app.inject({method:"POST",url:`/api/v1/expense-days/${dayId}/items`,headers:key(),payload:{merchant:"架空備品店",category:"備品",amount:800,paymentSource:"personal"}});
    expect(personal.statusCode).toBe(201);
    const before=await app.inject({method:"GET",url:`/api/v1/expense-days/${dayId}`,headers:actor});
    expect(before.json().totals).toMatchObject({companyWallet:"0",personal:"0",candidateCount:2});
    expect(before.json().items).toHaveLength(2);
    const corrected=await app.inject({method:"PATCH",url:`/api/v1/expense-days/${dayId}/items/${personal.json().id}`,headers:key(),payload:{expectedLockVersion:1,merchant:"架空備品店",category:"備品",amount:900,paymentSource:"personal"}});
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
    const final=await app.inject({method:"GET",url:`/api/v1/expense-days/${dayId}`,headers:actor});
    expect(final.json().totals.companyWallet).toBe("1200");
    expect(final.json().followups.find((f:{kind:string})=>f.kind==="correction_proposal")).toMatchObject({proposedBefore:{amount:"1200"},proposedAfter:{amount:1500}});
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
});
