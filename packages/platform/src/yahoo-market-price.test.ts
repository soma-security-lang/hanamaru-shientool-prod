import {describe,expect,it,vi} from "vitest";
import {generateYahooClosedSearchUrl} from "@hanamaru/market-price";
import {createYahooMarketPriceSourceProvider} from "./gcp.js";

const url=generateYahooClosedSearchUrl({keyword:"Canon EOS R6",conditionIds:[4],sort:"ENDED_AT_NEWEST",pageSize:100,offset:1}).url;

describe("Yahoo market-price source provider",()=>{
  it("fetches only the validated closed-search specification",async()=>{
    const fetcher=vi.fn(async()=>new Response("<html>fixture</html>",{status:200,headers:{"content-type":"text/html"}}));
    const result=await createYahooMarketPriceSourceProvider(fetcher as typeof fetch).fetchPage(url);
    expect(result).toMatchObject({status:200,body:"<html>fixture</html>"});
    expect(fetcher).toHaveBeenCalledWith(url,expect.objectContaining({method:"GET",redirect:"manual"}));
  });

  it("rejects a redirect that changes the semantic search",async()=>{
    const changed=url.replace("Canon+EOS+R6","different");
    const fetcher=vi.fn(async()=>new Response(null,{status:302,headers:{location:changed}}));
    await expect(createYahooMarketPriceSourceProvider(fetcher as typeof fetch).fetchPage(url)).rejects.toThrow(/different search specification/u);
  });

  it("stops on access blocking instead of attempting a bypass",async()=>{
    const fetcher=vi.fn(async()=>new Response("blocked",{status:403}));
    await expect(createYahooMarketPriceSourceProvider(fetcher as typeof fetch).fetchPage(url)).rejects.toThrow(/YAHOO_ACCESS_BLOCKED/u);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
