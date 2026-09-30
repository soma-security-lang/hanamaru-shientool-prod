import {randomUUID} from "node:crypto";
import {afterAll,beforeAll,describe,expect,it} from "vitest";
import type {FastifyInstance} from "fastify";
import {HanamaruRepository,createPool,developmentIds} from "@hanamaru/database";
import {createLocalProviders} from "@hanamaru/platform";
import {buildApp} from "./app.js";
import {loadConfig} from "./config.js";

const databaseUrl=process.env.DATABASE_URL;
describe.skipIf(!databaseUrl)("visit product cards",()=>{
  let app:FastifyInstance;
  let repository:HanamaruRepository;
  const visitId=randomUUID();
  const keys:string[]=[];
  const productIds:string[]=[];
  const headers=(key?:string)=>({"x-dev-role":"manager",...(key?{"idempotency-key":key}:{})});
  beforeAll(async()=>{
    repository=new HanamaruRepository(createPool(databaseUrl!));
    await repository.system("INSERT INTO visits(id,organization_id,branch_id,assigned_membership_id,case_number,status) VALUES($1,$2,$3,$4,$5,'draft')",[visitId,developmentIds.organizationId,developmentIds.branchId,developmentIds.membershipId,`PRODUCT-${visitId.slice(0,8)}`]);
    app=await buildApp({repository:new HanamaruRepository(createPool(databaseUrl!)),providers:createLocalProviders(),config:{...loadConfig({NODE_ENV:"test",ALLOW_DEV_AUTH:"true"}),port:0}});
  });
  afterAll(async()=>{
    await app?.close();
    if(repository){
      await repository.system("DELETE FROM visit_products WHERE id=ANY($1::uuid[])",[productIds]);
      await repository.system("DELETE FROM idempotency_records WHERE idempotency_key=ANY($1::varchar[])",[keys]);
      await repository.system("DELETE FROM visits WHERE id=$1",[visitId]);
      await repository.close();
    }
  });
  it("stores multiple cards, replays safely, and rejects stale updates or an inaccessible visit",async()=>{
    const firstKey=randomUUID();keys.push(firstKey);
    const firstBody={productName:"試験用の時計",quantity:2,conditionNote:"小傷あり",accessoriesNote:"箱あり"};
    const first=await app.inject({method:"POST",url:`/api/v1/visits/${visitId}/products`,headers:headers(firstKey),payload:firstBody});
    expect(first.statusCode).toBe(201);
    productIds.push(first.json().id);
    const replay=await app.inject({method:"POST",url:`/api/v1/visits/${visitId}/products`,headers:headers(firstKey),payload:firstBody});
    expect(replay.statusCode).toBe(201);
    expect(replay.json().id).toBe(first.json().id);
    const secondKey=randomUUID();keys.push(secondKey);
    const second=await app.inject({method:"POST",url:`/api/v1/visits/${visitId}/products`,headers:headers(secondKey),payload:{productName:"試験用のカメラ",quantity:1}});
    expect(second.statusCode).toBe(201);
    productIds.push(second.json().id);
    const list=await app.inject({method:"GET",url:`/api/v1/visits/${visitId}/products`,headers:headers()});
    expect(list.statusCode).toBe(200);
    expect(list.json().items.map((item:{id:string})=>item.id)).toEqual(expect.arrayContaining(productIds));
    const updateKey=randomUUID();keys.push(updateKey);
    const updated=await app.inject({method:"PATCH",url:`/api/v1/visits/${visitId}/products/${first.json().id}`,headers:headers(updateKey),payload:{...firstBody,quantity:3,expectedLockVersion:1}});
    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toMatchObject({quantity:3,lockVersion:2});
    const staleKey=randomUUID();keys.push(staleKey);
    const stale=await app.inject({method:"PATCH",url:`/api/v1/visits/${visitId}/products/${first.json().id}`,headers:headers(staleKey),payload:{...firstBody,quantity:4,expectedLockVersion:1}});
    expect(stale.statusCode).toBe(409);
    const inaccessible=await app.inject({method:"GET",url:`/api/v1/visits/${randomUUID()}/products`,headers:headers()});
    expect(inaccessible.statusCode).toBe(404);
  });
});
