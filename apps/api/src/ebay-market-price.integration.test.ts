import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { SoldgraphEnvelope } from "@hanamaru/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPool, developmentIds, HanamaruRepository } from "@hanamaru/database";
import { createLocalProviders, SoldgraphProviderError } from "@hanamaru/platform";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { WorkerProcessor } from "../../worker/src/processor.js";
import { refreshSoldgraphUsage } from "../../worker/src/soldgraph-usage.js";
import {scanOperations} from "../../worker/src/operations.js";

const databaseUrl = process.env.DATABASE_URL;
const accountId = randomUUID();
const header = (key = randomUUID()) => ({ "x-dev-role": "manager", "idempotency-key": key });
describe.skipIf(!databaseUrl)("eBay API (synthetic only; no external requests)", () => {
  let app: FastifyInstance, repository: HanamaruRepository, workerRepository: HanamaruRepository, worker: WorkerProcessor;
  let previousAccountId: string | undefined;
  beforeAll(async () => {
    previousAccountId = process.env.SOLDGRAPH_ACCOUNT_ID;
    process.env.SOLDGRAPH_ACCOUNT_ID = accountId;
    repository = new HanamaruRepository(createPool(databaseUrl));
    await repository.system("INSERT INTO ebay_retention_policies(organization_id,content_days,approved_at,approved_by_membership_id) VALUES($1,90,now(),$2) ON CONFLICT(organization_id) DO NOTHING",[developmentIds.organizationId,developmentIds.managerMembershipId]);
    await repository.system("INSERT INTO soldgraph_accounts(id,account_key,execution_mode,credit_budget,usage_remaining,usage_checked_at,usage_window_json) VALUES($1,$2,'enabled',100,100,now(),'{\"synthetic\":true}')", [accountId, `synthetic-${accountId}`]);
    await repository.system(`INSERT INTO soldgraph_budgets(account_id,scope_type,organization_id,membership_id,period_kind,credit_limit)
      VALUES($1,'account',NULL,NULL,'rolling_30_days',1000),($1,'organization',$2,NULL,'rolling_30_days',1000),
        ($1,'membership',$2,$3,'rolling_30_days',1000),($1,'membership',$2,$4,'rolling_30_days',1000)`,
    [accountId,developmentIds.organizationId,developmentIds.managerMembershipId,developmentIds.membershipId]);
    await repository.system(`INSERT INTO feature_flags(organization_id,flag_key,enabled,owner_membership_id,rollback_note)
      VALUES($1,'market_price_ebay',true,$2,'synthetic integration test') ON CONFLICT(organization_id,flag_key) DO UPDATE SET enabled=true`, [developmentIds.organizationId, developmentIds.managerMembershipId]);
    await repository.system("UPDATE feature_flags SET enabled=true WHERE organization_id=$1 AND flag_key='market_price_search'", [developmentIds.organizationId]);
    const providers = createLocalProviders();
    workerRepository = new HanamaruRepository(createPool(databaseUrl),"hanamaru_worker","hanamaru_worker_system");
    worker = new WorkerProcessor(workerRepository, providers, "synthetic-ebay-integration");
    app = await buildApp({ repository: new HanamaruRepository(createPool(databaseUrl),"hanamaru_api","hanamaru_api_system"), providers,
      config: { ...loadConfig({ NODE_ENV: "test", ALLOW_DEV_AUTH: "true" }), port: 0 } });
  });
  afterAll(async () => {
    await repository.system("UPDATE feature_flags SET enabled=false WHERE organization_id=$1 AND flag_key IN ('market_price_ebay','market_price_search')", [developmentIds.organizationId]);
    if (previousAccountId === undefined) delete process.env.SOLDGRAPH_ACCOUNT_ID; else process.env.SOLDGRAPH_ACCOUNT_ID = previousAccountId;
    await app.close(); await workerRepository.close(); await repository.close();
  });
  async function input(modelNumber: string | null = null,role="manager",keyword="SYNTHETIC CAMERA X1") {
    const queryId = randomUUID();
    const created = await app.inject({ method: "POST", url: "/api/v1/market-price/identifications", headers: {...header(),"x-dev-role":role}, payload: {
      inputMode: "manual_direct", productName: "SYNTHETIC CAMERA X1", modelNumber, conditions: ["good"],
      searchQueries: [{ id: queryId, keyword, breadth: "standard", source: "user", decision: "accepted" }] } });
    expect(created.statusCode).toBe(201);
    const identificationId = created.json().id as string;
    const confirmed = await app.inject({ method: "POST", url: `/api/v1/market-price/identifications/${identificationId}/confirm`,
      headers: {...header(),"x-dev-role":role}, payload: { expectedLockVersion: created.json().lockVersion } });
    expect(confirmed.statusCode).toBe(200);
    return { identificationId, selectedSearchQueryId: queryId, markets: ["us","uk","ca","au","de","fr","it","es"],
      conditions: ["used"], consumptionConfirmed: true,acquisitionMode:"latest" };
  }
  it("creates one English-support Job only on explicit request and keeps proposals unconfirmed", async () => {
    const created=await app.inject({method:"POST",url:"/api/v1/market-price/identifications",headers:header(),payload:{
      inputMode:"manual_assisted",productName:"合成カメラ ボディ",brand:"Canon",modelNumber:"EOS R6",category:"カメラ",attributes:{},searchQueries:[],excludeKeywords:[],conditions:["good"],
    }});
    expect(created.statusCode).toBe(201);
    const id=created.json().id,endpoint=`/api/v1/market-price/identifications/${id}/analyze`;
    expect((await app.inject({method:"POST",url:endpoint,headers:header(),payload:{searchLanguage:"fr"}})).statusCode).toBe(422);
    await repository.system("UPDATE feature_flags SET enabled=false WHERE organization_id=$1 AND flag_key='market_price_ebay'",[developmentIds.organizationId]);
    try{expect((await app.inject({method:"POST",url:endpoint,headers:header(),payload:{searchLanguage:"en"}})).statusCode).toBe(404);}
    finally{await repository.system("UPDATE feature_flags SET enabled=true WHERE organization_id=$1 AND flag_key='market_price_ebay'",[developmentIds.organizationId]);}
    const headers=header(),request={method:"POST" as const,url:endpoint,headers,payload:{searchLanguage:"en"}};
    const analyzed=await app.inject(request),replayed=await app.inject(request);
    expect(analyzed.statusCode).toBe(202);expect(replayed.json()).toEqual(analyzed.json());
    const job=await repository.system("SELECT input_redacted FROM jobs WHERE id=$1",[analyzed.json().jobId]);
    expect(job.rows[0]!.input_redacted).toEqual({identificationId:id,searchLanguage:"en"});
    expect(await worker.process(analyzed.json().jobId)).toBe("succeeded");
    const detail=await app.inject({method:"GET",url:`/api/v1/market-price/identifications/${id}`,headers:header()});
    expect(detail.json().input.productName).toBe("合成カメラ ボディ");
    expect(detail.json().suggestions.searchQueries).toHaveLength(3);
    expect(detail.json().suggestions.searchQueries.every((query:{keyword:string;decision:string})=>query.keyword.includes("EOS R6")&&query.decision==="pending"&&!/[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u.test(query.keyword))).toBe(true);
    expect((await repository.system("SELECT 1 FROM ebay_market_price_searches WHERE identification_id=$1",[id])).rowCount).toBe(0);
  });
  it("rechecks the eBay flag before the English-support Worker calls AI", async () => {
    const created=await app.inject({method:"POST",url:"/api/v1/market-price/identifications",headers:header(),payload:{inputMode:"manual_assisted",productName:"Synthetic camera",modelNumber:"X1",conditions:["good"]}});
    expect(created.statusCode).toBe(201);
    const analyzed=await app.inject({method:"POST",url:`/api/v1/market-price/identifications/${created.json().id}/analyze`,headers:header(),payload:{searchLanguage:"en"}});
    expect(analyzed.statusCode).toBe(202);
    const providers=createLocalProviders();let called=false;
    const guardedWorker=new WorkerProcessor(workerRepository,{...providers,ai:{...providers.ai,async identifyMarketProduct(input){called=true;return providers.ai.identifyMarketProduct(input);}}},"synthetic-english-flag");
    await repository.system("UPDATE feature_flags SET enabled=false WHERE organization_id=$1 AND flag_key='market_price_ebay'",[developmentIds.organizationId]);
    try{expect(await guardedWorker.process(analyzed.json().jobId)).toBe("failed");expect(called).toBe(false);}
    finally{await repository.system("UPDATE feature_flags SET enabled=true WHERE organization_id=$1 AND flag_key='market_price_ebay'",[developmentIds.organizationId]);}
  });
  it("reserves exactly eight market pages and replays a parallel request without creating another search", async () => {
    const payload = await input(), headers = header();
    const responses = await Promise.all([app.inject({ method: "POST", url: "/api/v1/market-price/ebay/searches", headers, payload }),
      app.inject({ method: "POST", url: "/api/v1/market-price/ebay/searches", headers, payload })]);
    expect(responses.map(response => response.statusCode)).toEqual([202,202]);
    expect(responses[0]!.json()).toEqual(responses[1]!.json());
    expect(responses[0]!.json().reservedCredits).toBe(8);
    const id = responses[0]!.json().searchId;
    const pages = await repository.system("SELECT market,state,credits FROM ebay_market_price_pages WHERE search_id=$1", [id]);
    expect(pages.rowCount).toBe(8);
    expect(pages.rows.every(page => page.state === "reserved" && page.credits === null)).toBe(true);
    const read = await app.inject({ method: "GET", url: `/api/v1/market-price/ebay/searches/${id}`, headers: header() });
    expect(read.statusCode).toBe(200);
    expect(read.json()).toMatchObject({ sourceProvider: "soldgraph_ebay", periodMode: "source_sample", status: "queued", lockVersion: 1 });
    expect(read.json().statistics).toHaveLength(8);
    expect(read.json()).not.toHaveProperty("periodDays");
    expect(read.json().pages[0]).not.toHaveProperty("operation_key");
    expect(read.json().pages[0]).not.toHaveProperty("request_id");
    expect(read.json().pages[0]).not.toHaveProperty("operationKey");
    expect(read.json().pages[0]).not.toHaveProperty("requestId");
  });
  it("refreshes usage once, serializes new reservations and does not subtract provider-accounted charges twice",async()=>{
    await repository.system("UPDATE soldgraph_accounts SET credit_budget=1000,usage_remaining=1000 WHERE id=$1",[accountId]);
    const original=await app.inject({method:"POST",url:"/api/v1/market-price/ebay/searches",headers:header(),payload:{...await input(),markets:["us"]}});
    expect(original.statusCode).toBe(202);expect(await worker.process(original.json().jobId)).toBe("succeeded");
    const held=await repository.system<{pending:number}>("SELECT count(*)::int pending FROM ebay_market_price_pages WHERE account_id=$1 AND credits IS NULL",[accountId]);
    const remaining=held.rows[0]!.pending+2;
    const payload={...await input(),markets:["us","uk"]};let calls=0;
    await refreshSoldgraphUsage(workerRepository,{async usage(){
      calls++;
      const rejected=await app.inject({method:"POST",url:"/api/v1/market-price/ebay/searches",headers:header(),payload});expect(rejected.statusCode).toBe(409);
      await expect(refreshSoldgraphUsage(workerRepository,{async usage(){throw new Error("unexpected parallel usage");}},accountId)).rejects.toThrow("REFRESHING");
      return{plan:"free",used:100-remaining,limit:100,remaining,extraRequests:1000,window:"one_time",sharedAllowance:true,rateLimitPerMinute:60};
    }},accountId);
    expect(calls).toBe(1);
    const account=await repository.system("SELECT usage_remaining,usage_accounted_charged,usage_window_json,execution_mode,usage_lease_owner FROM soldgraph_accounts WHERE id=$1",[accountId]);
    expect(account.rows[0]).toMatchObject({usage_remaining:remaining,usage_accounted_charged:"1",execution_mode:"enabled",usage_lease_owner:null,usage_window_json:{window:"one_time",extraRequests:1000}});
    const admitted=await app.inject({method:"POST",url:"/api/v1/market-price/ebay/searches",headers:header(),payload});expect(admitted.statusCode).toBe(202);
    const exhausted=await app.inject({method:"POST",url:"/api/v1/market-price/ebay/searches",headers:header(),payload:{...payload,markets:["us"]}});expect(exhausted.statusCode).toBe(409);
    expect((await repository.system("SELECT 1 FROM soldgraph_account_calls WHERE account_id=$1 AND call_type='usage'",[accountId])).rowCount).toBe(1);
    await repository.system("UPDATE soldgraph_accounts SET usage_checked_at=now()-interval '16 minutes' WHERE id=$1",[accountId]);
    expect((await app.inject({method:"POST",url:"/api/v1/market-price/ebay/searches",headers:header(),payload:{...payload,markets:["us"]}})).statusCode).toBe(409);
    await expect(refreshSoldgraphUsage(workerRepository,{async usage(){throw new Error("PRIVATE SYNTHETIC SOURCE ERROR");}},accountId)).rejects.toThrow("SOLDGRAPH_USAGE_RECONCILIATION_REQUIRED");
    expect((await repository.system("SELECT execution_mode,usage_remaining,usage_checked_at,usage_lease_owner FROM soldgraph_accounts WHERE id=$1",[accountId])).rows[0]).toEqual({execution_mode:"reconcile_only",usage_remaining:null,usage_checked_at:null,usage_lease_owner:null});
    await repository.system("UPDATE soldgraph_accounts SET execution_mode='enabled',usage_remaining=1000,usage_checked_at=now(),usage_accounted_charged=0 WHERE id=$1",[accountId]);
  });
  it("enforces scoped budgets and admits only one parallel reservation at the organization ceiling",async()=>{
    const held=await repository.system<{held:number}>("SELECT coalesce(sum(CASE WHEN credit_state='released' THEN 0 WHEN credit_state='charged' THEN credits ELSE 1 END),0)::int held FROM ebay_market_price_pages WHERE account_id=$1 AND organization_id=$2",[accountId,developmentIds.organizationId]);
    const payload={...await input(),markets:["us"]};
    try{
      await repository.system("UPDATE soldgraph_budgets SET credit_limit=0 WHERE account_id=$1 AND scope_type='membership' AND membership_id=$2",[accountId,developmentIds.managerMembershipId]);
      expect((await app.inject({method:"POST",url:"/api/v1/market-price/ebay/searches",headers:header(),payload})).statusCode).toBe(409);
      await repository.system("UPDATE soldgraph_budgets SET credit_limit=1000,valid_until=now()-interval '1 second',valid_from=now()-interval '1 day' WHERE account_id=$1 AND scope_type='membership' AND membership_id=$2",[accountId,developmentIds.managerMembershipId]);
      expect((await app.inject({method:"POST",url:"/api/v1/market-price/ebay/searches",headers:header(),payload})).statusCode).toBe(409);
      await repository.system("UPDATE soldgraph_budgets SET valid_until=NULL WHERE account_id=$1 AND scope_type='membership' AND membership_id=$2",[accountId,developmentIds.managerMembershipId]);
      await repository.system("UPDATE soldgraph_budgets SET credit_limit=$2 WHERE account_id=$1 AND scope_type='organization'",[accountId,held.rows[0]!.held+1]);
      const parallel=await Promise.all([1,2].map(()=>app.inject({method:"POST",url:"/api/v1/market-price/ebay/searches",headers:header(),payload})));
      expect(parallel.map(response=>response.statusCode).sort()).toEqual([202,409]);
    }finally{await repository.system("UPDATE soldgraph_budgets SET credit_limit=1000,valid_until=NULL WHERE account_id=$1",[accountId]);}
  });
  it("applies rolling, calendar and lifetime budgets without releasing unresolved reservations",async()=>{
    const pool=createPool(databaseUrl),client=await pool.connect();
    const charged=await repository.system<{id:string;charged_at:Date}>("SELECT id,charged_at FROM ebay_market_price_pages WHERE account_id=$1 AND credit_state='charged' LIMIT 1",[accountId]);
    expect(charged.rowCount).toBe(1);
    const page=charged.rows[0]!;
    const payload={...await input(),markets:["us"]};
    let createdId:string|undefined;
    try{
      // Only the disposable synthetic database owner can construct historical charge fixtures.
      await client.query("BEGIN");await client.query("SET LOCAL session_replication_role='replica'");
      await client.query("UPDATE ebay_market_price_pages SET charged_at=now()-interval '40 days' WHERE id=$1",[page.id]);
      await client.query("COMMIT");
      const current=await repository.system<{held:number}>(`SELECT coalesce(sum(CASE WHEN credit_state='charged' THEN credits ELSE 1 END),0)::int held
        FROM ebay_market_price_pages WHERE account_id=$1 AND credit_state<>'released'
        AND (credit_state<>'charged' OR charged_at IS NULL OR charged_at>=now()-interval '30 days')`,[accountId]);
      const limit=current.rows[0]!.held+1;
      for(const period of ["lifetime","calendar_month","rolling_30_days"]){
        await repository.system("UPDATE soldgraph_budgets SET period_kind=$2,credit_limit=$3 WHERE account_id=$1 AND scope_type='account'",[accountId,period,limit]);
        const response=await app.inject({method:"POST",url:"/api/v1/market-price/ebay/searches",headers:header(),payload});
        expect(response.statusCode).toBe(period==="lifetime"?409:202);
        if(response.statusCode===202){
          createdId=response.json().searchId;
          const detail=await app.inject({method:"GET",url:`/api/v1/market-price/ebay/searches/${createdId}`,headers:header()});
          const cancelled=await app.inject({method:"POST",url:`/api/v1/market-price/ebay/searches/${createdId}/cancel`,headers:header(),payload:{expectedLockVersion:detail.json().lockVersion}});
          expect(cancelled.statusCode).toBe(200);createdId=undefined;
        }
      }
      await repository.system("UPDATE soldgraph_budgets SET period_kind='rolling_30_days',credit_limit=$2 WHERE account_id=$1 AND scope_type='account'",[accountId,current.rows[0]!.held]);
      expect((await app.inject({method:"POST",url:"/api/v1/market-price/ebay/searches",headers:header(),payload})).statusCode).toBe(409);
    }finally{
      await client.query("ROLLBACK");await client.query("BEGIN");await client.query("SET LOCAL session_replication_role='replica'");
      await client.query("UPDATE ebay_market_price_pages SET charged_at=$2 WHERE id=$1",[page.id,page.charged_at]);await client.query("COMMIT");
      await repository.system("UPDATE soldgraph_budgets SET period_kind='rolling_30_days',credit_limit=1000 WHERE account_id=$1",[accountId]);
      client.release();await pool.end();
    }
  });
  it("reuses three authorized fresh markets and reserves only the other five without copying external identities",async()=>{
    await repository.system("UPDATE soldgraph_accounts SET credit_budget=1000,usage_remaining=1000 WHERE id=$1",[accountId]);
    const payload=await input("CACHE-X1"),providers=createLocalProviders(),delegate=providers.soldgraph!;
    const freshWorker=new WorkerProcessor(workerRepository,{...providers,soldgraph:{async submit(request,key){
      const envelope=await delegate.submit(request,key);if(envelope.status!=="complete")return envelope;
      return {...envelope,result:{...(envelope.result as Record<string,unknown>),collected_at:new Date().toISOString()}};
    },poll:id=>delegate.poll(id)}},"synthetic-cache-fresh");
    const original=await app.inject({method:"POST",url:"/api/v1/market-price/ebay/searches",headers:header(),payload:{...payload,markets:["us","uk","ca"]}});
    expect(original.statusCode).toBe(202);expect(await freshWorker.process(original.json().jobId)).toBe("succeeded");
    const reused=await app.inject({method:"POST",url:"/api/v1/market-price/ebay/searches",headers:header(),payload:{...payload,acquisitionMode:"reuse"}});
    expect(reused.statusCode).toBe(202);expect(reused.json()).toMatchObject({cachedPages:3,reservedCredits:5,status:"queued"});
    const pages=await repository.system("SELECT market,cache_from_page_id,credits,request_id FROM ebay_market_price_pages WHERE search_id=$1",[reused.json().searchId]);
    expect(pages.rows.filter(page=>page.cache_from_page_id)).toHaveLength(3);
    expect(pages.rows.filter(page=>page.cache_from_page_id).every(page=>page.credits===0&&page.request_id===null)).toBe(true);
    expect(await freshWorker.process(reused.json().jobId)).toBe("succeeded");
    const saved=await app.inject({method:"GET",url:`/api/v1/market-price/ebay/searches/${reused.json().searchId}`,headers:header()});
    expect(saved.json().pages.filter((page:{cacheHit:boolean})=>page.cacheHit)).toHaveLength(3);
    expect(saved.json().pages.reduce((sum:number,page:{credits:number})=>sum+page.credits,0)).toBe(5);
    expect((await repository.system("SELECT 1 FROM soldgraph_account_calls WHERE operation_key IN (SELECT operation_key FROM ebay_market_price_pages WHERE search_id=$1)",[reused.json().searchId])).rowCount).toBe(5);
    const allCached=await app.inject({method:"POST",url:"/api/v1/market-price/ebay/searches",headers:header(),payload:{...payload,acquisitionMode:"reuse"}});
    expect(allCached.statusCode).toBe(202);expect(allCached.json()).toMatchObject({cachedPages:8,reservedCredits:0,status:"ready",jobId:null});
    const editedCache=await app.inject({method:"POST",url:`/api/v1/market-price/ebay/searches/${reused.json().searchId}/repeat`,headers:header(),payload:{
      expectedLockVersion:saved.json().lockVersion,mode:"edited",keyword:saved.json().plan.keyword,markets:saved.json().plan.markets,
      conditions:saved.json().plan.conditions,buyingFormat:saved.json().plan.buyingFormat,exclusionKeywords:saved.json().exclusionKeywords,
      outlierPercent:saved.json().outlierPercent,acquisitionMode:"reuse",consumptionConfirmed:true}});
    expect(editedCache.statusCode).toBe(202);expect(editedCache.json()).toMatchObject({cachedPages:8,reservedCredits:0,cacheHit:true,status:"ready",jobId:null});
    const selfOnly=await app.inject({method:"POST",url:"/api/v1/market-price/ebay/searches",headers:{...header(),"x-dev-role":"assessor"},payload:{...await input("CACHE-X1","assessor"),acquisitionMode:"reuse"}});
    expect(selfOnly.statusCode).toBe(202);expect(selfOnly.json()).toMatchObject({cachedPages:0,reservedCredits:8});
    await repository.system("UPDATE ebay_market_price_pages SET processing_version='obsolete' WHERE search_id=$1 AND market='us'",[original.json().searchId]);
    const changedVersion=await app.inject({method:"POST",url:"/api/v1/market-price/ebay/searches",headers:header(),payload:{...payload,markets:["us"],acquisitionMode:"reuse"}});
    expect(changedVersion.statusCode).toBe(202);expect(changedVersion.json()).toMatchObject({cachedPages:0,reservedCredits:1});
    const latest=await app.inject({method:"POST",url:"/api/v1/market-price/ebay/searches",headers:header(),payload});
    expect(latest.statusCode).toBe(202);expect(latest.json()).toMatchObject({cachedPages:0,reservedCredits:8,status:"queued"});
    await repository.system("UPDATE ebay_market_price_pages SET normalized_result_json=jsonb_set(normalized_result_json,'{collectedAt}',to_jsonb((now()-interval '25 hours')::text)) WHERE search_id=ANY($1::uuid[])",[[original.json().searchId,reused.json().searchId]]);
    const expired=await app.inject({method:"POST",url:"/api/v1/market-price/ebay/searches",headers:header(),payload:{...payload,acquisitionMode:"reuse"}});
    expect(expired.statusCode).toBe(202);expect(expired.json()).toMatchObject({cachedPages:0,reservedCredits:8});
  });
  it("reuses only the explicitly selected next page, preserves snapshots and still charges latest-mode pages",async()=>{
    const payload={...await input("X1","manager","SYNTHETIC CACHE-NEXT CAMERA X1"),markets:["us"]};
    const providers=createLocalProviders(),delegate=providers.soldgraph!;
    const freshWorker=new WorkerProcessor(workerRepository,{...providers,soldgraph:{async submit(request,key){
      const envelope=await delegate.submit(request,key);if(envelope.status!=="complete")return envelope;
      return {...envelope,result:{...(envelope.result as Record<string,unknown>),collected_at:new Date().toISOString()}};
    },poll:id=>delegate.poll(id)}},"synthetic-next-cache");
    const original=await app.inject({method:"POST",url:"/api/v1/market-price/ebay/searches",headers:header(),payload});
    expect(original.statusCode).toBe(202);expect(await freshWorker.process(original.json().jobId)).toBe("succeeded");
    const base=`/api/v1/market-price/ebay/searches/${original.json().searchId}`;
    const ready=await app.inject({method:"GET",url:base,headers:header()});
    const second=await app.inject({method:"POST",url:`${base}/next-page`,headers:header(),payload:{expectedLockVersion:ready.json().lockVersion,market:"us",consumptionConfirmed:true}});
    expect(second.statusCode).toBe(202);expect(second.json().reservedCredits).toBe(1);expect(await freshWorker.process(second.json().jobId)).toBe("succeeded");
    const cached=await app.inject({method:"POST",url:"/api/v1/market-price/ebay/searches",headers:header(),payload:{...payload,acquisitionMode:"reuse"}});
    expect(cached.statusCode).toBe(202);expect(cached.json()).toMatchObject({jobId:null,cachedPages:1,reservedCredits:0});
    const target=`/api/v1/market-price/ebay/searches/${cached.json().searchId}`;
    const first=await app.inject({method:"GET",url:target,headers:header()});expect(first.json().pages).toHaveLength(1);
    const confirmed=await app.inject({method:"POST",url:`${target}/confirm`,headers:header(),payload:{expectedLockVersion:first.json().lockVersion}});expect(confirmed.statusCode).toBe(201);
    const saved=await app.inject({method:"GET",url:target,headers:header()}),headers=header();
    const requests=await Promise.all([1,2].map(()=>app.inject({method:"POST",url:`${target}/next-page`,headers,payload:{expectedLockVersion:saved.json().lockVersion,market:"us",consumptionConfirmed:true}})));
    expect(requests.map(response=>response.statusCode)).toEqual([202,202]);expect(requests[0]!.json()).toEqual(requests[1]!.json());
    expect(requests[0]!.json()).toMatchObject({jobId:null,reservedCredits:0,cacheHit:true});
    const after=await app.inject({method:"GET",url:target,headers:header()});
    expect(after.json().status).toBe("ready");expect(after.json().pages).toHaveLength(2);
    expect(after.json().pages.every((page:{cacheHit:boolean;credits:number})=>page.cacheHit&&page.credits===0)).toBe(true);
    expect(after.json().statistics[0].receivedRows).toBe(12);expect(after.json().snapshots[0].snapshotHash).toBe(confirmed.json().snapshotHash);
    expect((await repository.system("SELECT 1 FROM soldgraph_account_calls WHERE operation_key IN (SELECT operation_key FROM ebay_market_price_pages WHERE search_id=$1)",[cached.json().searchId])).rowCount).toBe(0);
    const latest=await app.inject({method:"POST",url:"/api/v1/market-price/ebay/searches",headers:header(),payload});
    expect(latest.statusCode).toBe(202);expect(latest.json().reservedCredits).toBe(1);expect(await freshWorker.process(latest.json().jobId)).toBe("succeeded");
    const latestBase=`/api/v1/market-price/ebay/searches/${latest.json().searchId}`,latestReady=await app.inject({method:"GET",url:latestBase,headers:header()});
    expect(latestReady.json().acquisitionMode).toBe("latest");
    const latestNext=await app.inject({method:"POST",url:`${latestBase}/next-page`,headers:header(),payload:{expectedLockVersion:latestReady.json().lockVersion,market:"us",consumptionConfirmed:true}});
    expect(latestNext.statusCode).toBe(202);expect(latestNext.json().reservedCredits).toBe(1);expect(latestNext.json().jobId).not.toBeNull();
    expect(await freshWorker.process(latestNext.json().jobId)).toBe("succeeded");
    const latestSaved=await app.inject({method:"GET",url:latestBase,headers:header()});
    expect(latestSaved.json().pages.every((page:{cacheHit:boolean;credits:number})=>!page.cacheHit&&page.credits===1)).toBe(true);
  });
  it("rejects unconfirmed consumption and duplicate markets", async () => {
    const payload = await input();
    const consent = await app.inject({ method: "POST", url: "/api/v1/market-price/ebay/searches", headers: header(), payload: { ...payload, consumptionConfirmed: false } });
    expect(consent.statusCode).toBe(422);
    const duplicate = await app.inject({ method: "POST", url: "/api/v1/market-price/ebay/searches", headers: header(), payload: { ...payload, markets: ["us","us"] } });
    expect(duplicate.statusCode).toBe(422);
  });
  it("rolls back all initial pages and the parent search when the shared budget is insufficient", async () => {
    const payload = await input();
    await repository.system("UPDATE soldgraph_accounts SET credit_budget=0 WHERE id=$1", [accountId]);
    try {
      const rejected = await app.inject({ method: "POST", url: "/api/v1/market-price/ebay/searches", headers: header(), payload });
      expect(rejected.statusCode).toBe(409);
      const searches = await repository.system("SELECT id FROM ebay_market_price_searches WHERE identification_id=$1", [payload.identificationId]);
      expect(searches.rowCount).toBe(0);
    } finally { await repository.system("UPDATE soldgraph_accounts SET credit_budget=1000 WHERE id=$1", [accountId]); }
  });
  it("denies system administrators and an assessor reading another person's search", async () => {
    const payload = await input();
    const created = await app.inject({ method: "POST", url: "/api/v1/market-price/ebay/searches", headers: header(), payload });
    expect(created.statusCode).toBe(202);
    const url = `/api/v1/market-price/ebay/searches/${created.json().searchId}`;
    expect((await app.inject({ method: "GET", url, headers: { "x-dev-role": "system_admin" } })).statusCode).toBe(403);
    expect((await app.inject({ method: "GET", url, headers: { "x-dev-role": "assessor" } })).statusCode).toBe(404);
  });
  it("looks up only the actor's unexpired operation and rechecks current flags and search scope",async()=>{
    const headers=header(),payload={...await input(),markets:["us"]},created=await app.inject({method:"POST",url:"/api/v1/market-price/ebay/searches",headers,payload});
    expect(created.statusCode).toBe(202);
    const url=`/api/v1/market-price/ebay/operations/${headers["idempotency-key"]}?action=create`;
    const result=await app.inject({method:"GET",url,headers:header()});
    expect(result.statusCode).toBe(200);expect(result.json()).toEqual({status:"succeeded",action:"create",searchId:created.json().searchId});
    expect((await app.inject({method:"GET",url,headers:{"x-dev-role":"assessor"}})).json()).toEqual({status:"unknown",action:"create",searchId:null});
    expect((await app.inject({method:"GET",url,headers:{"x-dev-role":"system_admin"}})).statusCode).toBe(403);
    expect((await app.inject({method:"GET",url:url.replace("action=create","action=expense.item.create"),headers:header()})).statusCode).toBe(422);
    await repository.system("UPDATE feature_flags SET enabled=false WHERE organization_id=$1 AND flag_key='market_price_ebay'",[developmentIds.organizationId]);
    try{
      expect((await app.inject({method:"GET",url,headers:header()})).statusCode).toBe(404);
      expect((await app.inject({method:"POST",url:"/api/v1/market-price/ebay/searches",headers,payload})).statusCode).toBe(404);
    }
    finally{await repository.system("UPDATE feature_flags SET enabled=true WHERE organization_id=$1 AND flag_key='market_price_ebay'",[developmentIds.organizationId]);}
    const ownHeaders={...header(),"x-dev-role":"assessor"},ownPayload={...await input(null,"assessor"),markets:["us"]},own=await app.inject({method:"POST",url:"/api/v1/market-price/ebay/searches",headers:ownHeaders,payload:ownPayload});
    expect(own.statusCode).toBe(202);
    const ownUrl=`/api/v1/market-price/ebay/operations/${ownHeaders["idempotency-key"]}?action=create`;
    expect((await app.inject({method:"GET",url:ownUrl,headers:ownHeaders})).json().status).toBe("succeeded");
    await repository.system("UPDATE ebay_market_price_searches SET created_by_membership_id=$2 WHERE id=$1",[own.json().searchId,developmentIds.managerMembershipId]);
    expect((await app.inject({method:"GET",url:ownUrl,headers:ownHeaders})).statusCode).toBe(404);
    expect((await app.inject({method:"POST",url:"/api/v1/market-price/ebay/searches",headers:ownHeaders,payload:ownPayload})).statusCode).toBe(404);
    await repository.system("UPDATE idempotency_records SET expires_at=now()-interval '1 second' WHERE idempotency_key=$1",[headers["idempotency-key"]]);
    expect((await app.inject({method:"GET",url,headers:header()})).json()).toEqual({status:"unknown",action:"create",searchId:null});
  });
  it("does not invent a next page or permit confirmation of an empty pending search", async () => {
    const created = await app.inject({ method: "POST", url: "/api/v1/market-price/ebay/searches", headers: header(), payload: await input() });
    expect(created.statusCode).toBe(202);
    const base = `/api/v1/market-price/ebay/searches/${created.json().searchId}`;
    expect((await app.inject({ method: "POST", url: `${base}/next-page`, headers: header(), payload: { expectedLockVersion: 1, market: "us", consumptionConfirmed: true } })).statusCode).toBe(409);
    expect((await app.inject({ method: "POST", url: `${base}/confirm`, headers: header(), payload: { expectedLockVersion: 1, partialAcknowledged: true } })).statusCode).toBe(422);
  });
  it("enforces the feature flag on reads, not just navigation", async () => {
    await repository.system("UPDATE feature_flags SET enabled=false WHERE organization_id=$1 AND flag_key='market_price_ebay'", [developmentIds.organizationId]);
    try {
      expect((await app.inject({ method: "GET", url: "/api/v1/market-price/ebay/searches", headers: header() })).statusCode).toBe(404);
    } finally { await repository.system("UPDATE feature_flags SET enabled=true WHERE organization_id=$1 AND flag_key='market_price_ebay'", [developmentIds.organizationId]); }
  });
  it("cancels unsent pages exactly once and does not submit them through Worker", async () => {
    const created = await app.inject({ method: "POST", url: "/api/v1/market-price/ebay/searches", headers: header(), payload: await input() });
    expect(created.statusCode).toBe(202);
    const base = `/api/v1/market-price/ebay/searches/${created.json().searchId}`, headers = header();
    const requests = await Promise.all([1,2].map(() => app.inject({ method: "POST", url: `${base}/cancel`, headers, payload: { expectedLockVersion: 1 } })));
    expect(requests.map(result => result.statusCode)).toEqual([200,200]);
    expect(requests[0]!.json()).toEqual(requests[1]!.json());
    expect(requests[0]!.json().pages.every((page: { state: string; credits: number; creditState: string }) =>
      page.state === "cancelled" && page.credits === 0 && page.creditState === "released")).toBe(true);
    expect(await worker.process(created.json().jobId)).toBe("succeeded");
    const saved = await app.inject({ method: "GET", url: base, headers: header() });
    expect(saved.json().status).toBe("cancelled");
    expect(saved.json().observations).toEqual([]);
    const calls = await repository.system("SELECT 1 FROM soldgraph_account_calls WHERE operation_key IN (SELECT operation_key FROM ebay_market_price_pages WHERE search_id=$1)", [created.json().searchId]);
    expect(calls.rowCount).toBe(0);
    expect((await app.inject({ method: "POST", url: `${base}/next-page`, headers: header(), payload: {
      expectedLockVersion: saved.json().lockVersion, market: "us", consumptionConfirmed: true } })).statusCode).toBe(409);
  });
  it("reconciles accepted pages after cancellation without publishing candidates or submitting again", async () => {
    const providers = createLocalProviders(), completed = new Map<string, SoldgraphEnvelope>();
    let submits = 0, polls = 0;
    const pendingWorker = new WorkerProcessor(workerRepository, { ...providers, soldgraph: {
      async submit(request, key) {
        submits++;
        const result = await providers.soldgraph!.submit(request, key);
        completed.set(result.requestId, result);
        return { status: "pending", requestId: result.requestId, credits: 0, cached: false };
      },
      async poll(id) { polls++; return completed.get(id)!; },
    } }, "synthetic-cancellation");
    const created = await app.inject({ method: "POST", url: "/api/v1/market-price/ebay/searches", headers: header(), payload: { ...await input(), markets: ["us"] } });
    expect(created.statusCode).toBe(202);
    expect(await pendingWorker.process(created.json().jobId)).toBe("retry_wait");
    const base = `/api/v1/market-price/ebay/searches/${created.json().searchId}`;
    const pending = await app.inject({ method: "GET", url: base, headers: header() });
    const cancelled = await app.inject({ method: "POST", url: `${base}/cancel`, headers: header(), payload: { expectedLockVersion: pending.json().lockVersion } });
    expect(cancelled.statusCode).toBe(200);
    expect(cancelled.json().pages[0]).toMatchObject({ creditState: "pending", credits: null });
    await repository.system("UPDATE jobs SET available_at=now() WHERE id=$1", [created.json().jobId]);
    expect(await pendingWorker.process(created.json().jobId)).toBe("succeeded");
    const reconciled = await app.inject({ method: "GET", url: base, headers: header() });
    expect(reconciled.json().status).toBe("cancelled");
    expect(reconciled.json().pages[0]).toMatchObject({ creditState: "charged", credits: 1 });
    expect(reconciled.json().observations).toEqual([]);
    expect(submits).toBe(1); expect(polls).toBe(1);
  });
  it("allows a scoped manager to add an assessor's next page without allowing the reverse",async()=>{
    const payload={...await input(null,"assessor"),markets:["us"]};
    const created=await app.inject({method:"POST",url:"/api/v1/market-price/ebay/searches",headers:{...header(),"x-dev-role":"assessor"},payload});
    expect(created.statusCode).toBe(202);expect(await worker.process(created.json().jobId)).toBe("succeeded");
    const base=`/api/v1/market-price/ebay/searches/${created.json().searchId}`;
    const read=await app.inject({method:"GET",url:base,headers:header()});expect(read.statusCode).toBe(200);
    const extra=await app.inject({method:"POST",url:`${base}/next-page`,headers:header(),payload:{expectedLockVersion:read.json().lockVersion,market:"us",consumptionConfirmed:true}});
    expect(extra.statusCode).toBe(202);expect(extra.json().reservedCredits).toBe(1);
    expect(await worker.process(extra.json().jobId)).toBe("succeeded");
    const saved=await app.inject({method:"GET",url:base,headers:header()});
    expect(saved.json().pages).toHaveLength(2);expect(saved.json().pages.every((page:{credits:number})=>page.credits===1)).toBe(true);
    const managerCreated=await app.inject({method:"POST",url:"/api/v1/market-price/ebay/searches",headers:header(),payload:{...await input(),markets:["us"]}});
    expect(managerCreated.statusCode).toBe(202);expect(await worker.process(managerCreated.json().jobId)).toBe("succeeded");
    const managerBase=`/api/v1/market-price/ebay/searches/${managerCreated.json().searchId}`;
    const managerRead=await app.inject({method:"GET",url:managerBase,headers:header()});
    const denied=await app.inject({method:"POST",url:`${managerBase}/next-page`,headers:{...header(),"x-dev-role":"assessor"},payload:{expectedLockVersion:managerRead.json().lockVersion,market:"us",consumptionConfirmed:true}});
    expect(denied.statusCode).toBe(404);
    expect((await repository.system("SELECT 1 FROM ebay_market_price_pages WHERE search_id=$1",[managerCreated.json().searchId])).rowCount).toBe(1);
  });
  it("does not confirm a cancelled search even when completed candidates remain",async()=>{
    const created=await app.inject({method:"POST",url:"/api/v1/market-price/ebay/searches",headers:header(),payload:{...await input(),markets:["us"]}});
    expect(created.statusCode).toBe(202);expect(await worker.process(created.json().jobId)).toBe("succeeded");
    const id=created.json().searchId,base=`/api/v1/market-price/ebay/searches/${id}`;
    const ready=await app.inject({method:"GET",url:base,headers:header()});
    expect(ready.json().statistics[0].includedCount).toBeGreaterThan(0);
    const cancelled=await app.inject({method:"POST",url:`${base}/cancel`,headers:header(),payload:{expectedLockVersion:ready.json().lockVersion}});
    expect(cancelled.statusCode).toBe(200);expect(cancelled.json().status).toBe("cancelled");
    const rejected=await app.inject({method:"POST",url:`${base}/confirm`,headers:header(),payload:{expectedLockVersion:cancelled.json().lockVersion,partialAcknowledged:true}});
    expect(rejected.statusCode).toBe(409);
    const saved=await app.inject({method:"GET",url:base,headers:header()});
    expect(saved.json().status).toBe("cancelled");expect(saved.json().lockVersion).toBe(cancelled.json().lockVersion);
    expect(saved.json().snapshots).toEqual([]);expect(saved.json().statistics[0].includedCount).toBeGreaterThan(0);
    expect(saved.json().pages[0]).toMatchObject({creditState:"charged",credits:1});
    expect((await repository.system("SELECT 1 FROM soldgraph_account_calls WHERE operation_key IN (SELECT operation_key FROM ebay_market_price_pages WHERE search_id=$1)",[id])).rowCount).toBe(1);
  });
  it("executes eight synthetic markets through Worker, confirms a snapshot and adds only one chosen page", async () => {
    const created = await app.inject({ method: "POST", url: "/api/v1/market-price/ebay/searches", headers: header(), payload: await input() });
    expect(created.statusCode).toBe(202);
    expect(await worker.process(created.json().jobId)).toBe("succeeded");
    const id = created.json().searchId, base = `/api/v1/market-price/ebay/searches/${id}`;
    const complete = await app.inject({ method: "GET", url: base, headers: header() });
    expect(complete.statusCode).toBe(200);
    expect(complete.json().status).toBe("ready");
    expect(complete.json().statistics).toHaveLength(8);
    expect(complete.json().statistics.every((stat: { median: string; includedCount: number }) => stat.median === "110.00" && stat.includedCount === 5)).toBe(true);
    expect(complete.json().statistics.every((stat:{histogram:{populationCount:number;bins:{count:number}[]}})=>stat.histogram.populationCount===5&&stat.histogram.bins.reduce((sum,bin)=>sum+bin.count,0)===5)).toBe(true);
    expect(complete.json().counts.uniqueItemIds).toBe(6);
    expect(complete.json().pages.every((page: { creditState: string; credits: number }) => page.creditState === "charged" && page.credits === 1)).toBe(true);
    const confirmed = await app.inject({ method: "POST", url: `${base}/confirm`, headers: header(), payload: { expectedLockVersion: complete.json().lockVersion } });
    expect(confirmed.statusCode).toBe(201);
    const snapshotHash = confirmed.json().snapshotHash;
    const saved = await app.inject({ method: "GET", url: base, headers: header() });
    expect(saved.json().snapshots[0].snapshotHash).toBe(snapshotHash);
    expect(saved.json().snapshots[0].snapshotJson.statistics[0].histogram).toEqual(complete.json().statistics[0].histogram);
    const extra = await app.inject({ method: "POST", url: `${base}/next-page`, headers: header(), payload: {
      expectedLockVersion: saved.json().lockVersion, market: "us", consumptionConfirmed: true } });
    expect(extra.statusCode).toBe(202);
    expect(await worker.process(extra.json().jobId)).toBe("succeeded");
    const updated = await app.inject({ method: "GET", url: base, headers: header() });
    expect(updated.json().pages).toHaveLength(9);
    expect(updated.json().statistics.find((stat: { market: string }) => stat.market === "us").receivedRows).toBe(12);
    expect(updated.json().snapshots[0].snapshotHash).toBe(snapshotHash);
    expect(updated.json().snapshots[0].snapshotJson.statistics[0].histogram).toEqual(complete.json().statistics[0].histogram);
    const calls = await repository.system("SELECT call_type FROM soldgraph_account_calls WHERE operation_key IN (SELECT operation_key FROM ebay_market_price_pages WHERE search_id=$1)", [id]);
    expect(calls.rowCount).toBe(9);
    expect(calls.rows.every(call => call.call_type === "submit")).toBe(true);
    const candidate = updated.json().observations.find((item: { observationJson: { market: string; sourceItemId: string } }) => item.observationJson.market === "us" && item.observationJson.sourceItemId === "100000000000");
    const excluded = await app.inject({ method: "PATCH", url: `${base}/candidates/${candidate.id}`, headers: header(), payload: {
      expectedLockVersion: updated.json().lockVersion, scope: "product", decision: "exclude", reason: "Synthetic product mismatch" } });
    expect(excluded.statusCode).toBe(200);
    expect(excluded.json().statistics.every((stat: { decisions: { observation: { sourceItemId: string }; included: boolean }[] }) =>
      stat.decisions.filter(item => item.observation.sourceItemId === "100000000000").every(item => !item.included))).toBe(true);
    const policy = await app.inject({ method: "PATCH", url: `${base}/outlier-policy`, headers: header(), payload: {
      expectedLockVersion: excluded.json().lockVersion, outlierPercent: 30 } });
    expect(policy.statusCode).toBe(200);
    expect(policy.json().outlierPercent).toBe(30);
    expect(policy.json().snapshots[0].snapshotHash).toBe(snapshotHash);
    const restored = await app.inject({ method: "PATCH", url: `${base}/candidates/${candidate.id}`, headers: header(), payload: {
      expectedLockVersion: policy.json().lockVersion, scope: "product", decision: "default", reason: "Synthetic correction" } });
    expect(restored.statusCode).toBe(200);
    expect(restored.json().statistics.find((stat: { market: string }) => stat.market === "uk").includedCount).toBe(5);
  });
  it("persists confirmed product evidence, excludes a different model and retains reasoned manual review",async()=>{
    const created=await app.inject({method:"POST",url:"/api/v1/market-price/ebay/searches",headers:header(),payload:{...await input("X1"),markets:["us"]}});
    expect(created.statusCode).toBe(202);
    const providers=createLocalProviders(),delegate=providers.soldgraph!;
    const productWorker=new WorkerProcessor(workerRepository,{...providers,soldgraph:{
      async submit(request,key){
        const envelope=await delegate.submit(request,key);if(envelope.status!=="complete")return envelope;
        const result=envelope.result as {data:Array<Record<string,unknown>>};
        return {...envelope,result:{...result,data:result.data.map((row,index)=>index===0?{...row,title:"SYNTHETIC CAMERA X2"}:row)}};
      },poll:requestId=>delegate.poll(requestId),
    }},"synthetic-product-match");
    expect(await productWorker.process(created.json().jobId)).toBe("succeeded");
    const id=created.json().searchId,base=`/api/v1/market-price/ebay/searches/${id}`;
    const basis=await repository.system("SELECT product_basis_json FROM ebay_market_price_searches WHERE id=$1",[id]);
    expect(basis.rows[0]!.product_basis_json).toEqual({keyword:"SYNTHETIC CAMERA X1",modelNumber:"X1"});
    const detail=await app.inject({method:"GET",url:base,headers:header()});
    const decision=detail.json().statistics[0].decisions.find((item:{observation:{sourceItemId:string}})=>item.observation.sourceItemId==="100000000000");
    expect(decision).toMatchObject({included:false,productMatch:{status:"mismatch",reasons:["model_not_matched"],version:"1.1.0"}});
    const candidate=detail.json().observations.find((item:{observationJson:{sourceItemId:string}})=>item.observationJson.sourceItemId==="100000000000");
    const reviewed=await app.inject({method:"PATCH",url:`${base}/candidates/${candidate.id}`,headers:header(),payload:{
      expectedLockVersion:detail.json().lockVersion,scope:"observation",decision:"include",reason:"Synthetic reviewer checked the product evidence",
    }});
    expect(reviewed.statusCode).toBe(200);
    const adopted=reviewed.json().statistics[0].decisions.find((item:{observation:{sourceItemId:string}})=>item.observation.sourceItemId==="100000000000");
    expect(adopted.included).toBe(true);expect(adopted.productMatch.status).toBe("mismatch");
    const confirmed=await app.inject({method:"POST",url:`${base}/confirm`,headers:header(),payload:{expectedLockVersion:reviewed.json().lockVersion}});
    expect(confirmed.statusCode).toBe(201);
    const saved=await app.inject({method:"GET",url:base,headers:header()});
    expect(saved.json().snapshots[0].snapshotJson.statistics[0].decisions.some((item:{productMatch?:{status:string}})=>item.productMatch?.status==="mismatch")).toBe(true);
  });
  it("persists country contradictions across pages without discarding prices or changing the old snapshot",async()=>{
    const providers=createLocalProviders(),delegate=providers.soldgraph!;
    const locationWorker=new WorkerProcessor(workerRepository,{...providers,soldgraph:{
      async submit(request,key){
        const envelope=await delegate.submit(request,key);if(envelope.status!=="complete")return envelope;
        const result=envelope.result as {data:Array<Record<string,unknown>>};
        return {...envelope,result:{...result,data:result.data.map((row,index)=>({...row,
          ...(request.page===2&&index===0?{id:"100000000000",link:"https://www.ebay.com/itm/100000000000"}:{}),
          location_text:request.page===2&&index===0?"Japan":"United States"}))}};
      },poll:id=>delegate.poll(id),
    }},"synthetic-location-evidence");
    const created=await app.inject({method:"POST",url:"/api/v1/market-price/ebay/searches",headers:header(),payload:{...await input(),markets:["us"]}});
    expect(created.statusCode).toBe(202);expect(await locationWorker.process(created.json().jobId)).toBe("succeeded");
    const base=`/api/v1/market-price/ebay/searches/${created.json().searchId}`;
    const ready=await app.inject({method:"GET",url:base,headers:header()});
    expect(ready.json().statistics[0].locationQuality).toEqual({denominator:6,explicitCountryCount:6,unknownCount:0,conflictingCount:0,identifiedRate:1});
    const confirmed=await app.inject({method:"POST",url:`${base}/confirm`,headers:header(),payload:{expectedLockVersion:ready.json().lockVersion}});expect(confirmed.statusCode).toBe(201);
    const saved=await app.inject({method:"GET",url:base,headers:header()});
    const extra=await app.inject({method:"POST",url:`${base}/next-page`,headers:header(),payload:{expectedLockVersion:saved.json().lockVersion,market:"us",consumptionConfirmed:true}});
    expect(extra.statusCode).toBe(202);expect(await locationWorker.process(extra.json().jobId)).toBe("succeeded");
    const updated=await app.inject({method:"GET",url:base,headers:header()});
    expect(updated.json().statistics[0].locationQuality).toEqual({denominator:11,explicitCountryCount:10,unknownCount:0,conflictingCount:1,identifiedRate:10/11});
    const candidate=updated.json().statistics[0].decisions.find((decision:{observation:{sourceItemId:string}})=>decision.observation.sourceItemId==="100000000000");
    expect(candidate.included).toBe(true);expect(candidate.observation.location).toMatchObject({status:"conflicting",countryCode:null});
    expect(updated.json().snapshots[0].snapshotJson.statistics[0].locationQuality).toEqual(ready.json().statistics[0].locationQuality);
    expect(updated.json().pages.map((page:{credits:number})=>page.credits)).toEqual([1,1]);
  });
  it("quarantines cross-page price-quality conflicts without refunding or modifying a saved snapshot",async()=>{
    const created=await app.inject({method:"POST",url:"/api/v1/market-price/ebay/searches",headers:header(),payload:{...await input(),markets:["us"]}});
    expect(created.statusCode).toBe(202);
    expect(await worker.process(created.json().jobId)).toBe("succeeded");
    const id=created.json().searchId,base=`/api/v1/market-price/ebay/searches/${id}`;
    const ready=await app.inject({method:"GET",url:base,headers:header()});
    const confirmed=await app.inject({method:"POST",url:`${base}/confirm`,headers:header(),payload:{expectedLockVersion:ready.json().lockVersion}});
    expect(confirmed.statusCode).toBe(201);
    const saved=await app.inject({method:"GET",url:base,headers:header()});
    const next=await app.inject({method:"POST",url:`${base}/next-page`,headers:header(),payload:{expectedLockVersion:saved.json().lockVersion,market:"us",consumptionConfirmed:true}});
    expect(next.statusCode).toBe(202);
    const providers=createLocalProviders(),delegate=providers.soldgraph!;
    const changedWorker=new WorkerProcessor(workerRepository,{...providers,soldgraph:{
      async submit(request,key){
        const envelope=await delegate.submit(request,key);
        if(envelope.status!=="complete")return envelope;
        const result=envelope.result as {data:Array<Record<string,unknown>>};
        return {...envelope,result:{...result,data:result.data.map((row,index)=>index===0?{
          ...row,id:"100000000000",link:"https://www.ebay.com/itm/100000000000",best_offer_accepted:true,
        }:row)}};
      },
      poll:requestId=>delegate.poll(requestId),
    }},"synthetic-price-quality-conflict");
    expect(await changedWorker.process(next.json().jobId)).toBe("succeeded");
    const updated=await app.inject({method:"GET",url:base,headers:header()});
    const candidate=updated.json().statistics[0].decisions.find((decision:{observation:{sourceItemId:string}})=>decision.observation.sourceItemId==="100000000000");
    expect(candidate.included).toBe(false);
    expect(candidate.reasons).toContain("observation_conflict");
    expect(updated.json().pages.map((page:{credits:number})=>page.credits)).toEqual([1,1]);
    expect(updated.json().snapshots[0].snapshotHash).toBe(confirmed.json().snapshotHash);
  });
  it("retries only a confirmed zero-credit external failure with a new attempt and no parallel duplicate",async()=>{
    const providers=createLocalProviders();
    const failedWorker=new WorkerProcessor(workerRepository,{...providers,soldgraph:{
      async submit(){return{status:"failed",credits:0,cached:false,requestId:`synthetic-failed-${randomUUID()}`} as const;},
      async poll(){throw new Error("unexpected synthetic poll");},
    }},"synthetic-failure");
    const created=await app.inject({method:"POST",url:"/api/v1/market-price/ebay/searches",headers:header(),payload:{...await input(),markets:["us"]}});
    expect(created.statusCode).toBe(202);
    expect(await failedWorker.process(created.json().jobId)).toBe("succeeded");
    const id=created.json().searchId,base=`/api/v1/market-price/ebay/searches/${id}`;
    const failed=await app.inject({method:"GET",url:base,headers:header()});
    expect(failed.json().pages[0]).toMatchObject({state:"failed",creditState:"released",credits:0,attempt:1});
    const payload={expectedLockVersion:failed.json().lockVersion,market:"us",pageNumber:1,consumptionConfirmed:true},headers=header();
    const responses=await Promise.all([1,2].map(()=>app.inject({method:"POST",url:`${base}/retry`,headers,payload})));
    expect(responses.map(value=>value.statusCode)).toEqual([202,202]);
    expect(responses[0]!.json()).toEqual(responses[1]!.json());
    expect(responses[0]!.json()).toMatchObject({attempt:2,reservedCredits:1});
    const reserved=await repository.system("SELECT operation_key,attempt,credits FROM ebay_market_price_pages WHERE search_id=$1 ORDER BY attempt",[id]);
    expect(reserved.rowCount).toBe(2);
    expect(reserved.rows[0]!.operation_key).not.toBe(reserved.rows[1]!.operation_key);
    expect(await worker.process(responses[0]!.json().jobId)).toBe("succeeded");
    const recovered=await app.inject({method:"GET",url:base,headers:header()});
    expect(recovered.json().status).toBe("ready");
    expect(recovered.json().pages.map((page:{credits:number})=>page.credits)).toEqual([0,1]);
    expect(recovered.json().statistics[0].median).toBe("110.00");
    const denied=await app.inject({method:"POST",url:`${base}/retry`,headers:header(),payload:{...payload,expectedLockVersion:recovered.json().lockVersion}});
    expect(denied.statusCode).toBe(409);
  });
  it("creates one latest search on parallel repeat and leaves the old snapshot unchanged",async()=>{
    const created=await app.inject({method:"POST",url:"/api/v1/market-price/ebay/searches",headers:header(),payload:{...await input(),markets:["us"]}});
    expect(created.statusCode).toBe(202);expect(await worker.process(created.json().jobId)).toBe("succeeded");
    const id=created.json().searchId,base=`/api/v1/market-price/ebay/searches/${id}`;
    const ready=await app.inject({method:"GET",url:base,headers:header()});
    const confirmed=await app.inject({method:"POST",url:`${base}/confirm`,headers:header(),payload:{expectedLockVersion:ready.json().lockVersion}});
    expect(confirmed.statusCode).toBe(201);
    const saved=await app.inject({method:"GET",url:base,headers:header()});
    const headers=header(),payload={expectedLockVersion:saved.json().lockVersion,mode:"latest",consumptionConfirmed:true};
    const responses=await Promise.all([1,2].map(()=>app.inject({method:"POST",url:`${base}/repeat`,headers,payload})));
    expect(responses.map(response=>response.statusCode)).toEqual([202,202]);
    expect(responses[0]!.json()).toEqual(responses[1]!.json());
    const next=responses[0]!.json();expect(next.searchId).not.toBe(id);expect(next).toMatchObject({reservedCredits:1,cacheHit:false});
    expect(await worker.process(next.jobId)).toBe("succeeded");
    const latest=await app.inject({method:"GET",url:`/api/v1/market-price/ebay/searches/${next.searchId}`,headers:header()});
    expect(latest.json().plan).toEqual(saved.json().plan);
    expect(latest.json().pages).toHaveLength(1);expect(latest.json().snapshots).toEqual([]);
    const previous=await app.inject({method:"GET",url:base,headers:header()});
    expect(previous.json().snapshots[0].snapshotHash).toBe(confirmed.json().snapshotHash);
    expect(previous.json().lockVersion).toBe(saved.json().lockVersion);
    expect((await app.inject({method:"POST",url:`${base}/repeat`,headers:header(),payload:{...payload,consumptionConfirmed:false}})).statusCode).toBe(422);
    await repository.system("UPDATE soldgraph_accounts SET credit_budget=0 WHERE id=$1",[accountId]);
    try{
      const failed=await app.inject({method:"POST",url:`${base}/repeat`,headers:header(),payload});expect(failed.statusCode).toBe(409);
      const count=await repository.system("SELECT count(*)::int count FROM ebay_market_price_searches WHERE identification_id=(SELECT identification_id FROM ebay_market_price_searches WHERE id=$1)",[id]);
      expect(count.rows[0]!.count).toBe(2);
    }finally{await repository.system("UPDATE soldgraph_accounts SET credit_budget=100 WHERE id=$1",[accountId]);}
  });
  it("edits conditions into a separate idempotent search without rewriting the confirmed product or snapshot",async()=>{
    await repository.system("UPDATE soldgraph_accounts SET credit_budget=1000,usage_remaining=1000 WHERE id=$1",[accountId]);
    const created=await app.inject({method:"POST",url:"/api/v1/market-price/ebay/searches",headers:header(),payload:{...await input("X1"),markets:["us"]}});
    expect(created.statusCode).toBe(202);expect(await worker.process(created.json().jobId)).toBe("succeeded");
    const base=`/api/v1/market-price/ebay/searches/${created.json().searchId}`;
    const ready=await app.inject({method:"GET",url:base,headers:header()});
    expect((await app.inject({method:"POST",url:`${base}/confirm`,headers:header(),payload:{expectedLockVersion:ready.json().lockVersion}})).statusCode).toBe(201);
    const before=(await app.inject({method:"GET",url:base,headers:header()})).json();
    const payload={expectedLockVersion:before.lockVersion,mode:"edited",consumptionConfirmed:true,keyword:"  SYNTHETIC CAMERA X1 body  ",
      markets:["uk","de"],conditions:["used","open_box"],buyingFormat:"auction",exclusionKeywords:["  Parts  ","Parts"],outlierPercent:25,acquisitionMode:"latest"};
    const headers=header();
    const responses=await Promise.all([1,2].map(()=>app.inject({method:"POST",url:`${base}/repeat`,headers,payload})));
    expect(responses.map(response=>response.statusCode)).toEqual([202,202]);expect(responses[0]!.json()).toEqual(responses[1]!.json());
    const next=responses[0]!.json();expect(next).toMatchObject({reservedCredits:2,cachedPages:0,cacheHit:false});expect(next.searchId).not.toBe(before.id);
    const detail=(await app.inject({method:"GET",url:`/api/v1/market-price/ebay/searches/${next.searchId}`,headers:header()})).json();
    expect(detail).toMatchObject({acquisitionMode:"latest",outlierPercent:25,exclusionKeywords:["Parts"],snapshots:[],plan:{keyword:"SYNTHETIC CAMERA X1 body",markets:["uk","de"],conditions:["open_box","used"],buyingFormat:"auction"}});
    const stored=await repository.system("SELECT product_basis_json FROM ebay_market_price_searches WHERE id=$1",[next.searchId]);
    expect(stored.rows[0]!.product_basis_json).toEqual({keyword:"SYNTHETIC CAMERA X1 body",modelNumber:"X1"});
    expect((await app.inject({method:"GET",url:base,headers:header()})).json()).toEqual(before);
    expect((await app.inject({method:"POST",url:`${base}/repeat`,headers,payload:{...payload,keyword:"another query"}})).statusCode).toBe(409);
    for(const changes of [{consumptionConfirmed:false},{keyword:""},{markets:["gb"]},{acquisitionMode:"arbitrary"},{exclusionKeywords:["x".repeat(101)]},{outlierPercent:0},{rawParams:{}},{mode:"latest"}]){
      expect((await app.inject({method:"POST",url:`${base}/repeat`,headers:header(),payload:{...payload,...changes}})).statusCode).toBe(422);
    }
    expect(await worker.process(next.jobId)).toBe("succeeded");
  });
  it("persists Retry-After in the checkpoint, Job and outbox and never resubmits before it",async()=>{
    const providers=createLocalProviders(),delegate=providers.soldgraph!,keys:string[]=[];
    const delayedWorker=new WorkerProcessor(workerRepository,{...providers,soldgraph:{
      async submit(request,key){keys.push(key);if(keys.length===1)throw new SoldgraphProviderError("RATE_LIMIT",600);return delegate.submit(request,key);},
      poll:requestId=>delegate.poll(requestId),
    }},"synthetic-retry-after");
    const created=await app.inject({method:"POST",url:"/api/v1/market-price/ebay/searches",headers:header(),payload:{...await input(),markets:["us"]}});
    expect(created.statusCode).toBe(202);
    const {searchId:id,jobId}=created.json();
    expect(await delayedWorker.process(jobId)).toBe("retry_wait");
    const deferred=await repository.system<{retry_not_before:Date;available_at:Date;outbox_at:Date;failure_class:string}>(`SELECT p.retry_not_before,p.failure_class,j.available_at,o.available_at outbox_at
      FROM ebay_market_price_pages p JOIN jobs j ON j.id=$2 JOIN outbox_events o ON o.aggregate_id=j.id
      WHERE p.search_id=$1 AND o.deduplication_key='job:'||j.id::text||':attempt:1'`,[id,jobId]);
    expect(deferred.rows[0]!.failure_class).toBe("RATE_LIMIT");
    expect(deferred.rows[0]!.available_at.getTime()).toBeGreaterThanOrEqual(deferred.rows[0]!.retry_not_before.getTime());
    expect(deferred.rows[0]!.outbox_at.getTime()).toBe(deferred.rows[0]!.available_at.getTime());
    await repository.system("UPDATE jobs SET available_at=now() WHERE id=$1",[jobId]);
    expect(await delayedWorker.process(jobId)).toBe("retry_wait");expect(keys).toHaveLength(1);
    await repository.system("UPDATE ebay_market_price_pages SET retry_not_before=now()-interval '1 second' WHERE search_id=$1",[id]);
    await repository.system("UPDATE jobs SET available_at=now() WHERE id=$1",[jobId]);
    expect(await delayedWorker.process(jobId)).toBe("succeeded");expect(keys).toHaveLength(2);expect(keys[1]).toBe(keys[0]);
    const detail=await app.inject({method:"GET",url:`/api/v1/market-price/ebay/searches/${id}`,headers:header()});
    expect(detail.json().pages[0]).toMatchObject({state:"complete",credits:1,failureClass:null,retryNotBefore:null,attempt:1});
  });
  it("separates a quota stop from terminal free failure and keeps unknown credits held",async()=>{
    const providers=createLocalProviders();let submits=0;
    const stoppedWorker=new WorkerProcessor(workerRepository,{...providers,soldgraph:{async submit(){submits++;throw new SoldgraphProviderError("QUOTA");},async poll(){throw new Error("unexpected synthetic poll");}}},"synthetic-quota");
    const created=await app.inject({method:"POST",url:"/api/v1/market-price/ebay/searches",headers:header(),payload:{...await input(),markets:["us"]}});
    expect(created.statusCode).toBe(202);expect(await stoppedWorker.process(created.json().jobId)).toBe("succeeded");
    expect(submits).toBe(1);
    const base=`/api/v1/market-price/ebay/searches/${created.json().searchId}`;
    const detail=await app.inject({method:"GET",url:base,headers:header()});
    expect(detail.json().status).toBe("blocked");
    expect(detail.json().runs[0]).toMatchObject({status:"blocked",failureClass:"QUOTA"});
    expect(detail.json().pages[0]).toMatchObject({state:"blocked",failureClass:"QUOTA",creditState:"unknown",credits:null});
    const account=await repository.system("SELECT execution_mode FROM soldgraph_accounts WHERE id=$1",[accountId]);
    expect(account.rows[0]!.execution_mode).toBe("reconcile_only");
    expect((await app.inject({method:"POST",url:`${base}/retry`,headers:header(),payload:{expectedLockVersion:detail.json().lockVersion,market:"us",pageNumber:1,consumptionConfirmed:true}})).statusCode).toBe(409);
    await repository.system("UPDATE soldgraph_accounts SET execution_mode='enabled' WHERE id=$1",[accountId]);
  });
  it("resumes the same accepted request only after operator recovery without purchasing another page",async()=>{
    const providers=createLocalProviders(),delegate=providers.soldgraph!;
    let submits=0,polls=0;let completed:SoldgraphEnvelope;
    const recoveringWorker=new WorkerProcessor(workerRepository,{...providers,soldgraph:{
      async submit(request,key){submits++;completed=await delegate.submit(request,key);return {status:"pending",requestId:completed.requestId,credits:0,cached:false};},
      async poll(requestId){polls++;expect(requestId).toBe(completed.requestId);if(polls===1)throw new SoldgraphProviderError("CONFIGURATION");return completed;},
    }},"synthetic-resume");
    const created=await app.inject({method:"POST",url:"/api/v1/market-price/ebay/searches",headers:header(),payload:{...await input(),markets:["us"]}});
    expect(created.statusCode).toBe(202);
    const {searchId:id,jobId}=created.json(),base=`/api/v1/market-price/ebay/searches/${id}`;
    expect(await recoveringWorker.process(jobId)).toBe("retry_wait");
    await repository.system("UPDATE jobs SET available_at=now() WHERE id=$1",[jobId]);
    expect(await recoveringWorker.process(jobId)).toBe("succeeded");
    const blocked=await app.inject({method:"GET",url:base,headers:header()});
    expect(blocked.json().pages[0]).toMatchObject({state:"blocked",credits:null,canResume:true});
    const original=await repository.system("SELECT operation_key,request_id,attempt,credit_state,credits FROM ebay_market_price_pages WHERE search_id=$1",[id]);
    const payload={expectedLockVersion:blocked.json().lockVersion,market:"us",pageNumber:1,resumeConfirmed:true};
    try{
      for(const mode of ["reconcile_only","emergency_stop"]){
        await repository.system("UPDATE soldgraph_accounts SET execution_mode=$2 WHERE id=$1",[accountId,mode]);
        expect((await app.inject({method:"POST",url:`${base}/resume`,headers:header(),payload})).statusCode).toBe(409);
      }
      expect((await app.inject({method:"POST",url:`${base}/resume`,headers:{...header(),"x-dev-role":"system_admin"},payload})).statusCode).toBe(403);
      expect((await app.inject({method:"POST",url:`${base}/resume`,headers:{...header(),"x-dev-role":"assessor"},payload})).statusCode).toBe(404);
      await repository.system("UPDATE soldgraph_accounts SET execution_mode='enabled' WHERE id=$1",[accountId]);
      await repository.system("UPDATE ebay_market_price_pages SET retry_not_before=now()+interval '1 hour' WHERE search_id=$1",[id]);
      expect((await app.inject({method:"POST",url:`${base}/resume`,headers:header(),payload})).statusCode).toBe(409);
      await repository.system("UPDATE ebay_market_price_pages SET retry_not_before=NULL WHERE search_id=$1",[id]);
      const headers=header(),responses=await Promise.all([1,2].map(()=>app.inject({method:"POST",url:`${base}/resume`,headers,payload})));
      expect(responses.map(response=>response.statusCode)).toEqual([202,202]);expect(responses[0]!.json()).toEqual(responses[1]!.json());
      expect(responses[0]!.json()).toMatchObject({reservedCredits:0,resumedExistingRequest:true});
      const retained=await repository.system("SELECT operation_key,request_id,attempt,credit_state,credits FROM ebay_market_price_pages WHERE search_id=$1",[id]);
      expect(retained.rows).toEqual(original.rows);
      expect(await recoveringWorker.process(responses[0]!.json().jobId)).toBe("succeeded");
      expect(submits).toBe(1);expect(polls).toBe(2);
      const recovered=await app.inject({method:"GET",url:base,headers:header()});
      expect(recovered.json().status).toBe("ready");expect(recovered.json().pages).toHaveLength(1);
      expect(recovered.json().pages[0]).toMatchObject({credits:1,attempt:1,canResume:false});
    }finally{await repository.system("UPDATE soldgraph_accounts SET execution_mode='enabled' WHERE id=$1",[accountId]);}
  });
  it("holds charged results unpublished when stopping during a response, then resumes without another external call",async()=>{
    await repository.system("UPDATE soldgraph_accounts SET credit_budget=1000,usage_remaining=1000 WHERE id=$1",[accountId]);
    for(const stop of ["emergency_stop","reconcile_only","flag_off"]){
      const providers=createLocalProviders(),delegate=providers.soldgraph!;let calls=0;
      const stoppingWorker=new WorkerProcessor(workerRepository,{...providers,soldgraph:{async submit(request,key){
        calls++;const result=await delegate.submit(request,key);
        if(stop==="flag_off")await repository.system("UPDATE feature_flags SET enabled=false WHERE organization_id=$1 AND flag_key='market_price_ebay'",[developmentIds.organizationId]);
        else await repository.system("UPDATE soldgraph_accounts SET execution_mode=$2 WHERE id=$1",[accountId,stop]);
        return result;
      },async poll(){calls++;throw new Error("unexpected synthetic purchase/poll after retained result");}}},"synthetic-final-stop");
      const created=await app.inject({method:"POST",url:"/api/v1/market-price/ebay/searches",headers:header(),payload:{...await input(),markets:["us"]}});
      expect(created.statusCode).toBe(202);const {searchId:id,jobId}=created.json(),base=`/api/v1/market-price/ebay/searches/${id}`;
      try{
        expect(await stoppingWorker.process(jobId)).toBe("succeeded");expect(calls).toBe(1);
        const retained=await repository.system("SELECT state,credits,credit_state,parser_version,normalized_result_json,operation_key,request_id FROM ebay_market_price_pages WHERE search_id=$1",[id]);
        expect(retained.rows[0]).toMatchObject({state:"blocked",credits:1,credit_state:"charged",parser_version:null});
        expect(retained.rows[0]!.normalized_result_json).not.toBeNull();
        expect((await repository.system("SELECT 1 FROM ebay_market_price_observations WHERE search_id=$1",[id])).rowCount).toBe(0);
        await repository.system("UPDATE soldgraph_accounts SET execution_mode='enabled' WHERE id=$1",[accountId]);
        await repository.system("UPDATE feature_flags SET enabled=true WHERE organization_id=$1 AND flag_key='market_price_ebay'",[developmentIds.organizationId]);
        const blocked=(await app.inject({method:"GET",url:base,headers:header()})).json();expect(blocked.status).toBe("blocked");
        const resumed=await app.inject({method:"POST",url:`${base}/resume`,headers:header(),payload:{expectedLockVersion:blocked.lockVersion,market:"us",pageNumber:1,resumeConfirmed:true}});
        expect(resumed.statusCode).toBe(202);expect(resumed.json().reservedCredits).toBe(0);
        expect(await stoppingWorker.process(resumed.json().jobId)).toBe("succeeded");expect(calls).toBe(1);
        const ready=(await app.inject({method:"GET",url:base,headers:header()})).json();expect(ready.status).toBe("ready");expect(ready.statistics[0].includedCount).toBeGreaterThan(0);
        const after=await repository.system("SELECT operation_key,request_id,credits FROM ebay_market_price_pages WHERE search_id=$1",[id]);
        expect(after.rows).toEqual([{operation_key:retained.rows[0]!.operation_key,request_id:retained.rows[0]!.request_id,credits:1}]);
      }finally{
        await repository.system("UPDATE soldgraph_accounts SET execution_mode='enabled' WHERE id=$1",[accountId]);
        await repository.system("UPDATE feature_flags SET enabled=true WHERE organization_id=$1 AND flag_key='market_price_ebay'",[developmentIds.organizationId]);
      }
    }
  });
  it("retains an unknown operation and denies a new retry key",async()=>{
    const providers=createLocalProviders();
    const unknownWorker=new WorkerProcessor(workerRepository,{...providers,soldgraph:{async submit(){throw new Error("synthetic connection lost");},async poll(){throw new Error("unexpected synthetic poll");}}},"synthetic-unknown");
    const created=await app.inject({method:"POST",url:"/api/v1/market-price/ebay/searches",headers:header(),payload:{...await input(),markets:["us"]}});
    expect(created.statusCode).toBe(202);
    expect(await unknownWorker.process(created.json().jobId)).toBe("retry_wait");
    const base=`/api/v1/market-price/ebay/searches/${created.json().searchId}`;
    const pending=await app.inject({method:"GET",url:base,headers:header()});
    expect(pending.json().pages[0]).toMatchObject({state:"unknown",creditState:"unknown",credits:null});
    expect(pending.json().pages[0].canResume).toBe(false);
    expect((await app.inject({method:"POST",url:`${base}/resume`,headers:header(),payload:{expectedLockVersion:pending.json().lockVersion,market:"us",pageNumber:1,resumeConfirmed:true}})).statusCode).toBe(409);
    const denied=await app.inject({method:"POST",url:`${base}/retry`,headers:header(),payload:{expectedLockVersion:pending.json().lockVersion,market:"us",pageNumber:1,consumptionConfirmed:true}});
    expect(denied.statusCode).toBe(409);
    const repeated=await app.inject({method:"POST",url:`${base}/repeat`,headers:header(),payload:{expectedLockVersion:pending.json().lockVersion,mode:"latest",consumptionConfirmed:true}});
    expect(repeated.statusCode).toBe(409);
    const pages=await repository.system("SELECT attempt,credits FROM ebay_market_price_pages WHERE search_id=$1",[created.json().searchId]);
    expect(pages.rowCount).toBe(1);expect(pages.rows[0]).toMatchObject({attempt:1,credits:null});
    let usageCalls=0;
    await expect(refreshSoldgraphUsage(workerRepository,{async usage(){usageCalls++;throw new Error("unexpected usage while unsettled");}},accountId)).rejects.toThrow("SOLDGRAPH_USAGE_UNSETTLED");
    expect(usageCalls).toBe(0);
    const jobId=created.json().jobId;
    const alerts=await scanOperations(workerRepository);
    expect(alerts).toEqual(expect.arrayContaining([expect.objectContaining({jobId,jobType:"market_price_ebay_search",failureClass:"MARKET_PRICE_BLOCKED",severity:"critical"})]));
    const metadata=await workerRepository.system("SELECT * FROM soldgraph_operational_candidates()");
    expect(metadata.rows.find(row=>row.job_id===jobId)).not.toHaveProperty("keyword");
    // Isolated fixture simulates an externally confirmed zero-credit resolution.
    // Runtime users have no permission to release an unknown credit automatically.
    await repository.system("UPDATE ebay_market_price_pages SET state='cancelled',credit_state='released',credits=0 WHERE search_id=$1",[created.json().searchId]);
    await repository.system("UPDATE ebay_market_price_searches SET status='cancelled' WHERE id=$1",[created.json().searchId]);
    await scanOperations(workerRepository);
    const resolved=await repository.system("SELECT status FROM operational_alerts WHERE job_id=$1 AND failure_class='MARKET_PRICE_BLOCKED'",[jobId]);
    expect(resolved.rows[0]?.status).toBe("resolved");
  });
  it("refuses new searches without an approved duration instead of selecting a default",async()=>{
    const payload={...await input(),markets:["us"]};
    const created=await app.inject({method:"POST",url:"/api/v1/market-price/ebay/searches",headers:header(),payload});
    expect(created.statusCode).toBe(202);expect(await worker.process(created.json().jobId)).toBe("succeeded");
    const base=`/api/v1/market-price/ebay/searches/${created.json().searchId}`;
    const ready=await app.inject({method:"GET",url:base,headers:header()});
    await repository.system("DELETE FROM ebay_retention_policies WHERE organization_id=$1",[developmentIds.organizationId]);
    try{
      const response=await app.inject({method:"POST",url:"/api/v1/market-price/ebay/searches",headers:header(),payload});
      expect(response.statusCode).toBe(409);expect(response.json().error.message).toContain("保存期間");
      const cache=await app.inject({method:"POST",url:"/api/v1/market-price/ebay/searches",headers:header(),payload:{...payload,acquisitionMode:"reuse"}});
      expect(cache.statusCode).toBe(409);expect(cache.json().error.message).toContain("保存期間");
      const repeat=await app.inject({method:"POST",url:`${base}/repeat`,headers:header(),payload:{expectedLockVersion:ready.json().lockVersion,consumptionConfirmed:true,mode:"latest"}});
      expect(repeat.statusCode).toBe(409);expect(repeat.json().error.message).toContain("保存期間");
      const page=await app.inject({method:"POST",url:`${base}/next-page`,headers:header(),payload:{expectedLockVersion:ready.json().lockVersion,market:"us",consumptionConfirmed:true}});
      expect(page.statusCode).toBe(409);expect(page.json().error.message).toContain("保存期間");
      expect((await app.inject({method:"GET",url:base,headers:header()})).statusCode).toBe(200);
      expect((await workerRepository.system("SELECT purge_expired_ebay_content($1,100) count",[developmentIds.organizationId])).rows[0]!.count).toBe(0);
    }finally{
      await repository.system("INSERT INTO ebay_retention_policies(organization_id,content_days,approved_at,approved_by_membership_id) VALUES($1,90,now(),$2)",[developmentIds.organizationId,developmentIds.managerMembershipId]);
    }
  });
  it("stops queued dispatch when the approved retention policy is withdrawn",async()=>{
    const created=await app.inject({method:"POST",url:"/api/v1/market-price/ebay/searches",headers:header(),payload:{...await input(),markets:["us"]}});
    expect(created.statusCode).toBe(202);
    await repository.system("DELETE FROM ebay_retention_policies WHERE organization_id=$1",[developmentIds.organizationId]);
    try{
      expect(await worker.process(created.json().jobId)).toBe("succeeded");
      const detail=await app.inject({method:"GET",url:`/api/v1/market-price/ebay/searches/${created.json().searchId}`,headers:header()});
      expect(detail.statusCode).toBe(200);expect(detail.json().status).toBe("blocked");
      expect((await repository.system("SELECT 1 FROM soldgraph_account_calls WHERE operation_key IN (SELECT operation_key FROM ebay_market_price_pages WHERE search_id=$1)",[created.json().searchId])).rowCount).toBe(0);
      const pages=await repository.system("SELECT request_id,credit_state FROM ebay_market_price_pages WHERE search_id=$1",[created.json().searchId]);
      expect(pages.rows).toEqual([{request_id:null,credit_state:"reserved"}]);
    }finally{
      await repository.system("INSERT INTO ebay_retention_policies(organization_id,content_days,approved_at,approved_by_membership_id) VALUES($1,90,now(),$2)",[developmentIds.organizationId,developmentIds.managerMembershipId]);
    }
  });
  it("retains the charge but prevents candidate publication if policy is withdrawn during acquisition",async()=>{
    const providers=createLocalProviders(),delegate=providers.soldgraph!;
    const guardedWorker=new WorkerProcessor(workerRepository,{...providers,soldgraph:{
      async submit(request,key){
        const result=await delegate.submit(request,key);
        await repository.system("DELETE FROM ebay_retention_policies WHERE organization_id=$1",[developmentIds.organizationId]);
        return result;
      },poll:id=>delegate.poll(id),
    }},"synthetic-retention-publication");
    const created=await app.inject({method:"POST",url:"/api/v1/market-price/ebay/searches",headers:header(),payload:{...await input(),markets:["us"]}});
    expect(created.statusCode).toBe(202);
    try{
      expect(await guardedWorker.process(created.json().jobId)).toBe("succeeded");
      const pages=await repository.system("SELECT state,credit_state,credits,charged_at FROM ebay_market_price_pages WHERE search_id=$1",[created.json().searchId]);
      expect(pages.rows[0]).toMatchObject({state:"blocked",credit_state:"charged",credits:1});
      expect(pages.rows[0]!.charged_at).not.toBeNull();
      expect((await repository.system("SELECT 1 FROM ebay_market_price_observations WHERE search_id=$1",[created.json().searchId])).rowCount).toBe(0);
    }finally{
      await repository.system("INSERT INTO ebay_retention_policies(organization_id,content_days,approved_at,approved_by_membership_id) VALUES($1,90,now(),$2)",[developmentIds.organizationId,developmentIds.managerMembershipId]);
    }
  });
  it("purges expired content and replay bodies, retains charge anchors, and skips active work",async()=>{
    await repository.system("UPDATE soldgraph_accounts SET credit_budget=1000,usage_remaining=1000 WHERE id=$1",[accountId]);
    const create=async()=>{
      const operationKey=randomUUID(),payload={...await input(),markets:["us"]};
      const response=await app.inject({method:"POST",url:"/api/v1/market-price/ebay/searches",headers:header(operationKey),payload});
      expect(response.statusCode).toBe(202);return {...response.json() as {searchId:string;jobId:string},operationKey,payload};
    };
    const complete=await create();expect(await worker.process(complete.jobId)).toBe("succeeded");
    const detail=await app.inject({method:"GET",url:`/api/v1/market-price/ebay/searches/${complete.searchId}`,headers:header()});
    const confirmed=await app.inject({method:"POST",url:`/api/v1/market-price/ebay/searches/${complete.searchId}/confirm`,headers:header(),payload:{expectedLockVersion:detail.json().lockVersion}});
    expect(confirmed.statusCode).toBe(201);
    const unresolved=await create(),active=await create();
    await repository.system("UPDATE jobs SET status='failed' WHERE id=$1",[unresolved.jobId]);
    await repository.system("UPDATE ebay_market_price_searches SET status='blocked' WHERE id=$1",[unresolved.searchId]);
    await repository.system("UPDATE ebay_market_price_pages SET state='unknown',credit_state='unknown',request_id='synthetic-retained-request' WHERE search_id=$1",[unresolved.searchId]);
    await repository.system("UPDATE ebay_market_price_searches SET created_at=now()-interval '91 days' WHERE id=ANY($1::uuid[])",[[complete.searchId,unresolved.searchId,active.searchId]]);
    const ledger=await repository.system("SELECT credit_state,credits,charged_at FROM ebay_market_price_pages WHERE search_id=$1",[complete.searchId]);
    const retentionJob=randomUUID();
    await repository.system("INSERT INTO jobs(id,organization_id,job_type,entity_type,entity_id,idempotency_key,input_hash,input_redacted,requested_by_membership_id) VALUES($1,$2,'retention_scan','organization',$2,$3,$4,'{\"actor_type\":\"system\"}',$2)",[retentionJob,developmentIds.organizationId,`synthetic-retention-${retentionJob}`,"e".repeat(64)]);
    expect(await worker.process(retentionJob)).toBe("succeeded");
    const audit=await repository.system("SELECT metadata_redacted FROM audit_events WHERE organization_id=$1 AND action='market_price.ebay.content_purged' ORDER BY occurred_at DESC LIMIT 1",[developmentIds.organizationId]);
    expect(audit.rows[0]!.metadata_redacted).toEqual({count:2});
    expect((await workerRepository.system("SELECT purge_expired_ebay_content($1,100) count",[developmentIds.organizationId])).rows[0]!.count).toBe(0);
    const after=await repository.system("SELECT credit_state,credits,charged_at FROM ebay_market_price_pages WHERE search_id=$1",[complete.searchId]);
    expect(after.rows).toEqual(ledger.rows);
    const held=await repository.system("SELECT request_json,normalized_result_json,request_id,credit_state FROM ebay_market_price_pages WHERE search_id=$1",[unresolved.searchId]);
    expect(held.rows[0]).toEqual({request_json:{},normalized_result_json:null,request_id:"synthetic-retained-request",credit_state:"unknown"});
    for(const id of [complete.searchId,unresolved.searchId]){
      expect((await app.inject({method:"GET",url:`/api/v1/market-price/ebay/searches/${id}`,headers:header()})).statusCode).toBe(404);
      expect((await repository.system("SELECT count(*)::int count FROM ebay_market_price_observations WHERE search_id=$1",[id])).rows[0]!.count).toBe(0);
      expect((await repository.system("SELECT count(*)::int count FROM ebay_market_price_results WHERE search_id=$1",[id])).rows[0]!.count).toBe(0);
    }
    const replay=await repository.system("SELECT response_body_redacted FROM idempotency_records WHERE resource_id=$1",[complete.searchId]);
    expect(replay.rows.length).toBeGreaterThan(0);expect(replay.rows.every(row=>JSON.stringify(row.response_body_redacted)==="{}")).toBe(true);
    const repeated=await app.inject({method:"POST",url:"/api/v1/market-price/ebay/searches",headers:header(complete.operationKey),payload:complete.payload});
    expect(repeated.statusCode).toBe(404);
    const list=await app.inject({method:"GET",url:"/api/v1/market-price/ebay/searches",headers:header()});
    expect(list.json().items.some((item:{id:string})=>item.id===complete.searchId||item.id===unresolved.searchId)).toBe(false);
    expect((await app.inject({method:"GET",url:`/api/v1/market-price/ebay/searches/${active.searchId}`,headers:header()})).statusCode).toBe(200);
    const operational=await workerRepository.system("SELECT job_id FROM soldgraph_operational_candidates()");
    expect(operational.rows.some(row=>row.job_id===complete.jobId)).toBe(false);
    expect(operational.rows.some(row=>row.job_id===unresolved.jobId)).toBe(true);
    expect((await repository.system("SELECT has_function_privilege('hanamaru_api','purge_expired_ebay_content(uuid,integer)','EXECUTE') allowed")).rows[0]!.allowed).toBe(false);
  });
});
