import {cleanup,render,screen} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {afterEach,expect,it,vi} from "vitest";
import {resources,type ProductOfferDto,type ProductReceiptCheckDto,type VisitProductDto} from "@/lib/api/resources";
import {VisitProducts} from "./VisitProducts";

afterEach(()=>{cleanup();vi.restoreAllMocks();});

it("shows the versioned customer offer after saving it on a ready product",async()=>{
  const user=userEvent.setup();
  const product:VisitProductDto={id:"product-1",visitId:"visit-1",productName:"匿名商品",quantity:1,conditionNote:null,accessoriesNote:null,status:"ready",lockVersion:2,createdAt:"2026-09-30T00:00:00Z",updatedAt:"2026-09-30T00:00:00Z"};
  let offers:ProductOfferDto[]=[];
  let checks:ProductReceiptCheckDto[]=[];
  vi.spyOn(resources,"visitProducts").mockResolvedValue({items:[product],hasMore:false,nextCursor:null});
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
