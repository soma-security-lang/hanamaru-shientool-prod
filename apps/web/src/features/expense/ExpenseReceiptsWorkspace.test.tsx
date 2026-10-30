import {cleanup,fireEvent,render,screen,waitFor} from "@testing-library/react";
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {ExpenseReceiptsWorkspace} from "./ExpenseReceiptsWorkspace";
import type {ReceiptDto,ReceiptOptions} from "@/lib/api/expense-receipts";
const api=vi.hoisted(()=>({options:vi.fn(),list:vi.fn(),command:vi.fn(),result:vi.fn(),uploadAccess:vi.fn(),image:vi.fn()}));
vi.mock("@/lib/api/expense-receipts",()=>({receiptResources:api}));
const options:ReceiptOptions={enabled:true,retentionDays:1,limits:{imageCount:20,imageBytes:10_485_760,totalImageBytes:104_857_600,imagesPerReceipt:5},mimeTypes:["image/jpeg","image/png","image/webp"],heicSupported:false};
const empty={value:null,evidence:null};
const initial=():ReceiptDto=>({id:"receipt-synthetic",batchId:"batch-synthetic",status:"review_required",lockVersion:3,expiresAt:"2026-10-31T00:00:00Z",registeredItemId:null,failureClass:null,reviewJson:null,readingJson:{model:"test-synthetic",documentKind:"single_receipt",paidOn:empty,merchant:{value:"合成店舗",evidence:"合成店舗"},paidTotal:{value:"1200",evidence:"合計1200円"},currency:{value:"JPY",evidence:"円"},purposeHint:empty,warnings:["date_unclear"]}});
let receipt:ReceiptDto;
const changed=vi.fn(async()=>{}),dirty=vi.fn();
beforeEach(()=>{
  vi.clearAllMocks();sessionStorage.clear();receipt=initial();
  api.options.mockResolvedValue(options);api.list.mockImplementation(async()=>({receipts:[structuredClone(receipt)],images:[]}));
  api.command.mockImplementation(async(path:string,body:Record<string,unknown>)=>{
    if(path.endsWith("/review")){receipt={...receipt,reviewJson:body.fields as ReceiptDto["reviewJson"],lockVersion:4};return{id:receipt.id};}
    if(path.endsWith("/register")){receipt={...receipt,status:"registered",registeredItemId:"synthetic-item"};return{id:receipt.id,itemId:"synthetic-item"};}
    return{};
  });
});
afterEach(()=>{cleanup();sessionStorage.clear();});
function show(){return render(<ExpenseReceiptsWorkspace dayId="synthetic-day" viewerId="synthetic-member" editable onChanged={changed} onDraftChange={dirty}/>);}
describe("receipt workspace using explicit mocked APIs, not real OCR",()=>{
  it("keeps collection disabled without an approved policy and never asks for images",async()=>{
    api.options.mockResolvedValue({...options,enabled:false});api.list.mockResolvedValue({receipts:[],images:[]});show();
    expect(await screen.findByText(/方針は承認待ち/)).toBeVisible();expect(screen.queryByLabelText("写真・ファイルを複数選択")).toBeNull();expect(api.command).not.toHaveBeenCalled();
  });
  it("does not infer payment source/date; saves human review before selecting and registering",async()=>{
    show();await screen.findByLabelText("支払日");
    expect(screen.getByLabelText("支払日")).toHaveValue("");expect(screen.getByLabelText("支払元（AIでは確定しません）")).toHaveValue("");
    const confirm=screen.getByLabelText("画像と保存した内容を確認し、明細への登録対象にする");expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByLabelText("支払日"),{target:{value:"2026-10-30"}});
    fireEvent.change(screen.getByLabelText("支払元（AIでは確定しません）"),{target:{value:"personal"}});
    fireEvent.change(screen.getByLabelText("費目"),{target:{value:"駐車場"}});
    fireEvent.change(screen.getByLabelText("実際の支払総額（円）"),{target:{value:"1500"}});
    fireEvent.change(screen.getByLabelText("用途・補足"),{target:{value:"合成用途メモ"}});
    fireEvent.click(screen.getByRole("button",{name:"確認内容を下書き保存"}));
    await waitFor(()=>expect(confirm).not.toBeDisabled());
    expect(api.command.mock.calls[0]![1]).toMatchObject({fields:{paidOn:"2026-10-30",amount:1500,paymentSource:"personal",note:"合成用途メモ"}});
    fireEvent.click(confirm);fireEvent.click(screen.getByRole("button",{name:/確認済みの選択分を明細へ登録/}));
    await waitFor(()=>expect(changed).toHaveBeenCalledOnce());
    expect(api.command.mock.calls[1]![1]).toMatchObject({reviewed:true,fields:{amount:1500,paymentSource:"personal"},duplicateAcknowledged:false});
    expect(await screen.findByText(/証憑の承認・支店締めとは別/)).toBeVisible();
  });
  it("blocks multiple receipts in one image instead of summing or registering them",async()=>{
    receipt={...receipt,readingJson:{...receipt.readingJson!,documentKind:"multiple_receipts"}};show();
    expect(await screen.findByLabelText("画像と保存した内容を確認し、明細への登録対象にする")).toBeDisabled();
    expect(api.command).not.toHaveBeenCalled();
  });
  it("recovers an uncertain saved response without a second write or persisted business text",async()=>{
    api.command.mockRejectedValueOnce(new TypeError("synthetic lost response"));api.result.mockResolvedValue({status:"succeeded",resourceId:receipt.id});show();
    await screen.findByLabelText("支払日");fireEvent.change(screen.getByLabelText("用途・補足"),{target:{value:"not-in-session-storage"}});
    fireEvent.click(screen.getByRole("button",{name:"確認内容を下書き保存"}));
    expect(await screen.findByRole("button",{name:"保存結果を確認"})).toBeVisible();
    const checkpoint=sessionStorage.getItem("hanamaru:receipt:pending:synthetic-member:synthetic-day")!;
    expect(checkpoint).not.toContain("not-in-session-storage");expect(Object.keys(JSON.parse(checkpoint)).sort()).toEqual(["dayId","key","operation","startedAt"]);
    fireEvent.click(screen.getByRole("button",{name:"保存結果を確認"}));await waitFor(()=>expect(changed).toHaveBeenCalledOnce());expect(api.command).toHaveBeenCalledOnce();
  });
  it("does not mark unknown or expired operation results as success or start a new write",async()=>{
    sessionStorage.setItem("hanamaru:receipt:pending:synthetic-member:synthetic-day",JSON.stringify({key:"00000000-0000-4000-8000-000000000001",dayId:"synthetic-day",operation:"expense.receipt.register",startedAt:Date.now()-49*60*60*1000}));
    api.result.mockResolvedValue({status:"unknown",resourceId:null});show();
    fireEvent.click(await screen.findByRole("button",{name:"保存結果を確認"}));
    expect(await screen.findByText(/保存結果は不明です/)).toBeVisible();expect(api.command).not.toHaveBeenCalled();
  });
  it("requires explicit AI data-transfer confirmation and has no arbitrary OCR result for uploaded images",async()=>{
    receipt={...receipt,status:"uploaded",readingJson:null};show();
    const start=await screen.findByRole("button",{name:"この領収書を読み取る・再試行"});expect(start).toBeDisabled();
    fireEvent.click(screen.getByLabelText(/Google CloudのAIで領収書を読み取り/));expect(start).not.toBeDisabled();
    fireEvent.click(start);await waitFor(()=>expect(api.command).toHaveBeenCalledOnce());expect(api.command.mock.calls[0]![1]).toMatchObject({aiConsent:true,expectedLockVersion:3});
  });
});
