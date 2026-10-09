import {describe,expect,it,vi} from "vitest";
import {createConfiguredSoldgraphProvider} from "./soldgraph.js";

const environment={SOLDGRAPH_ALLOW_EXTERNAL_REQUESTS:"true",SOLDGRAPH_ACCOUNT_ID:"00000000-0000-4000-8000-000000000001",SOLDGRAPH_API_KEY:"synthetic-only-key"};
describe("Soldgraph deployment permission (no external calls)",()=>{
  it.each([undefined,"false"])("defaults to no adapter and never reads a secret when permission is %s",permission=>{
    const transport=vi.fn<typeof fetch>();
    const disabled={SOLDGRAPH_ALLOW_EXTERNAL_REQUESTS:permission,get SOLDGRAPH_API_KEY():string{throw new Error("SECRET_MUST_NOT_BE_READ");}};
    expect(createConfiguredSoldgraphProvider(disabled,transport)).toBeUndefined();expect(transport).not.toHaveBeenCalled();
  });
  it.each(["TRUE","1","yes",""])("rejects ambiguous permission %s",permission=>{
    expect(()=>createConfiguredSoldgraphProvider({...environment,SOLDGRAPH_ALLOW_EXTERNAL_REQUESTS:permission},vi.fn<typeof fetch>())).toThrow("CONFIGURATION");
  });
  it.each([{SOLDGRAPH_API_KEY:undefined},{SOLDGRAPH_API_KEY:"key with space"},{SOLDGRAPH_ACCOUNT_ID:undefined},{SOLDGRAPH_ACCOUNT_ID:"other-account"}])("fails closed on enabled misconfiguration %j",override=>{
    const transport=vi.fn<typeof fetch>();
    expect(()=>createConfiguredSoldgraphProvider({...environment,...override},transport)).toThrow("CONFIGURATION");expect(transport).not.toHaveBeenCalled();
  });
  it("constructs the real adapter without usage refresh, submission or startup I/O",()=>{
    const transport=vi.fn<typeof fetch>();
    const provider=createConfiguredSoldgraphProvider(environment,transport);
    expect(provider?.submit).toBeTypeOf("function");expect(provider?.poll).toBeTypeOf("function");expect(provider?.usage).toBeTypeOf("function");expect(transport).not.toHaveBeenCalled();
  });
});
