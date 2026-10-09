import {describe,expect,it,vi} from "vitest";
import {runSoldgraphUsageCommand} from "./soldgraph-usage-command.js";

const environment={SOLDGRAPH_USAGE_REFRESH_ENABLED:"true",SOLDGRAPH_ALLOW_EXTERNAL_REQUESTS:"true",PROVIDER_MODE:"gcp",DATABASE_URL:"synthetic-database",DATABASE_CONTEXT_ROLE:"hanamaru_worker",DATABASE_SYSTEM_ROLE:"hanamaru_worker_system",SOLDGRAPH_ACCOUNT_ID:"synthetic-account"};
function dependencies(){
  const close=vi.fn(async()=>{}),repository=vi.fn(()=>({close}) as never);
  const provider=vi.fn(()=>({usage:vi.fn(),submit:vi.fn(),poll:vi.fn()}) as never);
  return {close,repository,provider,refresh:vi.fn(async()=>{})};
}
describe("explicit usage operator command (injected only)",()=>{
  it.each([
    {SOLDGRAPH_USAGE_REFRESH_ENABLED:undefined},{SOLDGRAPH_ALLOW_EXTERNAL_REQUESTS:"false"},{PROVIDER_MODE:"local"},
    {DATABASE_URL:undefined},{DATABASE_CONTEXT_ROLE:"hanamaru_api"},{DATABASE_SYSTEM_ROLE:"hanamaru_api_system"},
  ])("rejects before any provider, database or refresh activity %j",async override=>{
    const dep=dependencies();await expect(runSoldgraphUsageCommand({...environment,...override},dep)).rejects.toThrow("DISABLED");
    expect(dep.provider).not.toHaveBeenCalled();expect(dep.repository).not.toHaveBeenCalled();expect(dep.refresh).not.toHaveBeenCalled();
  });
  it("requires a real configured provider rather than a fixture fallback",async()=>{
    const dep=dependencies();dep.provider.mockReturnValueOnce(undefined as never);
    await expect(runSoldgraphUsageCommand(environment,dep)).rejects.toThrow("CONFIGURATION");expect(dep.repository).not.toHaveBeenCalled();
  });
  it("runs exactly one explicit refresh and closes the database",async()=>{
    const dep=dependencies();await runSoldgraphUsageCommand(environment,dep);
    expect(dep.refresh).toHaveBeenCalledTimes(1);expect(dep.refresh).toHaveBeenCalledWith(expect.anything(),expect.anything(),"synthetic-account");expect(dep.close).toHaveBeenCalledOnce();
  });
  it("closes the database on a failed reconciliation without retrying",async()=>{
    const dep=dependencies();dep.refresh.mockRejectedValueOnce(new Error("synthetic failure"));
    await expect(runSoldgraphUsageCommand(environment,dep)).rejects.toThrow("synthetic failure");expect(dep.refresh).toHaveBeenCalledOnce();expect(dep.close).toHaveBeenCalledOnce();
  });
});
