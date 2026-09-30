import {cleanup,render,screen} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {afterEach,expect,it,vi} from "vitest";
import {resources,type ProductOfferDto,type VisitProductDto} from "@/lib/api/resources";
import {VisitProducts} from "./VisitProducts";

afterEach(()=>{cleanup();vi.restoreAllMocks();});

it("shows the versioned customer offer after saving it on a ready product",async()=>{
  const user=userEvent.setup();
  const product:VisitProductDto={id:"product-1",visitId:"visit-1",productName:"匿名商品",quantity:1,conditionNote:null,accessoriesNote:null,status:"ready",lockVersion:2,createdAt:"2026-09-30T00:00:00Z",updatedAt:"2026-09-30T00:00:00Z"};
  let offers:ProductOfferDto[]=[];
  vi.spyOn(resources,"visitProducts").mockResolvedValue({items:[product],hasMore:false,nextCursor:null});
  vi.spyOn(resources,"productConsultations").mockResolvedValue({items:[],reassignments:[]});
  vi.spyOn(resources,"consultationManagers").mockResolvedValue({items:[]});
  vi.spyOn(resources,"productOffers").mockImplementation(async()=>({items:offers}));
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
});
