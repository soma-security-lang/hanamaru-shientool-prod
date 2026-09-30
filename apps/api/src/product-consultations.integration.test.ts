import {randomUUID} from "node:crypto";
import {afterAll,beforeAll,describe,expect,it} from "vitest";
import type {FastifyInstance} from "fastify";
import {HanamaruRepository,createPool,developmentIds} from "@hanamaru/database";
import {createLocalProviders} from "@hanamaru/platform";
import {buildApp} from "./app.js";
import {loadConfig} from "./config.js";

const databaseUrl=process.env.DATABASE_URL;
describe.skipIf(!databaseUrl)("product consultation and assigned-manager decision",()=>{
  let app:FastifyInstance;
  let repository:HanamaruRepository;
  const keys:string[]=[];
  const productIds:string[]=[];
  const visitId=randomUUID();
  const backupUserId=randomUUID();
  const backupMembershipId=randomUUID();
  const url=(productId:string)=>`/api/v1/visits/${visitId}/products/${productId}/consultations`;
  const headers=(role:"assessor"|"manager",key?:string)=>({"x-dev-role":role,...(key?{"idempotency-key":key}:{})});
  const key=()=>{const value=randomUUID();keys.push(value);return value};
  async function product(){
    const response=await app.inject({method:"POST",url:`/api/v1/visits/${visitId}/products`,headers:headers("assessor",key()),payload:{productName:"匿名テスト商品",quantity:1}});
    expect(response.statusCode).toBe(201);productIds.push(response.json().id);return response.json().id as string;
  }
  beforeAll(async()=>{
    repository=new HanamaruRepository(createPool(databaseUrl!));
    await repository.system("INSERT INTO visits(id,organization_id,branch_id,assigned_membership_id,case_number,status) VALUES($1,$2,$3,$4,$5,'draft')",[visitId,developmentIds.organizationId,developmentIds.branchId,developmentIds.membershipId,`CONSULT-${visitId.slice(0,8)}`]);
    app=await buildApp({repository:new HanamaruRepository(createPool(databaseUrl!)),providers:createLocalProviders(),config:{...loadConfig({NODE_ENV:"test",ALLOW_DEV_AUTH:"true"}),port:0}});
    await repository.system("INSERT INTO users(id,provider_subject_hash,email_hash,email_masked,display_name) VALUES($1,$2,$3,'b***@example.invalid','匿名代理上長')",[backupUserId,randomUUID().replaceAll("-","").padEnd(64,"0"),randomUUID().replaceAll("-","").padEnd(64,"0")]);
    await repository.system("INSERT INTO memberships(id,organization_id,user_id,branch_id) VALUES($1,$2,$3,$4)",[backupMembershipId,developmentIds.organizationId,backupUserId,developmentIds.branchId]);
    await repository.system("INSERT INTO role_assignments(organization_id,membership_id,role_id,scope_type,scope_id) SELECT $1,$2,id,'branch',$3 FROM roles WHERE role_code='manager'",[developmentIds.organizationId,backupMembershipId,developmentIds.branchId]);
  });
  afterAll(async()=>{
    await app?.close();
    if(repository){
      await repository.system("DELETE FROM product_consultation_reassignments WHERE consultation_id IN(SELECT id FROM product_consultations WHERE product_id=ANY($1::uuid[]))",[productIds]);
      await repository.system("DELETE FROM product_consultations WHERE product_id=ANY($1::uuid[])",[productIds]);
      await repository.system("DELETE FROM visit_products WHERE id=ANY($1::uuid[])",[productIds]);
      await repository.system("DELETE FROM idempotency_records WHERE idempotency_key=ANY($1::varchar[])",[keys]);
      await repository.system("DELETE FROM visits WHERE id=$1",[visitId]);
      await repository.system("DELETE FROM role_assignments WHERE membership_id=$1",[backupMembershipId]);
      await repository.system("DELETE FROM memberships WHERE id=$1",[backupMembershipId]);
      await repository.system("DELETE FROM users WHERE id=$1",[backupUserId]);
      await repository.close();
    }
  });
  it("keeps the request pending until the assigned manager approves and rejects stale responses",async()=>{
    const productId=await product();
    const managers=await app.inject({method:"GET",url:`/api/v1/visits/${visitId}/consultation-managers`,headers:headers("assessor")});
    expect(managers.statusCode).toBe(200);
    expect(managers.json().items.map((item:{id:string})=>item.id)).toContain(developmentIds.managerMembershipId);
    const createKey=key();
    const request={assignedManagerId:developmentIds.managerMembershipId,proposedPriceYen:12000,reason:"根拠が複数あり判断を要する"};
    const created=await app.inject({method:"POST",url:url(productId),headers:headers("assessor",createKey),payload:request});
    expect(created.statusCode).toBe(201);expect(created.json()).toMatchObject({status:"pending",proposedPriceYen:12000});
    const replay=await app.inject({method:"POST",url:url(productId),headers:headers("assessor",createKey),payload:request});
    expect(replay.statusCode).toBe(201);expect(replay.json().id).toBe(created.json().id);
    const blocked=await app.inject({method:"POST",url:`${url(productId)}/${created.json().id}/decision`,headers:headers("assessor",key()),payload:{decision:"approved",approvedPriceYen:11000,expectedLockVersion:1}});
    expect(blocked.statusCode).toBe(403);
    const approved=await app.inject({method:"POST",url:`${url(productId)}/${created.json().id}/decision`,headers:headers("manager",key()),payload:{decision:"approved",approvedPriceYen:11000,expectedLockVersion:1}});
    expect(approved.statusCode).toBe(200);expect(approved.json()).toMatchObject({status:"approved",approvedPriceYen:11000,lockVersion:2});
    const stale=await app.inject({method:"POST",url:`${url(productId)}/${created.json().id}/decision`,headers:headers("manager",key()),payload:{decision:"approved",approvedPriceYen:13000,expectedLockVersion:1}});
    expect(stale.statusCode).toBe(409);
    const listed=await app.inject({method:"GET",url:url(productId),headers:headers("assessor")});
    expect(listed.statusCode).toBe(200);expect(listed.json().items[0]).toMatchObject({status:"approved",approvedPriceYen:11000});
  });
  it("records proxy assignment without auto-approval and requires a reason for return",async()=>{
    const productId=await product();
    const created=await app.inject({method:"POST",url:url(productId),headers:headers("assessor",key()),payload:{assignedManagerId:developmentIds.managerMembershipId,proposedPriceYen:9000,reason:"査定判断を確認したい"}});
    expect(created.statusCode).toBe(201);
    const transferred=await app.inject({method:"POST",url:`${url(productId)}/${created.json().id}/reassign`,headers:headers("manager",key()),payload:{nextManagerId:backupMembershipId,reason:"当日不在のため代理へ引継ぎ",expectedLockVersion:1}});
    expect(transferred.statusCode).toBe(200);expect(transferred.json()).toMatchObject({assignedManagerId:backupMembershipId,status:"pending",lockVersion:2});
    const oldManager=await app.inject({method:"POST",url:`${url(productId)}/${created.json().id}/decision`,headers:headers("manager",key()),payload:{decision:"approved",approvedPriceYen:9000,expectedLockVersion:2}});
    expect(oldManager.statusCode).toBe(403);
    const listed=await app.inject({method:"GET",url:url(productId),headers:headers("assessor")});
    expect(listed.json().reassignments).toHaveLength(1);
  });
});
