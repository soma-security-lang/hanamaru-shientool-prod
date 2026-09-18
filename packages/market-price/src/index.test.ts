import { describe, expect, it } from "vitest";
import {
  generateYahooClosedSearchUrl,
  mapProductConditions,
  pageOffset,
  parseYahooClosedSearchHtml,
  parseYahooClosedSearchUrl,
  resolveYahooDimensionMapping,
  searchPeriod,
  YahooClosedSearchContractError,
  evaluateMarketPriceCandidates,
  createAucfanSearchRequest,
  parseAucfanSearchJson,
  AucfanSearchContractError,
  normalizeModelNumber,
  titleMatchesModelNumber,
} from "./index.js";

describe("Yahoo closed-search URL", () => {
  it("generates the canonical newest-first 100-item URL", () => {
    const generated = generateYahooClosedSearchUrl({
      keyword: "Ｃａｎｏｎ　EOS  R6 ボディ",
      categoryId: "23632",
      brandId: "100614",
      conditionIds: [5, 3, 4, 3],
      sort: "ENDED_AT_NEWEST",
      pageSize: 100,
      offset: 1,
    });
    expect(generated.url).toBe("https://auctions.yahoo.co.jp/closedsearch/closedsearch?p=Canon+EOS+R6+%E3%83%9C%E3%83%87%E3%82%A3&auccat=23632&brand_id=100614&istatus=3%2C4%2C5&select=6&n=100&b=1");
    expect(parseYahooClosedSearchUrl(generated.url)).toEqual({
      keyword: "Canon EOS R6 ボディ",
      categoryId: "23632",
      brandId: "100614",
      conditionIds: [3, 4, 5],
      sort: "ENDED_AT_NEWEST",
      pageSize: 100,
      offset: 1,
    });
  });

  it("maps product conditions and omits source filtering for unspecified", () => {
    expect(mapProductConditions(["near_unused", "good", "fair"])).toEqual([3, 4, 5]);
    expect(mapProductConditions(["good", "unspecified"])).toBeUndefined();
  });

  it("uses 100-item offsets and rejects unknown parameters", () => {
    expect([1, 2, 3].map(pageOffset)).toEqual([1, 101, 201]);
    expect(() => parseYahooClosedSearchUrl("https://auctions.yahoo.co.jp/closedsearch/closedsearch?p=x&select=6&n=100&b=1&raw=1")).toThrow(YahooClosedSearchContractError);
  });

  it("resolves only one confirmed, non-expired mapping", () => {
    const now = new Date("2026-09-09T00:00:00Z");
    expect(resolveYahooDimensionMapping("キヤノン", [{key:"canon",sourceId:"100614",canonicalName:"Canon",aliases:["キヤノン"],status:"CONFIRMED",verifiedAt:"2026-09-01T00:00:00Z"}], now)?.sourceId).toBe("100614");
    expect(resolveYahooDimensionMapping("Canon", [{key:"canon-old",sourceId:"1",canonicalName:"Canon",aliases:[],status:"DEPRECATED",verifiedAt:"2026-01-01T00:00:00Z"}], now)).toBeNull();
  });
});

describe("market candidate evaluation",()=>{
  it("applies period, condition, keyword and conservative median-IQR outlier rules",()=>{
    const make=(id:string,price:number,title="Canon R6",condition="good" as const)=>({sourceItemId:id,sourceType:"auction" as const,canonicalUrl:`https://auctions.yahoo.co.jp/jp/auction/${id}`,title,closingPrice:price,endedAt:"2026-09-01T00:00:00.000Z",sourceCondition:"USED20",normalizedCondition:condition,taxDisplay:"unknown" as const,categoryId:null,brandId:null,contentHash:id.padEnd(64,"0")});
    const result=evaluateMarketPriceCandidates({items:[make("a",10000),make("b",10500),make("c",11000),make("d",11500),make("e",12000),make("f",100000),make("g",9000,"Canon R6 ジャンク"),make("h",8000,"Canon R5 ボディ")],selectedKeyword:"Canon R6",periodStart:new Date("2026-06-01T00:00:00Z"),periodEnd:new Date("2026-09-09T00:00:00Z"),selectedConditions:["good"],excludeKeywords:["ジャンク"],outlierPolicy:{enabled:true,deviationThreshold:.2,minimumGroupSize:5}});
    expect(result.candidates.find(item=>item.sourceItemId==="f")?.autoOutlier).toBe(true);
    expect(result.candidates.find(item=>item.sourceItemId==="g")?.exclusionReasons).toContain("exclude_keyword");
    expect(result.candidates.find(item=>item.sourceItemId==="h")?.exclusionReasons).toContain("product_mismatch");
    expect(result.statistics).toMatchObject({candidateCount:8,includedCount:5,minimumPrice:10000,medianPrice:11000,maximumPrice:12000});
  });

  it("requires an exact normalized model number in model-number mode",()=>{
    const make=(id:string,title:string)=>({sourceItemId:id,sourceType:"auction" as const,canonicalUrl:`https://auctions.yahoo.co.jp/jp/auction/${id}`,title,closingPrice:60_000,endedAt:"2026-09-01T00:00:00.000Z",sourceCondition:"USED20",normalizedCondition:"good" as const,taxDisplay:"unknown" as const,categoryId:null,brandId:null,contentHash:id.padEnd(64,"0")});
    const result=evaluateMarketPriceCandidates({items:[make("exact","PlayStation 5 CFI-2000A01 本体"),make("fullwidth","PlayStation 5 ＣＦＩ－２０００Ａ０１ 本体"),make("different","PlayStation 5 CFI-1200A01 本体"),make("suffix","PlayStation 5 CFI-2000A01B 本体")],selectedKeyword:"CFI-2000A01",searchBasis:"model_number",modelNumber:"CFI-2000A01",periodStart:new Date("2026-06-01T00:00:00Z"),periodEnd:new Date("2026-09-09T00:00:00Z"),selectedConditions:["good"],excludeKeywords:[],outlierPolicy:{enabled:false,deviationThreshold:.2,minimumGroupSize:5}});
    expect(normalizeModelNumber("ＣＦＩ－２０００Ａ０１")).toBe("cfi2000a01");
    expect(titleMatchesModelNumber("PlayStation 5 CFI-2000A01 本体","CFI-2000A01")).toBe(true);
    expect(titleMatchesModelNumber("PlayStation 5 CFI-2000A01B 本体","CFI-2000A01")).toBe(false);
    expect(result.candidates.filter(candidate=>candidate.included).map(candidate=>candidate.sourceItemId)).toEqual(["exact","fullwidth"]);
    expect(result.candidates.find(candidate=>candidate.sourceItemId==="different")?.matchReasons).toContain("model_number_missing");
    expect(result.statistics.includedCount).toBe(2);
  });
});

describe("Yahoo closed-search result parser", () => {
  const html = (items: unknown[], sort = "-END_TIME") => `<html><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({props:{pageProps:{initialState:{search:{items:{listing:{items,totalResultsAvailable:items.length,metadata:{sort,limit:100}}}}}}}})}</script></html>`;
  it("parses structured items and verifies newest-first order", () => {
    const result = parseYahooClosedSearchHtml(html([
      {auctionId:"a2",title:"商品B",price:2000,endTime:"2026-09-09T10:00:00+09:00",itemCondition:"USED20",taxFlag:0,isFleamarketItem:false,category:{id:10},brandId:20},
      {auctionId:"a1",title:"商品A",price:1000,endTime:"2026-09-08T10:00:00+09:00",itemCondition:"NEW",taxFlag:1,isFleamarketItem:false,category:{id:10},brandId:20},
    ]));
    expect(result.items).toHaveLength(2);
    expect(result.items[0]).toMatchObject({sourceItemId:"a2",normalizedCondition:"good",closingPrice:2000});
    expect(result.oldestEndedAt).toBe("2026-09-08T01:00:00.000Z");
  });
  it("fails closed when sort metadata or item order drifts", () => {
    expect(() => parseYahooClosedSearchHtml(html([], "END_TIME"))).toThrowError(/newest-first/u);
    expect(() => parseYahooClosedSearchHtml(html([
      {auctionId:"a1",title:"A",price:1,endTime:"2026-09-08T00:00:00Z"},
      {auctionId:"a2",title:"B",price:2,endTime:"2026-09-09T00:00:00Z"},
    ]))).toThrowError(/newest first/u);
  });
  it("reports a small parse loss as partial evidence and stops on an abnormal failure rate",()=>{
    const valid=Array.from({length:99},(_,index)=>({auctionId:`ok-${index}`,title:"商品",price:1000,endTime:new Date(Date.UTC(2026,8,9,0,0,-index)).toISOString()}));
    const tolerant=parseYahooClosedSearchHtml(html([...valid,{auctionId:"bad",title:"商品",price:"invalid",endTime:"2026-09-08T00:00:00Z"}]));
    expect(tolerant).toMatchObject({sourceItemCount:100,parseFailureCount:1});
    expect(()=>parseYahooClosedSearchHtml(html([{auctionId:"bad",title:"商品",price:"invalid",endTime:"2026-09-08T00:00:00Z"}]))).toThrow(/failure rate/u);
  });
});

describe("market search period", () => {
  it("uses an exact rolling 90-day window", () => {
    const period = searchPeriod(new Date("2026-09-09T12:00:00Z"));
    expect(period.periodEnd.toISOString()).toBe("2026-09-09T12:00:00.000Z");
    expect(period.periodStart.toISOString()).toBe("2026-06-11T12:00:00.000Z");
  });
});

describe("Aucfan API adapter contract",()=>{
  it("creates a bounded request without inventing granular condition parameters",()=>{
    expect(createAucfanSearchRequest({keyword:" Ｃａｎｏｎ  EOS R6 ",period:"new",page:1,conditions:["good","fair"]})).toEqual({keyword:"Canon EOS R6",period:"new",page:1,pageSize:100,itemStatus:"used"});
    expect(createAucfanSearchRequest({keyword:"Canon EOS R6",period:"3",page:2,conditions:["unused","good"]})).toEqual({keyword:"Canon EOS R6",period:"3",page:2,pageSize:100});
  });

  it("parses date-precision Yahoo results and marks their source",()=>{
    const parsed=parseAucfanSearchJson(JSON.stringify({hit_count:2,max_page_number:1,items:[
      {auction_id:"a-2",title:"Canon EOS R6 ボディ",price:120000,time:"20260909",sitecode:"yahoo",siteurl:"https://example.invalid/a-2",item_status:"used"},
      {auction_id:"a-1",title:"Canon EOS R6 未使用",price:140000,time:"20260908",sitecode:"yahoo",siteurl:"https://example.invalid/a-1",item_status:"new"},
    ]}));
    expect(parsed.items).toHaveLength(2);
    expect(parsed.items[0]).toMatchObject({sourceProvider:"aucfan_api",endedAtPrecision:"date",sourceCondition:"used",normalizedCondition:"unspecified"});
    expect(parsed.items[1]).toMatchObject({sourceCondition:"new",normalizedCondition:"unused"});
  });

  it("fails closed when item order or the API contract drifts",()=>{
    expect(()=>parseAucfanSearchJson(JSON.stringify({hit_count:2,max_page_number:1,items:[
      {auction_id:"old",title:"商品",price:1,time:"20260908",sitecode:"yahoo"},
      {auction_id:"new",title:"商品",price:2,time:"20260909",sitecode:"yahoo"},
    ]}))).toThrow(AucfanSearchContractError);
    expect(()=>createAucfanSearchRequest({keyword:"",period:"new",page:1,conditions:["unspecified"]})).toThrow(AucfanSearchContractError);
  });

  it("accepts broad used results without claiming a granular source condition",()=>{
    const item=parseAucfanSearchJson(JSON.stringify({hit_count:1,max_page_number:1,items:[{auction_id:"used-1",title:"Canon EOS R6 ボディ",price:120000,time:"20260909",sitecode:"yahoo",item_status:"used"}]})).items[0]!;
    const result=evaluateMarketPriceCandidates({items:[item],selectedKeyword:"Canon EOS R6",periodStart:new Date("2026-06-11T00:00:00Z"),periodEnd:new Date("2026-09-10T00:00:00Z"),selectedConditions:["good","fair"],excludeKeywords:[],outlierPolicy:{enabled:true,deviationThreshold:.2,minimumGroupSize:5}});
    expect(result.candidates[0]).toMatchObject({conditionMatched:true,normalizedCondition:"unspecified",included:true});
  });
});
