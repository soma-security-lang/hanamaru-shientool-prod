import { createHash,randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { afterAll,beforeAll,describe,expect,it } from "vitest";
import { createPool,developmentIds,HanamaruRepository } from "@hanamaru/database";
import { createLocalProviders } from "@hanamaru/platform";
import { WorkerProcessor } from "../../worker/src/processor.js";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";

const databaseUrl=process.env.DATABASE_URL;
const idem=()=>({"idempotency-key":randomUUID(),"x-dev-role":"manager"});
const pageHtml=(items:unknown[],totalResultsAvailable=items.length)=>`<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({props:{pageProps:{initialState:{search:{items:{listing:{items,totalResultsAvailable,metadata:{sort:"-END_TIME",limit:100}}}}}}}})}</script>`;

describe.skipIf(!databaseUrl)("market price API and worker",()=>{
  let app:FastifyInstance;let repository:HanamaruRepository;let worker:WorkerProcessor;let fetchMarketPage:(url:string)=>Promise<{status:number;body:string;retryAfterSeconds:null;fetchedAt:string}>;
  beforeAll(async()=>{
    const now=Date.now();const prices=[10_000,10_500,11_000,11_500,12_000,100_000];
    const items=prices.map((price,index)=>({auctionId:`market-${index}`,title:"Canon EOS R6 ボディ",price,endTime:new Date(now-index*60_000).toISOString(),itemCondition:"USED20",taxFlag:0,isFleamarketItem:false,category:{id:23632},brandId:100614}));
    fetchMarketPage=async()=>({status:200,body:pageHtml(items),retryAfterSeconds:null,fetchedAt:new Date().toISOString()});
    const providers=createLocalProviders();providers.marketPriceSource={fetchPage:(url)=>fetchMarketPage(url)};
    repository=new HanamaruRepository(createPool(databaseUrl));app=await buildApp({repository:new HanamaruRepository(createPool(databaseUrl)),providers,config:{...loadConfig({NODE_ENV:"test",ALLOW_DEV_AUTH:"true"}),port:0}});worker=new WorkerProcessor(repository,providers,"market-price-integration");
    await repository.system("UPDATE feature_flags SET enabled=true WHERE organization_id=$1 AND flag_key='market_price_search'",[developmentIds.organizationId]);
  });
  afterAll(async()=>{await repository.system("UPDATE feature_flags SET enabled=false WHERE organization_id=$1 AND flag_key='market_price_search'",[developmentIds.organizationId]);await app.close();await repository.close();});

  async function createConfirmedIdentification(payload:Record<string,unknown>){
    const created=await app.inject({method:"POST",url:"/api/v1/market-price/identifications",headers:idem(),payload:{inputMode:"manual_direct",conditions:["good"],...payload}});
    expect(created.statusCode).toBe(201);
    const confirmed=await app.inject({method:"POST",url:`/api/v1/market-price/identifications/${created.json().id}/confirm`,headers:idem(),payload:{expectedLockVersion:created.json().lockVersion}});
    expect(confirmed.statusCode).toBe(200);
    return created;
  }

  it("returns a complete empty suggestion contract for manual-only identification",async()=>{
    const created=await app.inject({method:"POST",url:"/api/v1/market-price/identifications",headers:idem(),payload:{inputMode:"manual_direct",productName:"匿名テスト商品",searchQueries:[{id:"manual-query",keyword:"匿名テスト商品",breadth:"standard",source:"user",decision:"accepted"}],conditions:["good"]}});
    expect(created.statusCode).toBe(201);
    const fetched=await app.inject({method:"GET",url:`/api/v1/market-price/identifications/${created.json().id}`,headers:{"x-dev-role":"manager"}});
    expect(fetched.statusCode).toBe(200);
    expect(fetched.json().suggestions).toEqual({productCandidates:[],searchQueries:[],excludeKeywords:[],suggestedConditions:[],warnings:[]});
  });

  it("normalizes image uploads and persists explicit AI proposal decisions",async()=>{
    const png=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEUlEQVQImWMIyOv5D8IMMAYATgAJJbPQh8gAAAAASUVORK5CYII=","base64");
    const digest=createHash("sha256").update(png).digest("hex");
    const created=await app.inject({method:"POST",url:"/api/v1/market-price/identifications",headers:idem(),payload:{inputMode:"image_assisted",productName:"",category:null,brand:null,modelNumber:null,attributes:{},searchQueries:[],excludeKeywords:[],conditions:["unspecified"]}});expect(created.statusCode).toBe(201);
    const start=await app.inject({method:"POST",url:`/api/v1/market-price/identifications/${created.json().id}/image-uploads`,headers:idem(),payload:{mimeType:"image/png",sizeBytes:png.byteLength,sha256:digest}});expect(start.statusCode).toBe(201);expect(start.json()).not.toHaveProperty("visitId");
    expect((await app.inject({method:"PUT",url:start.json().url,headers:{"content-type":"image/png","x-dev-role":"manager"},payload:png})).statusCode).toBe(200);
    expect((await app.inject({method:"POST",url:`/api/v1/market-price/image-uploads/${start.json().uploadId}/complete`,headers:idem(),payload:{}})).statusCode).toBe(201);
    const analysis=await app.inject({method:"POST",url:`/api/v1/market-price/identifications/${created.json().id}/analyze`,headers:idem(),payload:{}});expect(analysis.statusCode).toBe(202);
    const identificationOutcome=await worker.process(analysis.json().jobId);
    const identificationFailure=await repository.system<{error_detail_redacted:string|null}>("SELECT error_detail_redacted FROM jobs WHERE id=$1",[analysis.json().jobId]);
    expect(identificationOutcome,identificationFailure.rows[0]?.error_detail_redacted??"market price identification failed without a diagnostic").toBe("succeeded");
    const suggested=await app.inject({method:"GET",url:`/api/v1/market-price/identifications/${created.json().id}`,headers:{"x-dev-role":"manager"}});expect(suggested.json()).toMatchObject({status:"suggestion_ready",imageCount:1});
    const candidate=suggested.json().suggestions.productCandidates[0];const query=suggested.json().suggestions.searchQueries[0];
    const fields={...suggested.json().input,productName:candidate.productName,category:candidate.category,brand:candidate.brand,modelNumber:candidate.modelNumber,attributes:candidate.attributes,searchQueries:[{...query,decision:"accepted"}]};
    const updated=await app.inject({method:"PATCH",url:`/api/v1/market-price/identifications/${created.json().id}`,headers:idem(),payload:{expectedLockVersion:suggested.json().lockVersion,fields,suggestionDecisions:{productCandidates:[{id:candidate.id,decision:"accepted"}]}}});expect(updated.statusCode).toBe(200);
    const persisted=await app.inject({method:"GET",url:`/api/v1/market-price/identifications/${created.json().id}`,headers:{"x-dev-role":"manager"}});expect(persisted.json().suggestions.productCandidates[0].decision).toBe("accepted");
    expect((await app.inject({method:"POST",url:`/api/v1/market-price/identifications/${created.json().id}/confirm`,headers:idem(),payload:{expectedLockVersion:updated.json().lockVersion}})).statusCode).toBe(200);
    const image=await repository.system<{mime_type:string;expires_in:number}>("SELECT so.mime_type,extract(epoch FROM (i.expires_at-now()))::int expires_in FROM market_price_images i JOIN storage_objects so ON so.id=i.storage_object_id WHERE i.identification_id=$1",[created.json().id]);expect(image.rows[0]?.mime_type).toBe("image/webp");expect(image.rows[0]!.expires_in).toBeGreaterThan(23*60*60);
  });

  it("creates one selected-query job, computes rolling-90-day statistics, and serves a 24-hour cache hit",async()=>{
    const categoryMapping=await app.inject({method:"PUT",url:"/api/v1/admin/market-price/source-mappings/camera",headers:idem(),payload:{dimension:"category",sourceId:"23632",canonicalName:"カメラ",aliases:["デジタルカメラ"],status:"CONFIRMED",registryVersion:"test-v1"}});
    expect(categoryMapping.statusCode).toBe(200);
    const brandMapping=await app.inject({method:"PUT",url:"/api/v1/admin/market-price/source-mappings/canon",headers:idem(),payload:{dimension:"brand",sourceId:"100614",canonicalName:"Canon",aliases:["キヤノン"],status:"CONFIRMED",registryVersion:"test-v1"}});
    expect(brandMapping.statusCode).toBe(200);
    const mappings=await app.inject({method:"GET",url:"/api/v1/admin/market-price/source-mappings",headers:{"x-dev-role":"manager"}});expect(mappings.json().items).toHaveLength(2);
    const deniedMapping=await app.inject({method:"PUT",url:"/api/v1/admin/market-price/source-mappings/forbidden",headers:{...idem(),"x-dev-role":"assessor"},payload:{dimension:"brand",sourceId:"1",canonicalName:"禁止確認",aliases:[],status:"CONFIRMED",registryVersion:"test-v1"}});expect(deniedMapping.statusCode).toBe(403);
    const identification=await createConfirmedIdentification({productName:"Canon EOS R6",category:"デジタルカメラ",brand:"キヤノン",searchQueries:[{id:"standard",keyword:"Canon EOS R6 ボディ",breadth:"standard",source:"user",decision:"accepted"}]});
    const payload={identificationId:identification.json().id,selectedSearchQueryId:"standard",conditions:["good"],outlierPolicy:{enabled:true,deviationThreshold:.2,minimumGroupSize:5}};
    const accepted=await app.inject({method:"POST",url:"/api/v1/market-price/searches",headers:idem(),payload});expect(accepted.statusCode).toBe(202);
    const outcome=await worker.process(accepted.json().jobId);
    const jobFailure=await repository.system<{error_detail_redacted:string|null}>("SELECT error_detail_redacted FROM jobs WHERE id=$1",[accepted.json().jobId]);
    expect(outcome,jobFailure.rows[0]?.error_detail_redacted??"market price job failed without a diagnostic").toBe("succeeded");
    const search=await app.inject({method:"GET",url:`/api/v1/market-price/searches/${accepted.json().searchId}`,headers:{"x-dev-role":"manager"}});expect(search.statusCode).toBe(200);
    expect(search.json()).toMatchObject({status:"ready",coverageStatus:"complete",periodDays:90,sortKey:"ENDED_AT_NEWEST",pageSize:100,candidateCount:6,includedCount:5,minimumPrice:10000,medianPriceBeforeOutlierExclusion:11250,medianPrice:11000,maximumPrice:12000});
    expect(search.json().aiParameterPlanJson).toMatchObject({categoryRegistryKey:"camera",brandRegistryKey:"canon"});
    expect(search.json().candidates.find((candidate:{closingPrice:number})=>candidate.closingPrice===100000)).toMatchObject({autoOutlier:true,included:false});
    const job=await app.inject({method:"GET",url:`/api/v1/jobs/${accepted.json().jobId}`,headers:{"x-dev-role":"manager"}});expect(job.json().resultResource).toEqual({type:"market_price_search",id:accepted.json().searchId,href:`/api/v1/market-price/searches/${accepted.json().searchId}`});
    const cached=await app.inject({method:"POST",url:"/api/v1/market-price/searches",headers:idem(),payload});expect(cached.statusCode).toBe(200);expect(cached.json()).toMatchObject({searchId:accepted.json().searchId,cacheHit:true});
    const firstIncluded=search.json().candidates.find((candidate:{included:boolean})=>candidate.included);
    const excluded=await app.inject({method:"PATCH",url:`/api/v1/market-price/searches/${accepted.json().searchId}/candidates/${firstIncluded.id}`,headers:idem(),payload:{decision:"exclude"}});expect(excluded.json().statistics).toMatchObject({candidateCount:6,includedCount:4,medianPriceBeforeOutlierExclusion:11250});
    const restored=await app.inject({method:"PATCH",url:`/api/v1/market-price/searches/${accepted.json().searchId}/candidates/${firstIncluded.id}`,headers:idem(),payload:{decision:"automatic"}});expect(restored.json().statistics).toMatchObject({includedCount:5});
    const recalculated=await app.inject({method:"PATCH",url:`/api/v1/market-price/searches/${accepted.json().searchId}/outlier-policy`,headers:idem(),payload:{enabled:true,deviationThreshold:.25,minimumGroupSize:5}});expect(recalculated.statusCode).toBe(200);expect(recalculated.json().statistics).toMatchObject({candidateCount:6,includedCount:5,medianPrice:11000});
    const fresh=await app.inject({method:"GET",url:`/api/v1/market-price/searches/${accepted.json().searchId}`,headers:{"x-dev-role":"manager"}});
    const confirmed=await app.inject({method:"POST",url:`/api/v1/market-price/searches/${accepted.json().searchId}/confirm`,headers:idem(),payload:{expectedLockVersion:fresh.json().lockVersion}});expect(confirmed.statusCode).toBe(201);expect(confirmed.json()).toMatchObject({snapshotVersion:1,medianPriceBeforeOutlierExclusion:11250,medianPrice:11000,includedCount:5});
    await expect(repository.system("UPDATE market_price_results SET median_price=1 WHERE id=$1",[confirmed.json().id])).rejects.toThrow(/immutable/);
    const systemAdmin=await app.inject({method:"GET",url:`/api/v1/market-price/searches/${accepted.json().searchId}`,headers:{"x-dev-role":"system_admin"}});expect(systemAdmin.statusCode).toBe(403);
  });

  it("resumes from the first unfinished 100-item page after a temporary fetch failure",async()=>{
    const identification=await createConfirmedIdentification({productName:"Nikon Z8",category:null,brand:null,searchQueries:[{id:"resume-case",keyword:"Nikon Z8 ボディ",breadth:"standard",source:"user",decision:"accepted"}]});
    const started=Date.now();const item=(index:number)=>({auctionId:`resume-${index}`,title:"Nikon Z8 ボディ",price:300_000+(index%5)*1_000,endTime:new Date(started-index*60_000).toISOString(),itemCondition:"USED20",taxFlag:0,isFleamarketItem:false});
    let secondPageAttempts=0;const requestedOffsets:number[]=[];
    fetchMarketPage=async value=>{const offset=Number(new URL(value).searchParams.get("b"));requestedOffsets.push(offset);if(offset===1)return{status:200,body:pageHtml(Array.from({length:100},(_,index)=>item(index)),102),retryAfterSeconds:null,fetchedAt:new Date().toISOString()};if(offset===101&&secondPageAttempts++===0)throw new Error("PROVIDER_TEMPORARY: fixture interruption");return{status:200,body:pageHtml([item(100),item(101)],102),retryAfterSeconds:null,fetchedAt:new Date().toISOString()};};
    const accepted=await app.inject({method:"POST",url:"/api/v1/market-price/searches",headers:idem(),payload:{identificationId:identification.json().id,selectedSearchQueryId:"resume-case",conditions:["good"],outlierPolicy:{enabled:false,deviationThreshold:.2,minimumGroupSize:5}}});
    expect(await worker.process(accepted.json().jobId)).toBe("retry_wait");
    expect((await repository.system<{count:number}>("SELECT count(*)::int count FROM market_price_search_pages WHERE search_id=$1 AND status='succeeded'",[accepted.json().searchId])).rows[0]?.count).toBe(1);
    await repository.system("UPDATE jobs SET available_at=now() WHERE id=$1",[accepted.json().jobId]);
    expect(await worker.process(accepted.json().jobId)).toBe("succeeded");
    expect(requestedOffsets.filter(offset=>offset===1)).toHaveLength(1);
    const result=await app.inject({method:"GET",url:`/api/v1/market-price/searches/${accepted.json().searchId}`,headers:{"x-dev-role":"manager"}});
    expect(result.json()).toMatchObject({status:"ready",coverageStatus:"complete",candidateCount:102,includedCount:102});
  });

  it("checks the kill switch between pages and stops before another Yahoo request",async()=>{
    const identification=await createConfirmedIdentification({productName:"Sony α7 IV",category:null,brand:null,searchQueries:[{id:"kill-switch-case",keyword:"Sony α7 IV ボディ",breadth:"standard",source:"user",decision:"accepted"}]});
    const started=Date.now(),offsets:number[]=[];const items=Array.from({length:100},(_,index)=>({auctionId:`kill-${index}`,title:"Sony α7 IV ボディ",price:200_000,endTime:new Date(started-index*60_000).toISOString(),itemCondition:"USED20",taxFlag:0,isFleamarketItem:false}));
    fetchMarketPage=async value=>{offsets.push(Number(new URL(value).searchParams.get("b")));await repository.system("UPDATE feature_flags SET enabled=false WHERE organization_id=$1 AND flag_key='market_price_search'",[developmentIds.organizationId]);return{status:200,body:pageHtml(items,200),retryAfterSeconds:null,fetchedAt:new Date().toISOString()};};
    try{
      const accepted=await app.inject({method:"POST",url:"/api/v1/market-price/searches",headers:idem(),payload:{identificationId:identification.json().id,selectedSearchQueryId:"kill-switch-case",conditions:["good"],outlierPolicy:{enabled:false,deviationThreshold:.2,minimumGroupSize:5}}});
      expect(await worker.process(accepted.json().jobId)).toBe("failed");expect(offsets).toEqual([1]);
      const state=await repository.system<{status:string;coverage_status:string;failure_class:string}>("SELECT status,coverage_status,failure_class FROM market_price_searches WHERE id=$1",[accepted.json().searchId]);
      expect(state.rows[0]).toEqual({status:"blocked",coverage_status:"blocked",failure_class:"MARKET_PRICE_KILL_SWITCH"});
    }finally{await repository.system("UPDATE feature_flags SET enabled=true WHERE organization_id=$1 AND flag_key='market_price_search'",[developmentIds.organizationId]);}
  });
});
