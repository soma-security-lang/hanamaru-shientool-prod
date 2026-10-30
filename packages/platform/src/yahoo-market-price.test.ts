import {describe,expect,it,vi} from "vitest";
import {generateYahooClosedSearchUrl} from "@hanamaru/market-price";
import {createYahooMarketPriceSourceProvider} from "./gcp.js";

const url=generateYahooClosedSearchUrl({keyword:"Canon EOS R6",conditionIds:[4],sort:"ENDED_AT_NEWEST",pageSize:100,offset:1}).url;
const emptyResult=(totalResultsAvailable=0,items:unknown[]=[])=>`<html><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({props:{pageProps:{initialState:{search:{items:{listing:{items,totalResultsAvailable,metadata:{sort:"-END_TIME",limit:100}}}}}}}})}</script></html>`;

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

  it("accepts Yahoo's HTTP 404 only when the strict search contract proves zero results",async()=>{
    const body=emptyResult();const fetcher=vi.fn(async()=>new Response(body,{status:404}));
    await expect(createYahooMarketPriceSourceProvider(fetcher as typeof fetch).fetchPage(url)).resolves.toMatchObject({status:404,body});
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["plain missing page","<html>該当する商品はありません</html>"],
    ["nonzero total",emptyResult(1)],
    ["unexpected sort",emptyResult().replace("-END_TIME","END_TIME")],
    ["unexpected page size",emptyResult().replace('"limit":100','"limit":20')],
    ["CAPTCHA",emptyResult()+"画像認証"],
  ])("never treats a 404 %s as a successful empty search",async(_name,body)=>{
    const fetcher=vi.fn(async()=>new Response(body,{status:404}));
    await expect(createYahooMarketPriceSourceProvider(fetcher as typeof fetch).fetchPage(url)).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("does not reinterpret a forbidden response even if its body resembles zero results",async()=>{
    const fetcher=vi.fn(async()=>new Response(emptyResult(),{status:403}));
    await expect(createYahooMarketPriceSourceProvider(fetcher as typeof fetch).fetchPage(url)).rejects.toThrow("YAHOO_ACCESS_BLOCKED");
  });
});
