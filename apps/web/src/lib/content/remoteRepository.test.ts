import {beforeEach,describe,expect,it,vi} from "vitest";
import {apiClient} from "@/lib/api/client";
import {RemoteContentRepository} from "./remoteRepository";

vi.mock("@/lib/api/client",()=>({apiClient:{request:vi.fn()}}));

const item=(id:string)=>({id,type:"talk" as const,stableKey:id,title:id,category:"基本",status:"draft",version:1});

describe("RemoteContentRepository",()=>{
  beforeEach(()=>vi.mocked(apiClient.request).mockReset());

  it("uses the previous cursor to load a later page without losing the full total",async()=>{
    vi.mocked(apiClient.request)
      .mockResolvedValueOnce({items:[item("one"),item("two")],total:1156,nextCursor:"two",hasMore:true})
      .mockResolvedValueOnce({items:[item("three"),item("four")],total:1156,nextCursor:"four",hasMore:true});
    const result=await new RemoteContentRepository().search({type:["talk"],page:2,pageSize:2});
    expect(result).toMatchObject({total:1156,hasMore:true,items:[{id:"three"},{id:"four"}]});
    expect(apiClient.request).toHaveBeenNthCalledWith(1,"/contents?limit=2&type=talk");
    expect(apiClient.request).toHaveBeenNthCalledWith(2,"/contents?limit=2&type=talk&cursor=two");
  });
});
