import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EbaySearchDetailDto, MarketPriceSearchDto } from "@hanamaru/contracts";
import { EbayReferenceComparison } from "./EbayReferenceComparison";

const api=vi.hoisted(()=>({marketPriceSearches:vi.fn(),marketPriceSearch:vi.fn()}));
vi.mock("@/lib/api/resources",()=>({resources:api}));
const domestic:MarketPriceSearchDto={id:"synthetic-domestic",identificationId:"synthetic-identification",jobId:null,sourceProvider:"yahoo_scrape",sourceLimitations:["国内の取得期間は90日"],status:"confirmed",coverageStatus:"complete",periodStart:"2026-07-01T00:00:00Z",periodEnd:"2026-09-29T00:00:00Z",periodDays:90,query:{keyword:"合成カメラ X1"},conditions:["good"],outlierPolicy:{enabled:true,deviationThreshold:.2,minimumGroupSize:5},failureClass:null,lockVersion:3,resultId:"synthetic-result",confirmedAt:"2026-10-09T00:00:00Z",createdAt:"2026-10-08T00:00:00Z",completedAt:"2026-10-08T00:01:00Z",candidates:[],candidateCount:8,includedCount:5,minimumPrice:10000,medianPriceBeforeOutlierExclusion:11000,medianPrice:11000,maximumPrice:12000,exclusionCounts:{}};
const detail:EbaySearchDetailDto={id:"synthetic-ebay",identificationId:"synthetic-identification",status:"confirmed",lockVersion:3,plan:{source:"ebay_soldgraph",periodMode:"source_sample",keyword:"Synthetic camera X1",markets:["us"],conditions:["used"],buyingFormat:null,pageSize:200,maxPages:20,maxPagesPerMarket:10,initialReservedCredits:1,maximumInitialRows:200,specHash:"b".repeat(64)},outlierPercent:20,runs:[],pages:[],observations:[],statistics:[],counts:{uniqueItemIds:5},snapshots:[{id:"synthetic-snapshot",snapshotVersion:1,snapshotHash:"a".repeat(64),confirmedAt:"2026-10-09T00:00:00Z",snapshotJson:{statistics:[{market:"us",currency:"USD",receivedRows:6,uniqueObservations:6,includedCount:5,minimum:"100.00",median:"110.00",maximum:"120.00",p25:"105.00",p75:"115.00",primaryExclusionCounts:{},decisions:[]}],incomplete:false,coverage:"provider_page_only"}}]};
afterEach(cleanup);
beforeEach(()=>{api.marketPriceSearches.mockReset();api.marketPriceSearch.mockReset();api.marketPriceSearches.mockResolvedValue({items:[domestic,{...domestic,id:"synthetic-draft",status:"ready",resultId:null}]});api.marketPriceSearch.mockResolvedValue(domestic);});

describe("eBay and domestic read-only reference comparison",()=>{
  it("disables an empty saved-result selector without starting an external search",async()=>{
    api.marketPriceSearches.mockResolvedValue({items:[]});
    render(<EbayReferenceComparison detail={detail}/>);
    await userEvent.click(screen.getByRole("button",{name:"比較できる保存結果を読み込む"}));
    expect(await screen.findByLabelText("国内の確定結果を選択")).toBeDisabled();
    expect(screen.getByText("閲覧可能な国内の確定結果はありません。")).toBeInTheDocument();
    expect(api.marketPriceSearch).not.toHaveBeenCalled();
  });
  it("requires explicit loading, selection and condition acknowledgement without combining prices",async()=>{
    render(<EbayReferenceComparison detail={detail}/>);
    expect(api.marketPriceSearches).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button",{name:"比較できる保存結果を読み込む"}));
    const select=await screen.findByLabelText("国内の確定結果を選択");
    expect(screen.getAllByRole("option")).toHaveLength(2);
    await userEvent.selectOptions(select,"synthetic-domestic");
    await screen.findByText(/同じ商品入力。ただし/);
    expect(screen.queryByText("中央値：110.00 USD")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("checkbox",{name:/商品・型番・構成/}));
    expect(screen.getByText("中央値：11,000 JPY")).toBeInTheDocument();
    expect(screen.getByText("中央値：110.00 USD")).toBeInTheDocument();
    expect(screen.getByText(/市場別の要求ページ内・日付は年推定/)).toBeInTheDocument();
    expect(screen.getByText(/混合中央値・価格差率・利益は算出しません/)).toBeInTheDocument();
    expect(api.marketPriceSearch).toHaveBeenCalledWith("synthetic-domestic");
  });
  it("does not infer product identity from a different saved input",async()=>{
    api.marketPriceSearch.mockResolvedValue({...domestic,identificationId:"synthetic-other-input"});
    render(<EbayReferenceComparison detail={detail}/>);
    await userEvent.click(screen.getByRole("button",{name:/保存結果を読み込む/}));
    await userEvent.selectOptions(await screen.findByLabelText("国内の確定結果を選択"),"synthetic-domestic");
    expect(await screen.findByText(/別の商品入力です/)).toBeInTheDocument();
    expect(screen.queryByText("中央値：110.00 USD")).not.toBeInTheDocument();
  });
  it("rejects a result no longer confirmed without selecting another result or starting a search",async()=>{
    api.marketPriceSearch.mockResolvedValue({...domestic,status:"cancelled"});
    render(<EbayReferenceComparison detail={detail}/>);
    await userEvent.click(screen.getByRole("button",{name:/保存結果を読み込む/}));
    await userEvent.selectOptions(await screen.findByLabelText("国内の確定結果を選択"),"synthetic-domestic");
    expect(await screen.findByRole("alert")).toHaveTextContent("別の結果へ自動切替はしていません");
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    await waitFor(()=>expect(api.marketPriceSearch).toHaveBeenCalledTimes(1));
  });
});
