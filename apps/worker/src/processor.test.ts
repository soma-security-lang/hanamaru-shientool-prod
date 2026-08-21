import {describe,expect,it,vi} from "vitest";
import {dispatchOnce,enqueueRetentionScans} from "./dispatcher.js";
import {aggregateReviewChunks,classifyFailure,cleanupExpiredUploadObjects,driveCopyObjectName,reviewChunks,transcriptQualityInputChunks,transcriptQualityMetrics} from "./processor.js";
describe("dispatcher",()=>{it("publishes claimed outbox events once",async()=>{const system=vi.fn().mockResolvedValueOnce({rows:[{id:"e",event_type:"job.dispatch",aggregate_id:"j",payload_redacted:{job_type:"review"}}],rowCount:1}).mockResolvedValueOnce({rows:[],rowCount:0});const dispatch=vi.fn().mockResolvedValue({taskName:"task/j"});await expect(dispatchOnce({system} as never,{dispatch})).resolves.toEqual({claimed:1,published:1});expect(dispatch).toHaveBeenCalledWith("j","review","e");expect(system).toHaveBeenCalledTimes(2);});});
describe("retention scheduler",()=>{it("returns the number of tenant scans created",async()=>{const system=vi.fn().mockResolvedValue({rows:[{created:2}]});await expect(enqueueRetentionScans({system} as never)).resolves.toEqual({created:2});});});
describe("Drive object names",()=>{it("uses a different write-once object for every copy attempt",()=>{const prefix="organizations/org/visits/visit/recordings/import/copies/";const first=driveCopyObjectName("org","visit","import","copy-1");const second=driveCopyObjectName("org","visit","import","copy-2");expect(first).toBe(`${prefix}copy-1/source`);expect(second).toBe(`${prefix}copy-2/source`);expect(first).not.toBe(second);});});
describe("long review chunking",()=>{
  it("splits only between transcript segments and keeps every segment once",()=>{const segments=[{id:"s1",text:"a".repeat(8),sequence_no:1},{id:"s2",text:"b".repeat(8),sequence_no:2},{id:"s3",text:"c".repeat(8),sequence_no:3}];const chunks=reviewChunks(segments,18);expect(chunks.map(chunk=>chunk.map(segment=>segment.id))).toEqual([["s1","s2"],["s3"]]);expect(chunks.flat()).toEqual(segments);});
  it("aggregates six categories while retaining original evidence ids",()=>{const categories=["strength","improvement","talk","compliance","next_action","revisit"];const result=(suffix:string)=>({model:"gemini-2.5-flash",summary:`summary-${suffix}`,findings:categories.map(category=>({category,title:`${category}-${suffix}`,description:`description-${suffix}`,recommendedAction:null,evidenceSegmentIds:[`segment-${suffix}`]}))});const combined=aggregateReviewChunks([result("1"),result("2")]);expect(combined.findings).toHaveLength(6);expect(combined.findings[0]?.evidenceSegmentIds).toEqual(["segment-1","segment-2"]);expect(combined.summary).toContain("summary-2");});
  it("keeps at most three talks and selects the strongest revisit signal across chunks",()=>{const finding=(category:string,title:string,description:string,id:string)=>({category,title,description,recommendedAction:null,evidenceSegmentIds:[id]});const common=(id:string)=>[finding("strength","良かった点","良い",id),finding("improvement","改善","改善",id),finding("next_action","次回","助言",id)];const first={model:"model",summary:"one",findings:[...common("s1"),finding("talk","トーク","【場面1】トーク1\n【場面2】トーク2","s1"),finding("compliance","法令","告知: ✅ 済\nクーリングオフ: ❌ 未確認\n書面交付: ❌ 未確認\n押し買い: ✅ 問題なし","s1"),finding("revisit","再訪問・アポ可能性：低","判定: 低\n理由: シグナルなし\n該当パターン: なし","s1")]};const second={model:"model",summary:"two",findings:[...common("s2"),finding("talk","トーク","【場面3】トーク3\n【場面4】トーク4","s2"),finding("compliance","法令","告知: ✅ 済\nクーリングオフ: ✅ 8日間を説明\n書面交付: ⚠️ 説明のみ\n押し買い: ✅ 問題なし","s2"),finding("revisit","再訪問・アポ可能性：高","判定: 高\n理由: 来週の再訪に合意\n該当パターン: 次回合意あり","s2")]};const combined=aggregateReviewChunks([first,second]);expect(combined.findings.find(item=>item.category==="talk")?.description.split("\n")).toHaveLength(3);expect(combined.findings.find(item=>item.category==="compliance")?.description).toContain("クーリングオフ: ✅");expect(combined.findings.find(item=>item.category==="revisit")?.title).toContain("高");});
});
describe("transcript quality",()=>{
  it("normalizes and bounds only the model input while keeping request chunks finite",()=>{
    const original=`  Ａ${"x".repeat(1200)}  `;
    const segments=Array.from({length:161},(_,index)=>({id:String(index),start_ms:index,end_ms:index+1,speaker_label:"chunk-000:1",text:original}));
    const chunks=transcriptQualityInputChunks(segments);
    expect(chunks.map(chunk=>chunk.length)).toEqual([160,1]);
    expect(chunks[0]?.[0]?.text.startsWith("A")).toBe(true);
    expect(chunks[0]?.[0]?.text.length).toBe(1000);
    expect(segments[0]?.text).toBe(original);
  });
  it("counts labels inside each chunk instead of treating the suffix as a global person id",()=>{
    const metrics=transcriptQualityMetrics([
      {id:"1",start_ms:0,end_ms:1000,speaker_label:"chunk-000:1",text:"a"},
      {id:"2",start_ms:900,end_ms:2000,speaker_label:"chunk-000:2",text:"b"},
      {id:"3",start_ms:3000,end_ms:4000,speaker_label:"chunk-001:1",text:"c"},
    ],5000);
    expect(metrics).toEqual({segmentCount:3,chunkCount:2,maxLabelsPerChunk:2,speechOccupancyRatio:.6});
  });
  it("classifies contract and evidence failures for structured monitoring",()=>{
    expect(classifyFailure(new Error("review evidence references an unknown segment"),false)).toBe("EVIDENCE_INVALID");
    expect(classifyFailure(new Error("model output contract failed"),false)).toBe("MODEL_OUTPUT_INVALID");
    expect(classifyFailure(new Error("timeout"),true)).toBe("PROVIDER_TEMPORARY");
  });
});
describe("expired incomplete uploads",()=>{
  it("deletes the untracked storage object and then removes the upload session",async()=>{
    let removed=false;
    const query=vi.fn(async(sql:string)=>{
      if(sql.includes("SELECT u.id,u.visit_id,u.object_name"))return removed?{rows:[],rowCount:0}:{rows:[{id:"upload-1",visit_id:"visit-1",object_name:"objects/upload-1"}],rowCount:1};
      if(sql.includes("SELECT u.id FROM upload_sessions"))return{rows:[{id:"upload-1"}],rowCount:1};
      if(sql.includes("INSERT INTO visit_deletion_fences"))return{rows:[{visit_id:"visit-1"}],rowCount:1};
      if(sql.includes("DELETE FROM upload_sessions")){removed=true;return{rows:[],rowCount:1};}
      return{rows:[],rowCount:0};
    });
    const repository={withContext:vi.fn(async(_ctx:unknown,callback:(tx:{query:typeof query})=>Promise<unknown>)=>callback({query}))};
    const deleteIncompleteUpload=vi.fn().mockResolvedValue(undefined);
    const storage={deleteIncompleteUpload};
    const deleted=await cleanupExpiredUploadObjects(repository as never,storage as never,{requestId:"request",traceId:"trace",organizationId:"org",membershipId:"member",branchId:"branch",roles:[],capabilities:[]} as never,{id:"job-1",organization_id:"org"});
    expect(deleted).toBe(1);
    expect(deleteIncompleteUpload).toHaveBeenCalledWith("objects/upload-1");
    expect(removed).toBe(true);
  });
  it("keeps the upload session retryable when storage deletion fails",async()=>{
    const statements:string[]=[];
    const query=vi.fn(async(sql:string)=>{
      statements.push(sql);
      if(sql.includes("SELECT u.id,u.visit_id,u.object_name"))return{rows:[{id:"upload-2",visit_id:"visit-2",object_name:"objects/upload-2"}],rowCount:1};
      if(sql.includes("SELECT u.id FROM upload_sessions"))return{rows:[{id:"upload-2"}],rowCount:1};
      if(sql.includes("INSERT INTO visit_deletion_fences"))return{rows:[{visit_id:"visit-2"}],rowCount:1};
      return{rows:[],rowCount:1};
    });
    const repository={withContext:vi.fn(async(_ctx:unknown,callback:(tx:{query:typeof query})=>Promise<unknown>)=>callback({query}))};
    const storage={deleteIncompleteUpload:vi.fn().mockRejectedValue(new Error("PROVIDER_TEMPORARY: storage unavailable"))};
    await expect(cleanupExpiredUploadObjects(repository as never,storage as never,{requestId:"request",traceId:"trace",organizationId:"org",membershipId:"member",branchId:"branch",roles:[],capabilities:[]} as never,{id:"job-2",organization_id:"org"})).rejects.toThrow("storage unavailable");
    expect(statements.some(sql=>sql.startsWith("DELETE FROM upload_sessions"))).toBe(false);
    expect(statements.some(sql=>sql.startsWith("DELETE FROM visit_deletion_fences WHERE"))).toBe(true);
  });
});
