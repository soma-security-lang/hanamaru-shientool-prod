import { describe, expect, it } from "vitest";
import type { EbayObservation } from "@hanamaru/contracts";
import { assessEbayProduct } from "./ebay-product-match.js";
import { evaluateEbayMarket } from "./soldgraph.js";
const observation = (title: string): EbayObservation => ({
  observationKey:"us:100000000001",market:"us",sourceItemId:"100000000001",title,canonicalUrl:null,
  displayedPrice:{amount:"100.00",currency:"USD"},displayedShipping:null,conditionGroup:"used",sourceCondition:"used",
  format:"fixed_price",bestOfferAccepted:false,soldOn:null,datePrecision:"unknown",
  location:{status:"unknown",countryCode:null,text:null},hardExclusions:[],
});
const basis={keyword:"Canon EOS R6",modelNumber:"EOS R6"};
describe("eBay deterministic product evidence",()=>{
  it.each(["Canon EOS R6 body", "Canon ＥＯＳ－Ｒ６ camera", "Canon eos/r6 used"])("accepts normalized model evidence: %s",title=>{
    expect(assessEbayProduct(observation(title),basis,["used"]).status).toBe("matched");
  });
  it.each(["Canon EOS R60 body", "Canon EOS R6II camera", "Canon EOS R5 body"])("does not adopt a model prefix or different model: %s",title=>{
    expect(assessEbayProduct(observation(title),basis).reasons).toContain("model_not_matched");
  });
  it.each(["Charger for Canon EOS R6", "Canon EOS R6 box only", "Canon EOS R6用 ケース"])("detects accessory-only evidence: %s",title=>{
    expect(assessEbayProduct(observation(title),basis).reasons).toContain("accessory_only");
  });
  it("does not reject the accessory when that is the confirmed product",()=>{
    expect(assessEbayProduct(observation("Charger for Canon EOS R6"),{keyword:"Charger for Canon EOS R6",modelNumber:"EOS R6"}).status).toBe("matched");
    expect(assessEbayProduct(observation("Canon EOS R6 with battery"),basis).status).toBe("matched");
  });
  it("separates an unexpected bundle from unspecified contents",()=>{
    expect(assessEbayProduct(observation("Canon EOS R6 bundle"),basis).reasons).toContain("unexpected_bundle");
    expect(assessEbayProduct(observation("Canon EOS R6"),{...basis,keyword:"Canon EOS R6 kit"}).status).toBe("unknown");
  });
  it("detects capacity differences and preserves unknown capacity without inventing it",()=>{
    const wanted={keyword:"Phone X1 256GB",modelNumber:"X1"};
    expect(assessEbayProduct(observation("Phone X1 128GB"),wanted).reasons).toContain("capacity_mismatch");
    expect(assessEbayProduct(observation("Phone X1"),wanted).reasons).toContain("capacity_unknown");
    expect(assessEbayProduct(observation("Drive X1 1024GB"),{keyword:"Drive X1 1TB",modelNumber:"X1"}).status).toBe("matched");
  });
  it("uses explicit region-version title evidence, not the seller location",()=>{
    const wanted={keyword:"Canon EOS R6 US version",modelNumber:"EOS R6"};
    expect(assessEbayProduct(observation("Canon EOS R6 JP version"),wanted).reasons).toContain("region_mismatch");
    const item={...observation("Canon EOS R6"),location:{status:"country_explicit" as const,countryCode:"US",text:"United States"}};
    expect(assessEbayProduct(item,wanted).status).toBe("unknown");
  });
  it.each(["Mark II", "Mk2", "gen 2", "génération 2", "generación 2", "generazione 2", "第2世代"])("normalizes explicit generation evidence: %s", marker=>{
    expect(assessEbayProduct(observation(`Canon EOS R6 ${marker}`),{...basis,keyword:"Canon EOS R6 Mark II"}).status).toBe("matched");
  });
  it("separates generation mismatch, missing evidence and an unconfirmed generation",()=>{
    expect(assessEbayProduct(observation("Canon EOS R6 Mark III"),{...basis,keyword:"Canon EOS R6 Mark II"}).reasons).toContain("generation_mismatch");
    expect(assessEbayProduct(observation("Canon EOS R6"),{...basis,keyword:"Canon EOS R6 Mark II"}).reasons).toContain("generation_unknown");
    expect(assessEbayProduct(observation("Canon EOS R6 Mark II"),basis).reasons).toContain("generation_unconfirmed");
    expect(assessEbayProduct(observation("Canon EOS R6 2026 2 batteries"),basis).status).toBe("matched");
  });
  it("separates unknown and mismatched condition from used granularity",()=>{
    expect(assessEbayProduct({...observation("Canon EOS R6"),conditionGroup:"unknown"},basis,["used"]).reasons).toContain("condition_unknown");
    expect(assessEbayProduct(observation("Canon EOS R6"),basis,["new"]).reasons).toContain("condition_mismatch");
    expect(assessEbayProduct({...observation("Canon EOS R6 for parts"),conditionGroup:"for_parts"},basis,["for_parts"]).status).toBe("matched");
  });
  it("excludes unconfirmed identity but permits explicit review without overriding mandatory price exclusions",()=>{
    const item=observation("Canon EOS R6 kit"),policy={productBasis:basis,selectedConditions:["used" as const]};
    expect(evaluateEbayMarket("us",[item],policy).includedCount).toBe(0);
    const accepted={...policy,observationOverrides:{[item.observationKey]:"include" as const}};
    expect(evaluateEbayMarket("us",[item],accepted).includedCount).toBe(1);
    expect(evaluateEbayMarket("us",[{...item,hardExclusions:["best_offer_unknown"]}],accepted).includedCount).toBe(0);
    expect(evaluateEbayMarket("us",[item],accepted).decisions[0]!.productMatch?.status).toBe("mismatch");
  });
});
