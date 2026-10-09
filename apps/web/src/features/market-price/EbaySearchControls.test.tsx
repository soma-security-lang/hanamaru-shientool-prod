import { useState } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EbaySearchControls, initialEbaySelection } from "./EbaySearchControls";
import { EbaySearchDisplay } from "./EbaySearchDisplay";
import { EbaySearchHistory } from "./EbaySearchHistory";

const api = vi.hoisted(() => ({ get: vi.fn(), mutate: vi.fn(), list:vi.fn(),operationResult:vi.fn() }));
vi.mock("@/lib/api/ebay-market-price", () => ({ ebayMarketPriceResources: api }));
afterEach(() => {cleanup();vi.restoreAllMocks();});
beforeEach(()=>{window.sessionStorage.clear();api.get.mockReset();api.mutate.mockReset();api.list.mockReset();api.operationResult.mockReset();api.operationResult.mockResolvedValue({status:"unknown",searchId:null});});
function Controls() { const [value, setValue] = useState(initialEbaySelection); return <EbaySearchControls value={value} onChange={setValue}/>; }
describe("eBay market and consumption confirmation", () => {
  it("starts with eight markets and revokes confirmation when conditions change", async () => {
    render(<Controls/>);
    expect(screen.getByText(/初回最大 8 枠・最大 1600 受信行/)).toBeInTheDocument();
    const confirm = screen.getByRole("checkbox", { name: "対象市場・状態と最大消費枠を確認しました" });
    expect(confirm).not.toBeChecked();
    await userEvent.click(confirm);
    await userEvent.click(screen.getByRole("checkbox", { name: "英国（GBP）" }));
    expect(confirm).not.toBeChecked();
    expect(screen.getByText(/初回最大 7 枠・最大 1400 受信行/)).toBeInTheDocument();
    await userEvent.click(confirm);
    await userEvent.selectOptions(screen.getByLabelText("販売形式"), "auction");
    expect(confirm).not.toBeChecked();
  });
  it("does not permit consumption confirmation with no condition selected", async () => {
    render(<Controls/>);
    await userEvent.click(screen.getByRole("checkbox", { name: "中古" }));
    expect(screen.getByRole("checkbox", { name: "対象市場・状態と最大消費枠を確認しました" })).toBeDisabled();
  });
  it("reads saved results without displaying unknown credits as free or mixing currencies", async () => {
    api.get.mockResolvedValue({ id: "synthetic-search", status: "partial", pages: [{ credits: 1 }, { credits: null }],
      runs: [{ market: "us", status: "complete" }, { market: "uk", status: "pending" }],
      statistics: [{ market: "us", currency: "USD", receivedRows: 3, includedCount: 3, minimum: "10.00", median: "12.00", maximum: "15.00" },
        { market: "uk", currency: "GBP", receivedRows: 0, includedCount: 0, minimum: null, median: null, maximum: null }] });
    render(<EbaySearchDisplay searchId="synthetic-search" onError={vi.fn()}/>);
    expect(await screen.findByText("一部取得・消費確定 1 枠・未確定 1 枠")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "米国（USD）" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "英国（GBP）" })).toBeInTheDocument();
    expect(screen.getByText("12.00")).toBeInTheDocument();
    expect(screen.getByText(/少数標本/)).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledWith("synthetic-search");
  });
  it("identifies internal cache pages and their original collection time without calling a mutation",async()=>{
    api.get.mockResolvedValue({id:"synthetic-search",status:"ready",acquisitionMode:"reuse",pages:[{market:"us",pageNumber:1,attempt:1,credits:0,cacheHit:true,collectedAt:"2026-10-09T00:00:00Z"}],
      runs:[{market:"us",status:"complete",nextPage:null}],statistics:[],snapshots:[]});
    render(<EbaySearchDisplay searchId="synthetic-search" onError={vi.fn()}/>);
    expect(await screen.findByText(/自社保存結果を再利用/)).toHaveTextContent("新規検索枠 0");
    expect(screen.getByText(/自社保存結果を再利用/)).toHaveTextContent("現在の取引を再取得した結果ではありません");
    expect(screen.getByText(/この検索は保存結果の再利用が可能/)).toHaveTextContent("追加ページも条件・鮮度が一致する場合は新規枠0");
    expect(api.mutate).not.toHaveBeenCalled();
  });
  it("explains classified waiting and the persisted retry time without declaring unknown usage free",async()=>{
    api.get.mockResolvedValue({id:"synthetic-search",status:"fetching",pages:[{market:"us",pageNumber:1,attempt:1,credits:null,retryNotBefore:"2026-10-09T00:10:00Z"}],
      runs:[{market:"us",status:"pending",failureClass:"RATE_LIMIT",nextPage:null}],statistics:[],snapshots:[]});
    render(<EbaySearchDisplay searchId="synthetic-search" onError={vi.fn()}/>);
    expect(await screen.findByText(/呼出し速度を調整して待機/)).toHaveTextContent("未確定の消費枠を無料と判断しないでください");
    expect(screen.getByText(/ページ 1 の再確認は/)).toHaveTextContent("以降です");
    expect(api.mutate).not.toHaveBeenCalled();
  });
  it("rechecks only eligible accepted requests after explicit consent without reserving another credit",async()=>{
    const saved={id:"synthetic-search",status:"blocked",lockVersion:3,pages:[
      {market:"us",pageNumber:1,attempt:1,state:"blocked",credits:null,creditState:"unknown",canResume:true},
      {market:"uk",pageNumber:1,attempt:1,state:"unknown",credits:null,creditState:"unknown",canResume:false}],
      runs:[{market:"us",status:"blocked",nextPage:null},{market:"uk",status:"blocked",nextPage:null}],statistics:[],snapshots:[]};
    api.get.mockResolvedValue(saved);api.mutate.mockResolvedValue({reservedCredits:0,resumedExistingRequest:true});const navigate=vi.fn();
    render(<EbaySearchDisplay searchId="synthetic-search" onError={vi.fn()} onNavigate={navigate}/>);
    const button=await screen.findByRole("button",{name:"保存済み取得を再確認"});
    expect(button).toBeDisabled();expect(screen.getAllByRole("button",{name:"保存済み取得を再確認"})).toHaveLength(1);
    expect(screen.getByText(/新しい検索は購入しません/)).toHaveTextContent("未確定消費は無料とは判断しません");
    await userEvent.click(screen.getByRole("checkbox",{name:"保存済み取得の再確認を希望します"}));
    await userEvent.click(button);
    expect(api.mutate).toHaveBeenCalledWith("synthetic-search","resume",{expectedLockVersion:3,market:"us",pageNumber:1,resumeConfirmed:true},expect.any(String));
    expect(navigate).toHaveBeenCalledWith("progress");
  });
  it("renders the immutable snapshot instead of newer working statistics",async()=>{
    api.get.mockResolvedValue({status:"ready",pages:[],runs:[{market:"us",status:"complete",nextPage:null}],statistics:[{market:"us",currency:"USD",median:"999.00"}],
      snapshots:[{snapshotVersion:1,confirmedAt:"2026-10-09T00:00:00Z",snapshotJson:{incomplete:false,statistics:[{market:"us",currency:"USD",median:"12.00",minimum:"10.00",maximum:"15.00",includedCount:6,receivedRows:6}]}}]});
    render(<EbaySearchDisplay searchId="synthetic-search" view="result" onError={vi.fn()}/>);
    expect(await screen.findByText("12.00")).toBeInTheDocument();
    expect(screen.queryByText("999.00")).not.toBeInTheDocument();
    expect(screen.getByText(/確定版 1/)).toBeInTheDocument();
  });
  it("does not repeat a successful save when only the refreshed display fails",async()=>{
    const saved={id:"synthetic-search",status:"ready",lockVersion:3,outlierPercent:20,pages:[],runs:[{market:"us",status:"complete",nextPage:null}],
      statistics:[{market:"us",currency:"USD",includedCount:0,receivedRows:0,decisions:[]}],observations:[],snapshots:[]};
    api.get.mockResolvedValueOnce(saved).mockRejectedValueOnce(new Error("synthetic refresh lost")).mockResolvedValueOnce({...saved,lockVersion:4,outlierPercent:30});
    api.mutate.mockResolvedValue({});
    render(<EbaySearchDisplay searchId="synthetic-search" view="candidates" onError={vi.fn()}/>);
    const threshold=await screen.findByRole("spinbutton",{name:"外れ値基準（%）"});
    await userEvent.clear(threshold);await userEvent.type(threshold,"30");
    await userEvent.click(screen.getByRole("button",{name:"外れ値基準を適用"}));
    expect(await screen.findByText(/保存は完了しましたが/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button",{name:"操作結果を確認"}));
    expect(api.mutate).toHaveBeenCalledTimes(1);
    expect(api.mutate).toHaveBeenCalledWith("synthetic-search","outlier-policy",{expectedLockVersion:3,outlierPercent:30},expect.any(String));
  });
  it("replays an ambiguous mutation with the same key and payload",async()=>{
    const saved={id:"synthetic-search",status:"ready",lockVersion:3,outlierPercent:20,pages:[],runs:[{market:"us",status:"complete",nextPage:null}],
      statistics:[{market:"us",currency:"USD",includedCount:0,receivedRows:0,decisions:[]}],observations:[],snapshots:[]};
    api.get.mockResolvedValue(saved);api.mutate.mockRejectedValueOnce(new Error("synthetic response lost")).mockResolvedValueOnce({});
    render(<EbaySearchDisplay searchId="synthetic-search" view="candidates" onError={vi.fn()}/>);
    await screen.findByRole("spinbutton",{name:"外れ値基準（%）"});
    await userEvent.click(screen.getByRole("button",{name:"外れ値基準を適用"}));
    await userEvent.click(await screen.findByRole("button",{name:"同じ保存を同じキーで再送"}));
    expect(api.mutate).toHaveBeenCalledTimes(2);
    expect(api.mutate.mock.calls[0]).toEqual(api.mutate.mock.calls[1]);
  });
  it("restores an ambiguous operation after reload using only metadata and never resends its body",async()=>{
    const saved={id:"synthetic-search",status:"ready",lockVersion:3,outlierPercent:20,pages:[],runs:[{market:"us",status:"complete",nextPage:null}],
      statistics:[],observations:[],snapshots:[]};
    api.get.mockResolvedValue(saved);api.mutate.mockRejectedValueOnce(new Error("synthetic response lost"));
    const first=render(<EbaySearchDisplay searchId="synthetic-search" view="candidates" onError={vi.fn()}/>);
    await screen.findByRole("button",{name:"外れ値基準を適用"});
    await userEvent.click(screen.getByRole("button",{name:"外れ値基準を適用"}));
    await screen.findByRole("button",{name:"同じ保存を同じキーで再送"});
    const metadata=JSON.parse(window.sessionStorage.getItem("hanamaru.ebay.pending:synthetic-search")!);
    expect(Object.keys(metadata).sort()).toEqual(["action","key","searchId","startedAt"]);expect(metadata.action).toBe("outlier-policy");
    first.unmount();api.operationResult.mockResolvedValue({status:"succeeded",action:"outlier-policy",searchId:"synthetic-search"});
    render(<EbaySearchDisplay searchId="synthetic-search" view="candidates" onError={vi.fn()}/>);
    await userEvent.click(await screen.findByRole("button",{name:"操作結果を確認"}));
    expect(api.operationResult).toHaveBeenCalledWith(metadata.key,"outlier-policy");
    expect(api.mutate).toHaveBeenCalledTimes(1);
    expect(window.sessionStorage.getItem("hanamaru.ebay.pending:synthetic-search")).toBeNull();
  });
  it("retains expired unknown operations and refuses a new save without inventing success",async()=>{
    const saved={id:"synthetic-search",status:"ready",lockVersion:3,outlierPercent:20,pages:[],runs:[],statistics:[],observations:[],snapshots:[]};
    window.sessionStorage.setItem("hanamaru.ebay.pending:synthetic-search",JSON.stringify({key:crypto.randomUUID(),searchId:"synthetic-search",action:"outlier-policy",startedAt:Date.now()-49*60*60*1000}));
    api.get.mockResolvedValue(saved);render(<EbaySearchDisplay searchId="synthetic-search" view="candidates" onError={vi.fn()}/>);
    await userEvent.click(await screen.findByRole("button",{name:"操作結果を確認"}));
    expect(await screen.findByText(/操作結果の保管期間を過ぎました/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button",{name:"外れ値基準を適用"}));expect(api.mutate).not.toHaveBeenCalled();
    expect(window.sessionStorage.getItem("hanamaru.ebay.pending:synthetic-search")).not.toBeNull();
  });
  it("does not overwrite malformed pending metadata with a new operation",async()=>{
    const saved={id:"synthetic-search",status:"ready",lockVersion:3,outlierPercent:20,pages:[],runs:[],statistics:[],observations:[],snapshots:[]};
    window.sessionStorage.setItem("hanamaru.ebay.pending:synthetic-search","{broken");api.get.mockResolvedValue(saved);
    render(<EbaySearchDisplay searchId="synthetic-search" view="candidates" onError={vi.fn()}/>);
    expect(await screen.findByText(/前回の操作記録を確認できません/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button",{name:"外れ値基準を適用"}));expect(api.mutate).not.toHaveBeenCalled();
    expect(window.sessionStorage.getItem("hanamaru.ebay.pending:synthetic-search")).toBe("{broken");
  });
  it("does not send a save if metadata storage is unavailable",async()=>{
    const saved={id:"synthetic-search",status:"ready",lockVersion:3,outlierPercent:20,pages:[],runs:[],statistics:[],observations:[],snapshots:[]};
    api.get.mockResolvedValue(saved);const error=vi.fn();render(<EbaySearchDisplay searchId="synthetic-search" view="candidates" onError={error}/>);
    await screen.findByRole("button",{name:"外れ値基準を適用"});
    vi.spyOn(Storage.prototype,"setItem").mockImplementation(()=>{throw new Error("synthetic storage disabled");});
    await userEvent.click(screen.getByRole("button",{name:"外れ値基準を適用"}));
    expect(api.mutate).not.toHaveBeenCalled();expect(error).toHaveBeenCalledWith(expect.stringContaining("保存を開始していません"));
  });
  it("requires a reason for candidate changes and acknowledges partial confirmation",async()=>{
    const observation={observationKey:"us:100000000000",market:"us",sourceItemId:"100000000000",title:"Synthetic camera",canonicalUrl:"https://www.ebay.com/itm/100000000000",
      displayedPrice:{amount:"12.00",currency:"USD"},displayedShipping:null,sourceCondition:"Used",soldOn:"2026-10-09",location:{status:"unknown",text:null},hardExclusions:[]};
    const saved={id:"synthetic-search",status:"partial",lockVersion:3,outlierPercent:20,pages:[],runs:[{market:"us",status:"complete",nextPage:null},{market:"uk",status:"pending",nextPage:null}],
      statistics:[{market:"us",currency:"USD",includedCount:1,receivedRows:1,decisions:[{observation,included:true,reasons:[]}]},{market:"uk",currency:"GBP",includedCount:0,receivedRows:0,decisions:[]}],
      observations:[{id:"candidate-1",observationJson:observation}],snapshots:[]};
    api.get.mockResolvedValue(saved);api.mutate.mockResolvedValue({});const navigate=vi.fn();
    render(<EbaySearchDisplay searchId="synthetic-search" view="candidates" onNavigate={navigate} onError={vi.fn()}/>);
    expect(await screen.findByRole("button",{name:"この市場の候補を除外"})).toBeDisabled();
    await userEvent.type(screen.getByLabelText("採否変更理由"),"Synthetic mismatch");
    await userEvent.click(screen.getByRole("button",{name:"同じ出品IDを全市場で除外"}));
    expect(api.mutate).toHaveBeenCalledWith("synthetic-search","candidates/candidate-1",{expectedLockVersion:3,scope:"product",decision:"exclude",reason:"Synthetic mismatch"},expect.any(String));
    expect(screen.getByRole("button",{name:"相場結果を確定"})).toBeDisabled();
    await userEvent.click(screen.getByRole("checkbox",{name:/未完了の市場を含む参考値/}));
    await userEvent.click(screen.getByRole("button",{name:"相場結果を確定"}));
    expect(api.mutate).toHaveBeenCalledWith("synthetic-search","confirm",{expectedLockVersion:3,partialAcknowledged:true},expect.any(String));
    expect(navigate).toHaveBeenCalledWith("result");
  });
  it("displays uncertain product evidence in Japanese without claiming identical products",async()=>{
    const observation={observationKey:"us:synthetic",market:"us",title:"Synthetic camera",displayedPrice:{amount:"100.00",currency:"USD"},sourceCondition:"used",location:{text:null,status:"unknown"},soldOn:null,displayedShipping:null,hardExclusions:[]};
    api.get.mockResolvedValue({id:"synthetic-search",status:"ready",lockVersion:1,pages:[],runs:[{market:"us",status:"complete",nextPage:null}],
      statistics:[{market:"us",currency:"USD",includedCount:0,decisions:[{observation,included:false,reasons:["product_confirmation_required"],
        productMatch:{status:"unknown",reasons:["capacity_unknown","region_unknown"],version:"1.0.0"}}]}],
      observations:[{id:"candidate-1",observationJson:observation}],snapshots:[]});
    render(<EbaySearchDisplay searchId="synthetic-search" view="candidates" onError={vi.fn()}/>);
    expect(await screen.findByText(/商品一致：情報不足/)).toHaveTextContent("容量不明、地域仕様不明");
    expect(api.mutate).not.toHaveBeenCalled();
  });
  it("opens saved eBay history without starting an external search",async()=>{
    api.list.mockResolvedValue({items:[{id:"synthetic-history",status:"confirmed",planJson:{keyword:"Synthetic camera",markets:["us","uk"]},createdAt:"2026-10-09T00:00:00Z"}]});
    const open=vi.fn();render(<EbaySearchHistory onOpen={open} onError={vi.fn()}/>);
    await userEvent.click(await screen.findByRole("button",{name:"保存した検索を開く"}));
    expect(open).toHaveBeenCalledWith("synthetic-history","result");
    expect(api.mutate).not.toHaveBeenCalled();
  });
  it("offers a credit-confirmed failed page retry, never an unknown page",async()=>{
    const saved={id:"synthetic-search",status:"blocked",lockVersion:3,pages:[
      {market:"us",pageNumber:1,attempt:1,state:"failed",creditState:"released",credits:0},
      {market:"uk",pageNumber:1,attempt:1,state:"unknown",creditState:"unknown",credits:null}],
      runs:[{market:"us",status:"failed",nextPage:null},{market:"uk",status:"pending",nextPage:null}],statistics:[],snapshots:[]};
    api.get.mockResolvedValue(saved);api.mutate.mockResolvedValue({});const navigate=vi.fn();
    render(<EbaySearchDisplay searchId="synthetic-search" onNavigate={navigate} onError={vi.fn()}/>);
    expect(await screen.findByRole("button",{name:"このページだけ再試行"})).toBeDisabled();
    expect(screen.getAllByRole("button",{name:"このページだけ再試行"})).toHaveLength(1);
    await userEvent.click(screen.getByRole("checkbox",{name:"再試行で最大1枠を使用することを確認しました"}));
    await userEvent.click(screen.getByRole("button",{name:"このページだけ再試行"}));
    expect(api.mutate).toHaveBeenCalledWith("synthetic-search","retry",{expectedLockVersion:3,market:"us",pageNumber:1,consumptionConfirmed:true},expect.any(String));
    expect(navigate).toHaveBeenCalledWith("progress");
  });
  it("requires fresh consumption confirmation and opens the new search after a latest repeat",async()=>{
    const saved={id:"synthetic-search",status:"ready",lockVersion:3,plan:{markets:["us"]},pages:[{credits:1}],runs:[{market:"us",status:"complete",nextPage:null}],statistics:[],snapshots:[]};
    api.get.mockResolvedValueOnce(saved).mockResolvedValue({...saved,id:"synthetic-new-search"});
    api.mutate.mockResolvedValue({searchId:"synthetic-new-search",reservedCredits:1,cacheHit:false});
    const repeat=vi.fn();render(<EbaySearchDisplay searchId="synthetic-search" onRepeat={repeat} onError={vi.fn()}/>);
    expect(await screen.findByRole("button",{name:"同条件で最新を取得"})).toBeDisabled();
    await userEvent.click(screen.getByRole("checkbox",{name:/同条件の最新取得で最大 1 枠/}));
    await userEvent.click(screen.getByRole("button",{name:"同条件で最新を取得"}));
    expect(api.mutate).toHaveBeenCalledWith("synthetic-search","repeat",{expectedLockVersion:3,mode:"latest",consumptionConfirmed:true},expect.any(String));
    expect(api.get).toHaveBeenLastCalledWith("synthetic-new-search");
    expect(repeat).toHaveBeenCalledWith("synthetic-new-search");
  });
  it("prefills saved conditions, revokes consent on edits and opens a separate edited search",async()=>{
    const saved={id:"synthetic-search",status:"confirmed",lockVersion:4,outlierPercent:20,exclusionKeywords:["parts"],
      plan:{keyword:"SYNTHETIC X1",markets:["us"],conditions:["used"],buyingFormat:null},
      pages:[{credits:1}],runs:[{market:"us",status:"complete",nextPage:null}],statistics:[],snapshots:[]};
    api.get.mockResolvedValue(saved);api.mutate.mockResolvedValue({searchId:"synthetic-edited-search"});
    const repeat=vi.fn();render(<EbaySearchDisplay searchId="synthetic-search" onRepeat={repeat} onError={vi.fn()}/>);
    await screen.findByText("条件を編集して再検索");
    await userEvent.click(screen.getByText("条件を編集して再検索"));
    expect(screen.getByLabelText("再検索の検索語")).toHaveValue("SYNTHETIC X1");
    expect(screen.getByLabelText("再検索の除外語（1行1語・最大20語）")).toHaveValue("parts");
    const button=screen.getByRole("button",{name:"編集した条件で新しい検索を開始"});
    const consent=screen.getByRole("checkbox",{name:"対象市場・状態と最大消費枠を確認しました"});
    expect(button).toBeDisabled();await userEvent.click(consent);
    await userEvent.selectOptions(screen.getByLabelText("再検索の取得方法"),"latest");expect(consent).not.toBeChecked();
    await userEvent.click(consent);await userEvent.type(screen.getByLabelText("再検索の検索語")," body");expect(consent).not.toBeChecked();
    await userEvent.click(screen.getByRole("checkbox",{name:"英国（GBP）"}));
    await userEvent.click(consent);await userEvent.click(button);
    expect(api.mutate).toHaveBeenCalledWith("synthetic-search","repeat",{expectedLockVersion:4,mode:"edited",keyword:"SYNTHETIC X1 body",exclusionKeywords:["parts"],outlierPercent:20,acquisitionMode:"latest",markets:["us","uk"],conditions:["used"],buyingFormat:null,consumptionConfirmed:true},expect.any(String));
    expect(repeat).toHaveBeenCalledWith("synthetic-edited-search");
  });
});
