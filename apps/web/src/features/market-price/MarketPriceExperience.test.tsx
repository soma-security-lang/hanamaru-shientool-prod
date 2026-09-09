import {cleanup,fireEvent,render,screen,waitFor} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Link from "next/link";
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {MarketPriceExperience} from "./MarketPriceExperience";

const state=vi.hoisted(()=>({view:"input",searchId:"",push:vi.fn(),replace:vi.fn()}));
const api=vi.hoisted(()=>({
  marketPriceOptions:vi.fn(),createMarketPriceIdentification:vi.fn(),uploadMarketPriceImage:vi.fn(),analyzeMarketPriceIdentification:vi.fn(),marketPriceIdentification:vi.fn(),updateMarketPriceIdentification:vi.fn(),confirmMarketPriceIdentification:vi.fn(),createMarketPriceSearch:vi.fn(),
  marketPriceSearch:vi.fn(),marketPriceSearches:vi.fn(),overrideMarketPriceCandidate:vi.fn(),updateMarketPriceOutlierPolicy:vi.fn(),confirmMarketPriceSearch:vi.fn(),retryMarketPriceSearch:vi.fn(),cancelMarketPriceSearch:vi.fn(),repeatMarketPriceSearch:vi.fn(),
}));

vi.mock("next/navigation",()=>({
  usePathname:()=>"/market-price",
  useRouter:()=>({push:state.push,replace:state.replace}),
  useSearchParams:()=>new URLSearchParams({view:state.view,...(state.searchId?{searchId:state.searchId}:{})}),
}));
vi.mock("@/lib/api/resources",()=>({resources:api}));

const options={conditions:[
  {value:"unused" as const,label:"未使用"},{value:"near_unused" as const,label:"未使用に近い"},{value:"good" as const,label:"目立った傷や汚れなし"},{value:"fair" as const,label:"やや傷や汚れあり"},{value:"poor" as const,label:"傷や汚れあり"},{value:"very_poor" as const,label:"全体的に状態が悪い"},{value:"unspecified" as const,label:"指定しない"},
],categories:[],brands:[],limits:{imageCount:5 as const,imageBytes:10_485_760,totalImageBytes:52_428_800}};

afterEach(()=>cleanup());
beforeEach(()=>{
  state.view="input";state.searchId="";state.push.mockReset();state.replace.mockReset();
  Object.values(api).forEach(mock=>mock.mockReset());
  api.marketPriceOptions.mockResolvedValue(options);
});

describe("SCR-021 market price workflow",()=>{
  it("offers all three input paths and sends the direct path without AI",async()=>{
    api.createMarketPriceIdentification.mockResolvedValue({id:"identification-1",lockVersion:1});
    render(<MarketPriceExperience/>);
    expect(await screen.findByRole("radio",{name:/画像＋AI補助/})).toBeChecked();
    expect(screen.getByText("手順 1/5：商品入力")).toBeInTheDocument();
    expect(screen.getByRole("button",{name:/商品入力/})).toHaveAttribute("aria-current","step");
    expect(screen.getByRole("radio",{name:/手入力＋AI補助/})).toBeInTheDocument();
    await userEvent.click(screen.getByRole("radio",{name:/手入力のみ/}));
    await userEvent.type(screen.getByLabelText(/商品名/),"Canon EOS R6 ボディ");
    await userEvent.type(screen.getByLabelText(/検索キーワード/),"Canon EOS R6 ボディ");
    await userEvent.click(screen.getByRole("button",{name:/検索条件を確認/}));
    await waitFor(()=>expect(api.createMarketPriceIdentification).toHaveBeenCalledWith(expect.objectContaining({inputMode:"manual_direct",conditions:["near_unused","good","fair"],searchQueries:[expect.objectContaining({decision:"accepted",source:"user"})]})));
    expect(api.analyzeMarketPriceIdentification).not.toHaveBeenCalled();
    expect(state.replace).toHaveBeenCalledWith("/market-price?view=identify&searchId=identification-1",{scroll:false});
  });

  it("does not submit while a Japanese IME composition is active",async()=>{
    api.createMarketPriceIdentification.mockResolvedValue({id:"identification-ime",lockVersion:1});
    render(<MarketPriceExperience/>);
    await userEvent.click(await screen.findByRole("radio",{name:/手入力のみ/}));
    const productName=screen.getByLabelText(/商品名/);
    fireEvent.compositionStart(productName);
    fireEvent.change(productName,{target:{value:"キヤノン"}});
    fireEvent.keyDown(productName,{key:"Enter",code:"Enter",isComposing:true});
    expect(api.createMarketPriceIdentification).not.toHaveBeenCalled();
    fireEvent.compositionEnd(productName);
    await userEvent.type(screen.getByLabelText(/検索キーワード/),"キヤノン カメラ");
    await userEvent.click(screen.getByRole("button",{name:/検索条件を確認/}));
    await waitFor(()=>expect(api.createMarketPriceIdentification).toHaveBeenCalledTimes(1));
  });

  it("warns before an in-app link discards an unsaved draft",async()=>{
    const followLink=vi.fn();const confirm=vi.spyOn(window,"confirm").mockReturnValue(false);
    render(<><MarketPriceExperience/><Link href="/visits" onClick={followLink}>訪問へ移動</Link></>);
    await userEvent.click(await screen.findByRole("radio",{name:/手入力のみ/}));
    await userEvent.type(screen.getByLabelText(/商品名/),"未保存の商品");
    await userEvent.click(screen.getByRole("link",{name:"訪問へ移動"}));
    expect(confirm).toHaveBeenCalledWith("入力中の商品情報と画像は保存されません。画面を移動しますか？");
    expect(followLink).not.toHaveBeenCalled();
    confirm.mockRestore();
  });

  it("rejects an unsupported image before any upload",async()=>{
    const {container}=render(<MarketPriceExperience/>);
    await screen.findByText("商品画像");
    const input=container.querySelector<HTMLInputElement>('input[type="file"]');
    expect(input).not.toBeNull();
    if(!input)return;
    fireEvent.change(input,{target:{files:[new File(["unsafe"],"unsafe.gif",{type:"image/gif"})]}});
    expect(await screen.findByRole("alert")).toHaveTextContent("JPEG、PNG、WebP画像だけ追加できます");
    expect(api.uploadMarketPriceImage).not.toHaveBeenCalled();
  });

  it("requires an explicit AI product and query decision before starting Yahoo acquisition",async()=>{
    state.view="identify";state.searchId="identification-2";
    api.marketPriceIdentification.mockResolvedValue({
      id:"identification-2",inputMode:"manual_assisted",status:"suggestion_ready",input:{productName:"カメラ",category:null,brand:null,modelNumber:null,attributes:{},searchQueries:[],excludeKeywords:[],conditions:["good"]},
      suggestions:{productCandidates:[{id:"product-1",productName:"Canon EOS R6 ボディ",category:"カメラ",brand:"Canon",modelNumber:"EOS R6",attributes:{構成:"ボディのみ"},confidence:.94,decision:"pending"}],searchQueries:[{id:"query-1",keyword:"Canon EOS R6 ボディ",breadth:"strict",source:"ai",decision:"pending"}],excludeKeywords:["ジャンク"],suggestedConditions:["good"],warnings:[]},
      confirmedFields:null,imageCount:0,jobId:null,failureClass:null,lockVersion:2,expiresAt:new Date(Date.now()+86_400_000).toISOString(),confirmedAt:null,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),
    });
    api.updateMarketPriceIdentification.mockResolvedValue({id:"identification-2",status:"suggestion_ready",lockVersion:3});
    api.confirmMarketPriceIdentification.mockResolvedValue({id:"identification-2",status:"confirmed",lockVersion:4,confirmedAt:new Date().toISOString()});
    api.createMarketPriceSearch.mockResolvedValue({searchId:"search-1",jobId:"job-1",status:"queued",cacheHit:false});
    render(<MarketPriceExperience/>);
    expect(await screen.findByText(/確度 94%・未確認/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button",{name:"採用して編集"}));
    expect(screen.getByText(/確度 94%・採用済み/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("radio",{name:/Canon EOS R6 ボディ/}));
    await userEvent.click(screen.getByRole("button",{name:/直近90日を検索/}));
    await waitFor(()=>expect(api.updateMarketPriceIdentification).toHaveBeenCalledWith("identification-2",2,expect.objectContaining({productName:"Canon EOS R6 ボディ",searchQueries:[expect.objectContaining({id:"query-1",decision:"accepted"})]}),[expect.objectContaining({id:"product-1",decision:"accepted"})]));
    expect(api.confirmMarketPriceIdentification).toHaveBeenCalledWith("identification-2",3);
    expect(api.createMarketPriceSearch).toHaveBeenCalledWith(expect.objectContaining({identificationId:"identification-2",selectedSearchQueryId:"query-1",conditions:["good"]}));
    expect(state.replace).toHaveBeenCalledWith("/market-price?view=progress&searchId=search-1",{scroll:false});
  });

  it("renders auction candidates as a desktop table with mobile article equivalents",async()=>{
    state.view="candidates";state.searchId="search-candidates";
    api.marketPriceSearch.mockResolvedValue({
      id:"search-candidates",identificationId:"identification-candidates",jobId:"job-candidates",status:"ready",coverageStatus:"complete",periodStart:"2026-06-11T00:00:00.000Z",periodEnd:"2026-09-09T00:00:00.000Z",periodDays:90,query:{keyword:"Canon EOS R6"},conditions:["good"],outlierPolicy:{enabled:true,deviationThreshold:.2,minimumGroupSize:5},failureClass:null,lockVersion:2,resultId:null,confirmedAt:null,createdAt:"2026-09-09T00:00:00.000Z",completedAt:"2026-09-09T00:00:01.000Z",candidateCount:1,includedCount:1,minimumPrice:120000,medianPriceBeforeOutlierExclusion:120000,medianPrice:120000,maximumPrice:120000,exclusionCounts:{},
      candidates:[{id:"candidate-1",sourceItemId:"auction-1",sourceType:"auction",canonicalUrl:"https://example.invalid/item",title:"Canon EOS R6 ボディ",closingPrice:120000,endedAt:"2026-09-08T00:00:00.000Z",normalizedCondition:"good",matchScore:1,matchReasons:["型番一致"],conditionMatched:true,exclusionReasons:[],conditionGroupCount:5,conditionMedianPrice:120000,priceDeviationRate:0,iqrLowerBound:110000,iqrUpperBound:130000,autoOutlier:false,inclusionOverride:null,included:true,decisionSource:"automatic"}],
    });
    const {container}=render(<MarketPriceExperience/>);
    expect(await screen.findByRole("table")).toBeInTheDocument();
    expect(screen.getByRole("columnheader",{name:"落札商品"})).toBeInTheDocument();
    expect(container.querySelectorAll("article[data-included]")).toHaveLength(1);
  });
});
