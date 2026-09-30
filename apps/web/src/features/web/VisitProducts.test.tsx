import {cleanup,render,screen} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {afterEach,expect,it,vi} from "vitest";
import {resources,type MarketPriceSearchDto,type ProductOfferDto,type ProductReceiptCheckDto,type VisitDto,type VisitProductDto,type VisitWorkspaceDto} from "@/lib/api/resources";
import {VisitProducts} from "./VisitProducts";

afterEach(()=>{cleanup();vi.restoreAllMocks();});

it("shows the versioned customer offer after saving it on a ready product",async()=>{
  const user=userEvent.setup();
  const product:VisitProductDto={id:"product-1",visitId:"visit-1",productName:"匿名商品",quantity:1,conditionNote:null,accessoriesNote:null,status:"ready",lockVersion:2,createdAt:"2026-09-30T00:00:00Z",updatedAt:"2026-09-30T00:00:00Z"};
  let offers:ProductOfferDto[]=[];
  let checks:ProductReceiptCheckDto[]=[];
  vi.spyOn(resources,"visitProducts").mockResolvedValue({items:[product],hasMore:false,nextCursor:null});
  vi.spyOn(resources,"workspace").mockResolvedValue({extraction:null,fields:[]} as unknown as VisitWorkspaceDto);
  vi.spyOn(resources,"visit").mockResolvedValue({branchId:"branch-1"} as VisitDto);
  vi.spyOn(resources,"marketPriceSearches").mockResolvedValue({items:[],hasMore:false,nextCursor:null});
  vi.spyOn(resources,"productConsultations").mockResolvedValue({items:[],reassignments:[]});
  vi.spyOn(resources,"consultationManagers").mockResolvedValue({items:[]});
  vi.spyOn(resources,"productOffers").mockImplementation(async()=>({items:offers}));
  vi.spyOn(resources,"productReceiptChecks").mockImplementation(async()=>({items:checks}));
  const createCheck=vi.spyOn(resources,"createProductReceiptCheck").mockImplementation(async(_visitId,_productId,body)=>{
    const check:ProductReceiptCheckDto={id:"check-1",productId:product.id,version:1,result:body.result,observedQuantity:body.observedQuantity,identityMatched:body.identityMatched,conditionMatched:body.conditionMatched,observedCondition:body.observedCondition,holdReason:body.holdReason,monocleTransferStatus:"not_sent",checkedByMembershipId:"assessor-1",checkedAt:"2026-09-30T02:00:00Z"};
    checks=[check];return check;
  });
  const create=vi.spyOn(resources,"createProductOffer").mockImplementation(async(_visitId,_productId,body)=>{
    const offer:ProductOfferDto={id:"offer-1",productId:product.id,version:1,priceYen:body.priceYen,terms:body.terms,expiresAt:null,presentedByMembershipId:"assessor-1",presentedAt:"2026-09-30T01:00:00Z",responses:[]};
    offers=[offer];return offer;
  });
  render(<VisitProducts visitId="visit-1"/>);
  await user.click(await screen.findByRole("button",{name:"相談・提示・回答"}));
  expect(await screen.findByText("顧客への提示はまだありません。")).toBeInTheDocument();
  await user.type(screen.getByRole("spinbutton",{name:"提示額（円）"}),"8500");
  await user.type(screen.getByRole("textbox",{name:"条件（個人情報は入力しない）"}),"現物確認後に有効");
  await user.click(screen.getByRole("button",{name:"提示を記録"}));
  expect(await screen.findByText("提示 1")).toBeInTheDocument();
  expect(create).toHaveBeenCalledWith("visit-1","product-1",expect.objectContaining({priceYen:8500,terms:"現物確認後に有効",expectedVersion:0}),expect.any(String));
  await user.type(screen.getByRole("textbox",{name:"保留理由"}),"数量の再確認が必要");
  await user.click(screen.getByRole("button",{name:"保留を記録"}));
  expect(await screen.findByText("照合 1: 保留")).toBeInTheDocument();
  expect(createCheck).toHaveBeenCalledWith("visit-1","product-1",expect.objectContaining({result:"hold",holdReason:"数量の再確認が必要",expectedVersion:0}),expect.any(String));
});

it("keeps offer and response history read-only after physical receipt is confirmed",async()=>{
  const user=userEvent.setup();
  const product:VisitProductDto={id:"product-2",visitId:"visit-2",productName:"受領済み商品",quantity:1,conditionNote:null,accessoriesNote:null,status:"ready",lockVersion:3,createdAt:"2026-09-30T00:00:00Z",updatedAt:"2026-09-30T00:00:00Z"};
  const offer:ProductOfferDto={id:"offer-2",productId:product.id,version:1,priceYen:8500,terms:"現物確認後",expiresAt:null,presentedByMembershipId:"assessor-1",presentedAt:"2026-09-30T01:00:00Z",responses:[{id:"response-2",offerId:"offer-2",version:1,response:"accepted",note:null,recordedByMembershipId:"assessor-1",recordedAt:"2026-09-30T01:30:00Z"}]};
  const check:ProductReceiptCheckDto={id:"check-2",productId:product.id,version:1,result:"confirmed",observedQuantity:1,identityMatched:true,conditionMatched:true,observedCondition:null,holdReason:null,monocleTransferStatus:"not_sent",checkedByMembershipId:"assessor-1",checkedAt:"2026-09-30T02:00:00Z"};
  vi.spyOn(resources,"visitProducts").mockResolvedValue({items:[product],hasMore:false,nextCursor:null});
  vi.spyOn(resources,"workspace").mockResolvedValue({extraction:null,fields:[]} as unknown as VisitWorkspaceDto);
  vi.spyOn(resources,"visit").mockResolvedValue({branchId:"branch-1"} as VisitDto);
  vi.spyOn(resources,"marketPriceSearches").mockResolvedValue({items:[],hasMore:false,nextCursor:null});
  vi.spyOn(resources,"productConsultations").mockResolvedValue({items:[],reassignments:[]});
  vi.spyOn(resources,"consultationManagers").mockResolvedValue({items:[]});
  vi.spyOn(resources,"productOffers").mockResolvedValue({items:[offer]});
  vi.spyOn(resources,"productReceiptChecks").mockResolvedValue({items:[check]});
  render(<VisitProducts visitId="visit-2"/>);
  await user.click(await screen.findByRole("button",{name:"相談・提示・回答"}));
  expect(await screen.findByText(/照合 1: 受領確認済み/)).toBeInTheDocument();
  expect(screen.getByText(/回答 1: 承諾/)).toBeInTheDocument();
  expect(screen.queryByRole("button",{name:"回答を記録"})).not.toBeInTheDocument();
  expect(screen.queryByRole("button",{name:"提示を記録"})).not.toBeInTheDocument();
});

it("attaches only a confirmed same-branch market result to a manager consultation",async()=>{
  const user=userEvent.setup();
  const product:VisitProductDto={id:"product-3",visitId:"visit-3",productName:"匿名商品",quantity:1,conditionNote:null,accessoriesNote:null,status:"draft",lockVersion:1,createdAt:"2026-09-30T00:00:00Z",updatedAt:"2026-09-30T00:00:00Z"};
  const result=(branchId:string,resultId:string,keyword:string)=>({id:`search-${resultId}`,branchId,resultId,confirmedAt:"2026-09-30T00:00:00Z",query:{keyword},medianPrice:8000}) as unknown as MarketPriceSearchDto;
  vi.spyOn(resources,"visitProducts").mockResolvedValue({items:[product],hasMore:false,nextCursor:null});
  vi.spyOn(resources,"workspace").mockResolvedValue({extraction:null,fields:[]} as unknown as VisitWorkspaceDto);
  vi.spyOn(resources,"visit").mockResolvedValue({branchId:"branch-1"} as VisitDto);
  vi.spyOn(resources,"marketPriceSearches").mockResolvedValue({items:[result("branch-1","result-1","匿名商品 A"),result("branch-2","result-2","別拠点商品")],hasMore:false,nextCursor:null});
  vi.spyOn(resources,"productConsultations").mockResolvedValue({items:[],reassignments:[]});
  vi.spyOn(resources,"consultationManagers").mockResolvedValue({items:[{id:"manager-1",displayName:"上長"}]});
  vi.spyOn(resources,"productOffers").mockResolvedValue({items:[]});
  vi.spyOn(resources,"productReceiptChecks").mockResolvedValue({items:[]});
  const create=vi.spyOn(resources,"createProductConsultation").mockResolvedValue({} as never);
  render(<VisitProducts visitId="visit-3"/>);
  await user.click(await screen.findByRole("button",{name:"相談・提示・回答"}));
  const picker=await screen.findByRole("combobox",{name:"確定済みの相場根拠（任意）"});
  expect(picker).toHaveTextContent("匿名商品 A");
  expect(picker).not.toHaveTextContent("別拠点商品");
  await user.selectOptions(screen.getByRole("combobox",{name:"相談先の上長"}),"manager-1");
  await user.selectOptions(picker,"result-1");
  await user.type(screen.getByRole("spinbutton",{name:"顧客への提示案（円）"}),"9000");
  await user.type(screen.getByRole("textbox",{name:"判断が必要な理由"}),"相場結果と状態を確認するため");
  await user.click(screen.getByRole("button",{name:"相談を送る"}));
  expect(create).toHaveBeenCalledWith("visit-3","product-3",expect.objectContaining({marketPriceResultId:"result-1",proposedPriceYen:9000}));
});

it("keeps the confirmed PDF appraisal text visible while a human creates a sourced product card",async()=>{
  const user=userEvent.setup();
  vi.spyOn(resources,"workspace").mockResolvedValue({extraction:{id:"extraction-1",status:"confirmed",lockVersion:1},fields:[{fieldKey:"appraisalItems",valueType:"text",textValue:"時計、カメラ",verificationStatus:"confirmed"}]} as VisitWorkspaceDto);
  vi.spyOn(resources,"visitProducts").mockResolvedValue({items:[],hasMore:false,nextCursor:null});
  const create=vi.spyOn(resources,"createVisitProduct").mockResolvedValue({} as VisitProductDto);
  render(<VisitProducts visitId="visit-pdf"/>);
  expect(await screen.findByText(/確定済みPDFの査定品: 時計、カメラ/)).toBeInTheDocument();
  await user.click(screen.getByRole("checkbox",{name:/この査定品欄を原本と照合し/}));
  expect(screen.getByRole("button",{name:"商品を追加"})).toBeDisabled();
  await user.type(screen.getByRole("textbox",{name:"PDFで確認した該当部分"}),"時計");
  await user.type(screen.getByRole("textbox",{name:"商品名"}),"時計");
  await user.click(screen.getByRole("button",{name:"商品を追加"}));
  expect(create).toHaveBeenCalledWith("visit-pdf",expect.objectContaining({productName:"時計",sourceExtractionId:"extraction-1",sourceAppraisalExcerpt:"時計"}),expect.any(String));
});

it("does not present an unverified PDF appraisal field as a confirmed source",async()=>{
  vi.spyOn(resources,"workspace").mockResolvedValue({extraction:{id:"extraction-2",status:"confirmed",lockVersion:1},fields:[{fieldKey:"appraisalItems",valueType:"text",textValue:"未確認の時計",verificationStatus:"unverified"}]} as VisitWorkspaceDto);
  vi.spyOn(resources,"visitProducts").mockResolvedValue({items:[],hasMore:false,nextCursor:null});
  render(<VisitProducts visitId="visit-unverified"/>);
  expect(await screen.findByText(/商品カードはありません/)).toBeInTheDocument();
  expect(screen.queryByText(/確定済みPDFの査定品/)).not.toBeInTheDocument();
  expect(screen.queryByRole("checkbox",{name:/この査定品欄を原本と照合し/})).not.toBeInTheDocument();
});

it("shows a named research hold and requires a result before reopening the product",async()=>{
  const user=userEvent.setup();
  let product:VisitProductDto={id:"product-hold",visitId:"visit-hold",productName:"型番不明の時計",quantity:1,conditionNote:null,accessoriesNote:null,status:"draft",lockVersion:1,createdAt:"2026-09-30T00:00:00Z",updatedAt:"2026-09-30T00:00:00Z"};
  vi.spyOn(resources,"visitProducts").mockImplementation(async()=>({items:[product],hasMore:false,nextCursor:null}));
  vi.spyOn(resources,"workspace").mockResolvedValue({extraction:null,fields:[]} as unknown as VisitWorkspaceDto);
  const hold=vi.spyOn(resources,"holdVisitProduct").mockImplementation(async(_visitId,_productId,body)=>{
    product={...product,status:"research_hold",lockVersion:2,researchHoldCategory:body.category,researchHoldReason:body.reason,researchHoldAssigneeId:"member-1",researchHoldAssigneeName:"担当者",researchHoldOpenedAt:"2026-09-30T01:00:00Z"};return product;
  });
  const resume=vi.spyOn(resources,"resumeVisitProductResearch").mockImplementation(async(_visitId,_productId,body)=>{
    product={...product,status:"draft",lockVersion:3,researchHoldResolvedAt:"2026-09-30T02:00:00Z",researchHoldResolutionNote:body.resolutionNote};return product;
  });
  render(<VisitProducts visitId="visit-hold"/>);
  await screen.findByText(/進行状態: 下書き/);
  await user.selectOptions(screen.getByRole("combobox",{name:"保留区分"}),"ambiguous");
  await user.type(screen.getByRole("textbox",{name:"調査が必要な理由"}),"候補が複数で型番が一致しない");
  await user.click(screen.getByRole("button",{name:"自分の担当で保留する"}));
  expect(hold).toHaveBeenCalledWith("visit-hold","product-hold",expect.objectContaining({category:"ambiguous",expectedLockVersion:1}));
  expect(await screen.findByText(/進行状態: 相場調査保留/)).toBeInTheDocument();
  expect(screen.queryByRole("button",{name:"修正する"})).not.toBeInTheDocument();
  await user.type(screen.getByRole("textbox",{name:"調査結果"}),"型番を原本で確認した");
  await user.click(screen.getByRole("button",{name:"結果を記録して再開"}));
  expect(resume).toHaveBeenCalledWith("visit-hold","product-hold",expect.objectContaining({expectedLockVersion:2,resolutionNote:"型番を原本で確認した"}));
  expect(await screen.findByText(/調査結果: 型番を原本で確認した/)).toBeInTheDocument();
});
