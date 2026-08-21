import {describe,expect,it,vi} from "vitest";
import {scanOperations} from "./operations.js";

describe("operations scan",()=>{
  it("upserts PII-free alerts, resolves stale rows, and records the scan",async()=>{
    const system=vi.fn()
      .mockResolvedValueOnce({rows:[{organization_id:"org",membership_id:"member",job_id:"job",job_type:"transcribe",failure_class:"STT_HEARTBEAT_STALE",severity:"warning",attempt:2,max_attempts:200,oldest_age_seconds:240}]})
      .mockResolvedValueOnce({rows:[{organization_id:"org",membership_id:"member",branch_id:"branch"}]});
    const statements:string[]=[];
    const query=vi.fn(async(sql:string)=>{statements.push(sql);return{rows:[],rowCount:1};});
    const repository={system,withContext:vi.fn(async(_ctx:unknown,operation:(tx:{query:typeof query})=>Promise<unknown>)=>operation({query}))};
    const alerts=await scanOperations(repository as never);
    expect(alerts).toEqual([{organizationId:"org",jobId:"job",jobType:"transcribe",failureClass:"STT_HEARTBEAT_STALE",severity:"warning",attempt:2,maxAttempts:200,oldestAgeSeconds:240}]);
    expect(statements.some(sql=>sql.includes("UPDATE operational_alerts SET status='resolved'"))).toBe(true);
    expect(statements.some(sql=>sql.includes("INSERT INTO operational_alerts"))).toBe(true);
    expect(statements.some(sql=>sql.includes("INSERT INTO operations_scan_runs"))).toBe(true);
    expect(repository.withContext).toHaveBeenCalledWith(expect.objectContaining({organizationId:"org",membershipId:"member",branchId:"branch"}),expect.any(Function));
  });
});
