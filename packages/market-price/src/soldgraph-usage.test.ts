import {describe,expect,it} from "vitest";
import {parseSoldgraphUsage,soldgraphAvailableAllowance} from "./soldgraph-usage.js";

const base={plan:"free",used:12,limit:100,remaining:88,extra_requests:1000,window:"one_time",shared_allowance:true,rate_limit_per_minute:60};
describe("Soldgraph usage (synthetic official-schema responses)",()=>{
  it("keeps new Free one-time and grandfathered/purchased rolling allowances distinct",()=>{
    expect(parseSoldgraphUsage(base)).toEqual({plan:"free",used:12,limit:100,remaining:88,extraRequests:1000,window:"one_time",sharedAllowance:true,rateLimitPerMinute:60});
    expect(parseSoldgraphUsage({...base,window:"rolling_30_days"}).window).toBe("rolling_30_days");
    expect(parseSoldgraphUsage({...base,plan:"pro",used:15000,limit:20000,remaining:5000,window:"rolling_30_days",shared_allowance:false}).remaining).toBe(5000);
  });
  it("does not authorize purchased extra requests merely because they exist",()=>{
    const usage=parseSoldgraphUsage(base);
    expect(soldgraphAvailableAllowance(usage,false)).toBe(88);
    expect(soldgraphAvailableAllowance(usage,true)).toBe(1088);
    expect(soldgraphAvailableAllowance(parseSoldgraphUsage({...base,used:100,remaining:0}),false)).toBe(0);
  });
  it("keeps unlimited null unverified rather than zero or infinity and strips extra source fields",()=>{
    const usage=parseSoldgraphUsage({...base,limit:null,remaining:null,private_body:"SYNTHETIC DO NOT RETAIN"});
    expect(soldgraphAvailableAllowance(usage,true)).toBeNull();expect(usage).not.toHaveProperty("private_body");
  });
  it.each([null,[],{}, {...base,used:-1},{...base,used:1.5},{...base,used:"12"},{...base,remaining:89},
    {...base,remaining:null},{...base,limit:null},{...base,window:"calendar_month"},{...base,window:"billing_renewal"},
    {...base,extra_requests:-1},{...base,shared_allowance:1},{...base,rate_limit_per_minute:0},{...base,plan:"PRIVATE RAW MESSAGE"},
    {...base,limit:Number.MAX_SAFE_INTEGER+1}])("rejects malformed or inconsistent usage without source body",raw=>{
    expect(()=>parseSoldgraphUsage(raw)).toThrow("SOLDGRAPH_USAGE_INVALID");
  });
  it("rejects an unsafe sum of authorized additional and normal allowance",()=>{
    const usage=parseSoldgraphUsage({...base,used:0,limit:Number.MAX_SAFE_INTEGER,remaining:Number.MAX_SAFE_INTEGER});
    expect(()=>soldgraphAvailableAllowance(usage,true)).toThrow("SOLDGRAPH_USAGE_INVALID");
  });
});
