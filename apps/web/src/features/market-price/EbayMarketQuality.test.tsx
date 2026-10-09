import {cleanup,render,screen,within} from "@testing-library/react";
import type {EbayMarketStatistics} from "@hanamaru/contracts";
import {afterEach,describe,expect,it} from "vitest";
import {EbayMarketQuality} from "./EbayMarketQuality";

afterEach(cleanup);
const stat:EbayMarketStatistics={market:"us",currency:"USD",receivedRows:7,uniqueObservations:6,includedCount:5,minimum:"100.00",median:"110.00",maximum:"120.00",p25:"105.00",p75:"115.00",primaryExclusionCounts:{price_outlier:1},decisions:[],
  histogram:{version:"ebay-histogram-v1",populationHash:"a".repeat(64),populationCount:5,bins:[{lower:"100.00",upper:"110.00",upperInclusive:false,count:2},{lower:"110.00",upper:"120.00",upperInclusive:true,count:3}]}};
describe("eBay market-native saved distribution",()=>{
  it("renders central range, saved bins and primary exclusion counts without mixing currencies",()=>{
    render(<EbayMarketQuality stat={stat}/>);
    expect(screen.getByText("105.00 〜 115.00 USD")).toBeInTheDocument();
    const table=screen.getByRole("table");expect(within(table).getAllByRole("row")).toHaveLength(3);
    expect(within(table).getByText("100.00 〜 110.00")).toBeInTheDocument();
    expect(within(table).getByText("110.00 〜 120.00（上限を含む）")).toBeInTheDocument();
    expect(screen.getByText("価格の外れ値：1 件")).toBeInTheDocument();
    expect(screen.queryByText(/JPY/)).not.toBeInTheDocument();
  });
  it("does not fabricate a distribution for a historical snapshot",()=>{
    render(<EbayMarketQuality stat={{...stat,histogram:undefined}}/>);
    expect(screen.getByText(/価格分布の記録がありません/)).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
  it("shows both denominators, unknowns and conflicts without inventing a country",()=>{
    render(<EbayMarketQuality stat={{...stat,locationQuality:{denominator:6,explicitCountryCount:1,unknownCount:4,conflictingCount:1,identifiedRate:1/6},buyingFormatQuality:{denominator:5,auctionCount:2,fixedPriceCount:2,unknownCount:1,auctionRate:.4}}}/>);
    expect(screen.getByText(/所在地判定率：16.7%/)).toHaveTextContent("重複除去後 6 件");
    expect(screen.getByText(/採用候補のオークション比率：40.0%/)).toHaveTextContent("採用 5 件");
    expect(screen.getByText(/所在地不明 4 件・所在地矛盾 1 件/)).toBeInTheDocument();
    expect(screen.getByText(/形式不明 1 件/)).toBeInTheDocument();
  });
  it("does not display an empty population as zero-priced sales",()=>{
    render(<EbayMarketQuality stat={{...stat,includedCount:0,uniqueObservations:0,p25:null,p75:null,primaryExclusionCounts:{},histogram:{version:"ebay-histogram-v1",populationHash:"b".repeat(64),populationCount:0,bins:[]}}}/>);
    expect(screen.getByText("未算出")).toBeInTheDocument();expect(screen.getByText(/分布は算出できません/)).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
});
