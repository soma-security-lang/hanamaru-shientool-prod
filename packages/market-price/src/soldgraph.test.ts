import { describe, expect, it } from "vitest";
import { ebayMarkets, type EbayMarket, type SoldgraphPageRequest } from "@hanamaru/contracts";
import {
  createEbaySearchPlan, soldgraphRequestUrl, soldgraphOperationKey, parseSoldgraphEnvelope,
  parseSoldgraphPage, evaluateEbayMarket, ebayCrossMarketCounts, classifyEbayLocation, ebayObservationsConflict,
} from "./soldgraph.js";

const request: SoldgraphPageRequest = { keyword: "SYNTHETIC CAMERA X1", market: "us", page: 1, conditions: ["used"], buyingFormat: null };
function row(amount = 100, extra: Record<string, unknown> = {}) {
  return { id: "100000000001", title: "Synthetic camera X1", link: "https://www.ebay.com/itm/100000000001?tracking=ignore",
    displayed_price: { amount, currency: "USD" }, displayed_shipping: null, displayed_price_range: null,
    best_offer_accepted: false, condition: "Pre-Owned", format: "fixed_price", sold_date: "2026-10-01", location_text: null, ...extra };
}
function page(data: unknown[], extra: Record<string, unknown> = {}) {
  return { provider: "ebay", country: "us", query: request.keyword, page: 1, page_size: 200, count: data.length,
    next_page: null, collected_at: "2026-10-09T00:00:00Z", schema_version: 2, completeness: "provider_page_only", data, ...extra };
}
function observations(prices: number[]) {
  return parseSoldgraphPage(page(prices.map((amount, i) => row(amount, { id: String(100000000000 + i) }))), request).observations;
}

describe("cross-page observation consistency", () => {
  it("isolates changed price-quality, condition and format even when the amount is unchanged", () => {
    const original = observations([100])[0]!;
    for (const changed of [
      { ...original, sourceCondition: "Different condition" },
      { ...original, bestOfferAccepted: true },
      { ...original, format: "auction" as const },
      { ...original, hardExclusions: ["observation_conflict", "best_offer_accepted"] as typeof original.hardExclusions },
    ]) {
      expect(ebayObservationsConflict(original, changed)).toBe(true);
      const result = evaluateEbayMarket("us", [original, changed]);
      expect(result.includedCount).toBe(0);
      expect(result.decisions[0]!.reasons).toContain("observation_conflict");
    }
  });
  it("ignores exclusion ordering and the already-recorded conflict marker", () => {
    const original = observations([100])[0]!;
    const a = { ...original, hardExclusions: ["observation_conflict", "best_offer_accepted", "price_missing"] as typeof original.hardExclusions };
    const b = { ...original, hardExclusions: ["price_missing", "best_offer_accepted"] as typeof original.hardExclusions };
    expect(ebayObservationsConflict(a, b)).toBe(false);
    expect(ebayObservationsConflict(original, { ...original, title: "Updated title" })).toBe(false);
  });
  it("does not classify normal cross-market currency differences as conflicts", () => {
    const original = observations([100])[0]!;
    expect(ebayObservationsConflict(original, { ...original, market: "uk", displayedPrice: { amount: "80.00", currency: "GBP" } })).toBe(false);
  });
});

describe("Soldgraph deterministic planning", () => {
  it("selects eight worldwide markets, reserves eight pages and never assumes 90-day completeness", () => {
    const plan = createEbaySearchPlan({ keyword: "ＳＹＮＴＨＥＴＩＣ　 CAMERA  X1", markets: [...ebayMarkets].reverse(), conditions: ["used", "used"] });
    expect(plan).toMatchObject({ keyword: request.keyword, markets: ebayMarkets, pageSize: 200, maxPages: 20,
      maxPagesPerMarket: 10, initialReservedCredits: 8, maximumInitialRows: 1600, periodMode: "source_sample" });
    expect(createEbaySearchPlan({ keyword: request.keyword, markets: [...ebayMarkets], conditions: ["used"] }).specHash).toBe(plan.specHash);
  });
  it.each(ebayMarkets)("builds the fixed API request for %s without price filters", market => {
    const url = new URL(soldgraphRequestUrl({ ...request, market }));
    expect(url.origin + url.pathname).toBe("https://api.soldgraph.com/v1/ebay/sold");
    expect(Object.fromEntries(url.searchParams)).toEqual({ q: request.keyword, country: market, item_location: "worldwide", sort: "recently_sold", count: "200", page: "1", condition: "used" });
  });
  it("keeps operation keys stable and separates markets, pages and explicit attempts", () => {
    const key = soldgraphOperationKey("synthetic-search", request);
    expect(soldgraphOperationKey("synthetic-search", { ...request })).toBe(key);
    expect(new Set([key, soldgraphOperationKey("synthetic-search", { ...request, page: 2 }),
      soldgraphOperationKey("synthetic-search", { ...request, market: "uk" }), soldgraphOperationKey("synthetic-search", request, 2)]).size).toBe(4);
    expect(key).not.toContain("CAMERA");
  });
  it.each([0, -1, 1.5, 11, NaN])("rejects application page overflow %s", page => {
    expect(() => soldgraphRequestUrl({ ...request, page })).toThrow("INVALID_REQUEST");
  });
  it("rejects invented countries, empty markets, arbitrary params and unconfirmed categories", () => {
    expect(() => createEbaySearchPlan({ keyword: "x", markets: ["gb" as EbayMarket], conditions: [] })).toThrow("INVALID_REQUEST");
    expect(() => createEbaySearchPlan({ keyword: "x", markets: [], conditions: [] })).toThrow("INVALID_REQUEST");
    expect(() => createEbaySearchPlan({ keyword: "x", markets: ["us", "us"], conditions: [] })).toThrow("INVALID_REQUEST");
    expect(() => soldgraphRequestUrl({ ...request, ...{ min_price: 100 } })).toThrow("INVALID_REQUEST");
    expect(() => soldgraphRequestUrl({ ...request, ...{ category_id: 123 } })).toThrow("INVALID_REQUEST");
    expect(() => soldgraphRequestUrl({ ...request, keyword: "x".repeat(201) })).toThrow("INVALID_REQUEST");
  });
});

describe("Soldgraph response boundary", () => {
  it("does not trust HTTP success, poll URLs or unexpected IDs", () => {
    expect(parseSoldgraphEnvelope({ request_id: "job-1", status: "pending", credits: 0, cached: false, poll_url: "https://evil.invalid" })).toEqual({ requestId: "job-1", status: "pending", credits: 0, cached: false });
    expect(() => parseSoldgraphEnvelope({ request_id: "../oops", status: "pending", credits: 0, cached: false })).toThrow("INVALID_ENVELOPE");
    expect(() => parseSoldgraphEnvelope({ request_id: "job-2", status: "pending", credits: 0, cached: false }, "job-1")).toThrow("INVALID_ENVELOPE");
    expect(() => parseSoldgraphEnvelope({ request_id: "job-1", status: "failed", credits: 1, cached: false })).toThrow("INVALID_ENVELOPE");
  });
  it("keeps charged completion distinct from failed local parsing", () => {
    expect(parseSoldgraphEnvelope({ request_id: "job-1", status: "complete", credits: 1, cached: true, result: null })).toMatchObject({ status: "complete", credits: 1, result: null });
    expect(() => parseSoldgraphPage(null, request)).toThrow("INVALID_PAGE");
  });
  it("ignores provider summary, raw fields and image URLs", () => {
    const parsed = parseSoldgraphPage(page([row()], { summary: { median: 9000 } }), request);
    expect(parsed.observations[0]).toMatchObject({ displayedPrice: { amount: "100.00", currency: "USD" }, displayedShipping: null,
      canonicalUrl: "https://www.ebay.com/itm/100000000001", soldOn: "2026-10-01", datePrecision: "provider_inferred_year_date" });
    expect(JSON.stringify(parsed)).not.toMatch(/summary|seller_text|tracking|image/);
  });
  it.each([{ country: "uk" }, { page: 2 }, { count: 40 }, { next_page: 1 }, { query: "different" }, { collected_at: "2026-10-09" }, { completeness: "all" }, { schema_version: 3 }])("rejects mismatched page contract %j", extra => {
    expect(() => parseSoldgraphPage(page([row()], extra), request)).toThrow("INVALID_PAGE");
  });
  it("does not invent dates, shipping, Best Offer flags or condition details", () => {
    const parsed = parseSoldgraphPage(page([row(100, { sold_date: "2026-02-30", best_offer_accepted: undefined, condition: null })]), request);
    expect(parsed.observations[0]).toMatchObject({ soldOn: null, datePrecision: "unknown", displayedShipping: null,
      bestOfferAccepted: null, conditionGroup: "unknown", hardExclusions: ["best_offer_unknown"] });
    expect(parseSoldgraphPage(page([row(100, { displayed_shipping: { amount: 0, currency: "USD" } })]), request).observations[0]?.displayedShipping?.amount).toBe("0.00");
  });
  const credentialUrl = new URL("https://www.ebay.com/itm/100000000001");
  credentialUrl.username = "synthetic-user";
  credentialUrl.password = "synthetic-password";
  it.each(["javascript:alert(1)", "https://www.ebay.com.evil.invalid/itm/100000000001", credentialUrl.href, "https://www.ebay.com/itm/999999999999"])("rejects unsafe candidate link %s", link => {
    expect(parseSoldgraphPage(page([row(100, { link })]), request).observations[0]?.canonicalUrl).toBeNull();
  });
});

describe("displayed-currency statistics", () => {
  it("uses acquired deduplicated rows for location rates and adopted rows for auction rates",()=>{
    const rows=observations([100,105,110,115,120,800]).map((observation,index)=>({...observation,
      location:index===5?{status:"country_explicit" as const,countryCode:"US",text:"United States"}:observation.location,
      format:index<2?"auction" as const:index===2?"unknown" as const:"fixed_price" as const}));
    const result=evaluateEbayMarket("us",[...rows,rows[5]!]);
    expect(result.locationQuality).toEqual({denominator:6,explicitCountryCount:1,unknownCount:5,conflictingCount:0,identifiedRate:1/6});
    expect(result.buyingFormatQuality).toEqual({denominator:5,auctionCount:2,fixedPriceCount:2,unknownCount:1,auctionRate:2/5});
    expect(evaluateEbayMarket("us",[]).locationQuality?.identifiedRate).toBeNull();
    expect(evaluateEbayMarket("us",[]).buyingFormatQuality?.auctionRate).toBeNull();
  });
  it("preserves contradictory country evidence without excluding otherwise valid prices",()=>{
    const first={...observations([100])[0]!,location:{status:"country_explicit" as const,countryCode:"US",text:"United States"}};
    const next={...first,location:{status:"country_explicit" as const,countryCode:"JP",text:"Japan"}};
    const result=evaluateEbayMarket("us",[first,next]);
    expect(result.includedCount).toBe(1);expect(result.locationQuality).toEqual({denominator:1,explicitCountryCount:0,unknownCount:0,conflictingCount:1,identifiedRate:0});
    expect(result.decisions[0]!.observation.location).toMatchObject({status:"conflicting",countryCode:null});
    expect(first.location.countryCode).toBe("US");
  });
  it("persists deterministic distribution bins for the final included population",()=>{
    const rows=observations([100,105,110,115,120,800]);
    const result=evaluateEbayMarket("us",rows);
    expect(result.histogram).toMatchObject({version:"ebay-histogram-v1",populationCount:5,bins:[
      {lower:"100.00",upper:"104.00",upperInclusive:false,count:1},
      {lower:"104.00",upper:"108.00",upperInclusive:false,count:1},
      {lower:"108.00",upper:"112.00",upperInclusive:false,count:1},
      {lower:"112.00",upper:"116.00",upperInclusive:false,count:1},
      {lower:"116.00",upper:"120.00",upperInclusive:true,count:1}]});
    expect(evaluateEbayMarket("us",[...rows].reverse()).histogram).toEqual(result.histogram);
    const restored=evaluateEbayMarket("us",rows,{observationOverrides:{[rows[5]!.observationKey]:"include"}});
    expect(restored.histogram!.bins.reduce((sum,bin)=>sum+bin.count,0)).toBe(6);
    expect(restored.histogram!.populationHash).not.toBe(result.histogram!.populationHash);
  });
  it("handles empty, identical and fractional-unit distribution boundaries without losing rows",()=>{
    expect(evaluateEbayMarket("us",[]).histogram).toMatchObject({populationCount:0,bins:[]});
    expect(evaluateEbayMarket("us",observations([100,100])).histogram).toMatchObject({populationCount:2,bins:[{lower:"100.00",upper:"100.00",upperInclusive:true,count:2}]});
    const fractional=observations([1,2]).map((observation,index)=>({...observation,displayedPrice:{amount:index===0?"0.000001":"0.000002",currency:"USD" as const}}));
    const result=evaluateEbayMarket("us",fractional);
    expect(result.histogram).toMatchObject({populationCount:2,bins:[{lower:"0.000001",upper:"0.000002",upperInclusive:true,count:2}]});
  });
  it("uses decimal arithmetic including fractional-cent median and linear quartiles", () => {
    expect(evaluateEbayMarket("us", observations([0.1, 0.11]))).toMatchObject({ minimum: "0.10", median: "0.105", maximum: "0.11", p25: "0.1025", p75: "0.1075" });
    expect(evaluateEbayMarket("us", [])).toMatchObject({ median: null, minimum: null, maximum: null, includedCount: 0 });
  });
  it("requires both 20-percent deviation and IQR, with at least five comparable observations", () => {
    const result = evaluateEbayMarket("us", observations([98, 99, 100, 101, 1000]));
    expect(result).toMatchObject({ includedCount: 4, median: "99.50", primaryExclusionCounts: { price_outlier: 1 } });
    expect(evaluateEbayMarket("us", observations([98, 99, 100, 1000])).includedCount).toBe(4);
    expect(evaluateEbayMarket("us", observations([100, 100, 100, 100, 120])).includedCount).toBe(5);
    expect(evaluateEbayMarket("us", observations([1, 100, 200, 300, 400])).includedCount).toBe(5);
  });
  it("restores a manual outlier, but never restores unsafe prices", () => {
    const rows = observations([98, 99, 100, 101, 1000]);
    expect(evaluateEbayMarket("us", rows, { observationOverrides: { [rows[4]!.observationKey]: "include" } }).includedCount).toBe(5);
    const invalid = parseSoldgraphPage(page([row(1, { best_offer_accepted: true })]), request).observations;
    expect(evaluateEbayMarket("us", invalid, { observationOverrides: { [invalid[0]!.observationKey]: "include" } }).includedCount).toBe(0);
  });
  it.each([{ displayed_price: null }, { displayed_price: { amount: -1, currency: "USD" } }, { displayed_price: { amount: 0, currency: "USD" } },
    { displayed_price: { amount: 1, currency: "JPY" } }, { displayed_price: { amount: 1, currency: "EUR" } },
    { displayed_price_range: { low: 1, high: 2 } }, { best_offer_accepted: null }])("excludes invalid price %j", extra => {
    expect(evaluateEbayMarket("us", parseSoldgraphPage(page([row(1, extra)]), request).observations).includedCount).toBe(0);
  });
  it("deduplicates within markets, isolates conflicts, and does not merge market currencies", () => {
    const us = observations([100]);
    const ukRequest = { ...request, market: "uk" as const };
    const uk = parseSoldgraphPage(page([row(80, { id: us[0]!.sourceItemId, displayed_price: { amount: 80, currency: "GBP" } })], { country: "uk" }), ukRequest).observations;
    expect(evaluateEbayMarket("us", [...us, ...us, ...uk])).toMatchObject({ receivedRows: 2, includedCount: 1, median: "100.00" });
    expect(evaluateEbayMarket("uk", [...us, ...uk])).toMatchObject({ currency: "GBP", median: "80.00" });
    expect(ebayCrossMarketCounts([...us, ...us, ...uk])).toEqual({ uniqueItemIds: 1, marketObservations: 2, crossMarketDuplicates: 1, missingIdRows: 0 });
    expect(evaluateEbayMarket("us", [...us, ...observations([101])]).primaryExclusionCounts).toEqual({ observation_conflict: 1 });
    expect(evaluateEbayMarket("uk", uk, { excludedItemIds: [us[0]!.sourceItemId!] }).includedCount).toBe(0);
  });
  it("never treats unknown conditions as a comparable outlier group", () => {
    const rows = observations([100, 100, 100, 100, 1000]).map(r => ({ ...r, conditionGroup: "unknown" as const }));
    expect(evaluateEbayMarket("us", rows).includedCount).toBe(5);
  });
});

describe("location is supplemental, not nationality", () => {
  it.each([["Located in Japan", "JP"], ["Lieu : Allemagne", "DE"], ["Ubicación: España", "ES"], ["Luogo: Giappone", "JP"]])("recognizes explicit country %s", (value, code) => {
    expect(classifyEbayLocation(value)).toMatchObject({ status: "country_explicit", countryCode: code });
  });
  it.each([null, "Tokyo", "Paris", "Japanville", "Unknown"]) ("leaves %s unknown", value => {
    expect(classifyEbayLocation(value).status).toBe("unknown");
  });
  it("keeps country conflicts and unknowns distinct without dropping prices", () => {
    expect(classifyEbayLocation("Japan / United States").status).toBe("conflicting");
    expect(evaluateEbayMarket("us", observations([100])).includedCount).toBe(1);
  });
});
