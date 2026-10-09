import { createHash } from "node:crypto";
import { assessEbayProduct, EBAY_PRODUCT_MATCH_VERSION, type EbayProductBasis } from "./ebay-product-match.js";
import {
  ebayConditions, ebayMarketCurrencies, ebayMarkets,
  type EbayCondition, type EbayCurrency, type EbayMarket, type EbayMarketStatistics,
  type EbayMoney, type EbayObservation, type EbaySearchPlan, type ParsedSoldgraphPage,
  type SoldgraphEnvelope, type SoldgraphPageRequest,
} from "@hanamaru/contracts";

export const SOLDGRAPH_CONTRACT_VERSION = "1.0.0";
export const EBAY_CACHE_PROCESSING_VERSION = `ebay-page-processing-v1:product-${EBAY_PRODUCT_MATCH_VERSION}`;
export const SOLDGRAPH_API_ORIGIN = "https://api.soldgraph.com";
const SCALE = 1_000_000n;
const formats = ["auction", "buy_it_now", "best_offer"] as const;

/** Fixed error codes only: never put provider JSON, queries or keys in errors. */
export class SoldgraphContractError extends Error {
  constructor(readonly code: "INVALID_REQUEST" | "INVALID_ENVELOPE" | "INVALID_PAGE") {
    super(code);
    this.name = "SoldgraphContractError";
  }
}
function fail(code: SoldgraphContractError["code"]): never { throw new SoldgraphContractError(code); }
function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}
function text(value: unknown, max = 1000): string | null {
  return typeof value === "string" && value.length > 0 && value.length <= max ? value : null;
}
function hash(value: unknown): string { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
function isMarket(value: unknown): value is EbayMarket { return ebayMarkets.some(m => m === value); }
function normalizeKeyword(value: unknown): string {
  if (typeof value !== "string" || [...value].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) return fail("INVALID_REQUEST");
  const result = value.normalize("NFKC").replace(/\s+/gu, " ").trim();
  if (!result || [...result].length > 200) return fail("INVALID_REQUEST");
  return result;
}

export function createEbaySearchPlan(input: {
  keyword: string; markets: EbayMarket[]; conditions: EbayCondition[];
  buyingFormat?: SoldgraphPageRequest["buyingFormat"];
}): EbaySearchPlan {
  // Reject runtime keys as well as omitting them from the public TS contract.
  if (Object.keys(input).some(k => !["keyword", "markets", "conditions", "buyingFormat"].includes(k))) fail("INVALID_REQUEST");
  if (!Array.isArray(input.markets) || !input.markets.length || input.markets.length > 8
    || new Set(input.markets).size !== input.markets.length || input.markets.some(m => !isMarket(m))) fail("INVALID_REQUEST");
  if (!Array.isArray(input.conditions) || input.conditions.some(c => !ebayConditions.includes(c))) fail("INVALID_REQUEST");
  const buyingFormat = input.buyingFormat ?? null;
  if (buyingFormat !== null && !formats.includes(buyingFormat)) fail("INVALID_REQUEST");
  const semantic = {
    source: "ebay_soldgraph" as const, periodMode: "source_sample" as const,
    keyword: normalizeKeyword(input.keyword), markets: ebayMarkets.filter(m => input.markets.includes(m)),
    conditions: ebayConditions.filter(c => input.conditions.includes(c)), buyingFormat,
    pageSize: 200 as const, maxPages: 20 as const, maxPagesPerMarket: 10 as const,
  };
  return { ...semantic, initialReservedCredits: semantic.markets.length,
    maximumInitialRows: semantic.markets.length * 200, specHash: hash({ version: SOLDGRAPH_CONTRACT_VERSION, ...semantic }) };
}

export function validateSoldgraphPageRequest(request: SoldgraphPageRequest): SoldgraphPageRequest {
  if (Object.keys(request).some(k => !["keyword", "market", "page", "conditions", "buyingFormat"].includes(k))) fail("INVALID_REQUEST");
  if (!isMarket(request.market) || !Number.isInteger(request.page) || request.page < 1 || request.page > 10) fail("INVALID_REQUEST");
  const plan = createEbaySearchPlan({ keyword: request.keyword, markets: [request.market], conditions: request.conditions, buyingFormat: request.buyingFormat });
  return { keyword: plan.keyword, market: request.market, page: request.page, conditions: plan.conditions, buyingFormat: plan.buyingFormat };
}

/** Server-only API request, not an eBay public-search URL generator. */
export function soldgraphRequestUrl(input: SoldgraphPageRequest): string {
  const request = validateSoldgraphPageRequest(input);
  const url = new URL("/v1/ebay/sold", SOLDGRAPH_API_ORIGIN);
  url.searchParams.set("q", request.keyword);
  url.searchParams.set("country", request.market);
  url.searchParams.set("item_location", "worldwide");
  url.searchParams.set("sort", "recently_sold");
  url.searchParams.set("count", "200");
  url.searchParams.set("page", String(request.page));
  if (request.conditions.length) url.searchParams.set("condition", request.conditions.join(","));
  if (request.buyingFormat) url.searchParams.set("buying_format", request.buyingFormat);
  return url.toString();
}

export function soldgraphOperationKey(searchId: string, request: SoldgraphPageRequest, attempt = 1): string {
  if (!/^[a-zA-Z0-9-]{1,80}$/.test(searchId) || !Number.isSafeInteger(attempt) || attempt < 1) fail("INVALID_REQUEST");
  return `sg-${hash({ searchId, request: validateSoldgraphPageRequest(request), attempt, version: SOLDGRAPH_CONTRACT_VERSION })}`;
}

export function validSoldgraphRequestId(id: unknown): id is string {
  return typeof id === "string" && /^[a-zA-Z0-9_-]{1,128}$/.test(id);
}

export function parseSoldgraphEnvelope(value: unknown, expectedRequestId?: string): SoldgraphEnvelope {
  const raw = object(value);
  if (!validSoldgraphRequestId(raw.request_id) || (expectedRequestId && raw.request_id !== expectedRequestId)
    || typeof raw.cached !== "boolean") fail("INVALID_ENVELOPE");
  const common = { requestId: raw.request_id, cached: raw.cached };
  if (raw.status === "pending" || raw.status === "failed") {
    if (raw.credits !== 0) fail("INVALID_ENVELOPE");
    return { ...common, status: raw.status, credits: 0 };
  }
  if (raw.status !== "complete" || (raw.credits !== 0 && raw.credits !== 1)) fail("INVALID_ENVELOPE");
  // Preserve a complete credit charge even if result parsing later fails.
  return { ...common, status: "complete", credits: raw.credits, result: raw.result };
}

function decimalUnits(value: unknown): bigint | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  const s = String(value);
  if (!/^\d{1,12}(?:\.\d{1,2})?$/.test(s)) return null;
  const [whole = "0", fraction = ""] = s.split(".");
  return BigInt(whole) * SCALE + BigInt(fraction.padEnd(6, "0"));
}
function units(value: string): bigint {
  const [whole = "0", fraction = ""] = value.split(".");
  return BigInt(whole) * SCALE + BigInt(fraction.padEnd(6, "0"));
}
function decimal(value: bigint): string {
  const whole = value / SCALE;
  const fraction = String(value % SCALE).padStart(6, "0").replace(/0+$/, "").padEnd(2, "0");
  return `${whole}.${fraction}`;
}
function money(value: unknown, allowZero = false): EbayMoney | null {
  const raw = object(value), amount = decimalUnits(raw.amount);
  if (amount === null || (!allowZero && amount === 0n)
    || !Object.values(ebayMarketCurrencies).some(c => c === raw.currency)) return null;
  return { amount: decimal(amount), currency: raw.currency as EbayCurrency };
}

const countryPatterns: Array<[string, RegExp]> = [
  ["US", /\b(?:united states|états-unis|vereinigte staaten|estados unidos|stati uniti)\b/iu],
  ["GB", /\b(?:united kingdom|royaume-uni|vereinigtes königreich|reino unido|regno unito)\b/iu],
  ["CA", /\bcanada\b/iu], ["AU", /\b(?:australia|australie|australien)\b/iu],
  ["DE", /\b(?:germany|deutschland|allemagne|alemania|germania)\b/iu],
  ["FR", /\b(?:france|frankreich|francia)\b/iu], ["IT", /\b(?:italy|italia|italie|italien)\b/iu],
  ["ES", /\b(?:spain|españa|espagne|spanien|spagna)\b/iu],
  ["JP", /\b(?:japan|japon|japón|giappone)\b|日本/iu],
  ["CN", /\b(?:china|chine|cina)\b|中国/iu],
];
export function classifyEbayLocation(value: unknown): EbayObservation["location"] {
  const locationText = text(value, 500);
  const matches = locationText ? countryPatterns.filter(([, pattern]) => pattern.test(locationText)).map(([code]) => code) : [];
  return { status: matches.length === 1 ? "country_explicit" : matches.length > 1 ? "conflicting" : "unknown",
    countryCode: matches.length === 1 ? matches[0]! : null, text: locationText };
}

const conditionLabels: Record<EbayCondition, string[]> = {
  new: ["new", "brand new", "neu", "neuf", "nuevo", "nuovo"],
  open_box: ["open box", "new (other)", "neuf : autre", "neu: sonstige"],
  refurbished: ["refurbished", "seller refurbished", "certified refurbished", "reconditionné", "reacondicionado", "ricondizionato"],
  used: ["used", "pre-owned", "gebraucht", "occasion", "usado", "usato"],
  for_parts: ["for parts", "for parts or not working", "nur als ersatzteil oder defekt", "pour pièces détachées", "para piezas", "per parti di ricambio"],
};
function condition(value: string | null): EbayObservation["conditionGroup"] {
  const normalized = value?.normalize("NFKC").toLocaleLowerCase("en").trim();
  return ebayConditions.find(c => conditionLabels[c].includes(normalized ?? "")) ?? "unknown";
}
const ebayHosts: Record<EbayMarket, string> = { us: "www.ebay.com", uk: "www.ebay.co.uk", ca: "www.ebay.ca", au: "www.ebay.com.au", de: "www.ebay.de", fr: "www.ebay.fr", it: "www.ebay.it", es: "www.ebay.es" };
function listingUrl(raw: unknown, market: EbayMarket, id: string | null): string | null {
  if (!id || typeof raw !== "string") return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.hostname !== ebayHosts[market] || url.username || url.password || url.port
      || !new RegExp(`^/itm/(?:[^/]+/)?${id}/?$`).test(url.pathname)) return null;
    return `https://${ebayHosts[market]}/itm/${id}`;
  } catch { return null; }
}
function isoDay(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? value : null;
}

export function parseSoldgraphPage(value: unknown, input: SoldgraphPageRequest): ParsedSoldgraphPage {
  const request = validateSoldgraphPageRequest(input), raw = object(value);
  if (raw.provider !== "ebay" || raw.country !== request.market || raw.page !== request.page
    || raw.query !== request.keyword || raw.page_size !== 200 || ![1, 2].includes(Number(raw.schema_version))
    || raw.completeness !== "provider_page_only" || !Array.isArray(raw.data) || raw.data.length > 200
    || raw.count !== raw.data.length || !text(raw.collected_at, 40)
    || !/Z$|[+-]\d{2}:\d{2}$/.test(String(raw.collected_at)) || !Number.isFinite(Date.parse(String(raw.collected_at)))
    || !(raw.next_page === null || raw.next_page === request.page + 1)) fail("INVALID_PAGE");
  const observations = raw.data.map((value, index): EbayObservation => {
    const row = object(value), id = typeof row.id === "string" && /^\d{9,15}$/.test(row.id) ? row.id : null;
    const title = text(row.title) ?? "", price = money(row.displayed_price);
    const bestOfferAccepted = typeof row.best_offer_accepted === "boolean" ? row.best_offer_accepted : null;
    const hardExclusions: EbayObservation["hardExclusions"] = [];
    if (!id) hardExclusions.push("missing_item_id");
    if (!title) hardExclusions.push("missing_title");
    if (!price) hardExclusions.push("invalid_price");
    if (price && price.currency !== ebayMarketCurrencies[request.market]) hardExclusions.push("currency_mismatch");
    if (row.displayed_price_range != null) hardExclusions.push("price_range");
    if (bestOfferAccepted !== false) hardExclusions.push(bestOfferAccepted ? "best_offer_accepted" : "best_offer_unknown");
    const sourceCondition = text(row.condition, 100), soldOn = isoDay(row.sold_date);
    return { observationKey: `${request.market}:${id ?? `missing-${request.page}-${index}`}`, market: request.market,
      sourceItemId: id, title, canonicalUrl: listingUrl(row.link, request.market, id), displayedPrice: price,
      displayedShipping: money(row.displayed_shipping, true), sourceCondition, conditionGroup: condition(sourceCondition),
      format: row.format === "auction" || row.format === "fixed_price" ? row.format : "unknown",
      bestOfferAccepted, soldOn, datePrecision: soldOn ? "provider_inferred_year_date" : "unknown",
      location: classifyEbayLocation(row.location_text), hardExclusions };
  });
  return { market: request.market, page: request.page, nextPage: raw.next_page as number | null,
    collectedAt: new Date(String(raw.collected_at)).toISOString(), sourceCompleteness: "provider_page_only", observations };
}

function quantile(sorted: bigint[], numerator: 1 | 2 | 3): bigint | null {
  if (!sorted.length) return null;
  const position = (sorted.length - 1) * numerator, index = Math.floor(position / 4), weight = BigInt(position % 4);
  const left = sorted[index]!, right = sorted[Math.min(index + 1, sorted.length - 1)]!;
  return left + (right - left) * weight / 4n;
}
function sortedPrices(rows: EbayObservation[]): bigint[] {
  return rows.map(r => units(r.displayedPrice!.amount)).sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
}

/** At most five equal-width decimal bins; the final upper boundary is inclusive. */
function priceHistogram(rows: EbayObservation[]): NonNullable<EbayMarketStatistics["histogram"]> {
  const prices=sortedPrices(rows),minimum=prices[0],maximum=prices.at(-1);
  const populationHash=createHash("sha256").update(JSON.stringify(rows.map(row=>[row.observationKey,row.displayedPrice]).sort((a,b)=>String(a[0]).localeCompare(String(b[0]))))).digest("hex");
  if(minimum===undefined||maximum===undefined)return {version:"ebay-histogram-v1",populationHash,populationCount:0,bins:[]};
  const span=maximum-minimum,count=span===0n?1:Number(span<5n?span:5n);
  const bins=Array.from({length:count},(_,index)=>({lower:minimum+span*BigInt(index)/BigInt(count),
    upper:minimum+span*BigInt(index+1)/BigInt(count),upperInclusive:index===count-1,count:0}));
  for(const price of prices){const bin=bins.find(bin=>price>=bin.lower&&(price<bin.upper||(bin.upperInclusive&&price<=bin.upper)));if(!bin)throw new Error("EBAY_HISTOGRAM_BOUNDARY_INVALID");bin.count++;}
  return {version:"ebay-histogram-v1",populationHash,populationCount:rows.length,bins:bins.map(bin=>({...bin,lower:decimal(bin.lower),upper:decimal(bin.upper)}))};
}

export interface EbayEvaluationPolicy {
  productBasis?: EbayProductBasis;
  selectedConditions?: readonly EbayCondition[];
  excludedItemIds?: readonly string[];
  observationOverrides?: Readonly<Record<string, "include" | "exclude">>;
  excludeKeywords?: readonly string[];
  /** Product/condition matching is explicit input from the existing candidate evaluator. */
  rejectedObservationKeys?: readonly string[];
  outlierPercent?: number;
}

/** Shared by in-memory aggregation and persisted cross-page merging. Never compare different markets as price conflicts. */
export function ebayObservationsConflict(previous: EbayObservation, next: EbayObservation): boolean {
  if (previous.market !== next.market || previous.observationKey !== next.observationKey) return false;
  const signature = (row: EbayObservation) => JSON.stringify([
    row.displayedPrice, row.conditionGroup, row.sourceCondition, row.bestOfferAccepted, row.format,
    [...new Set(row.hardExclusions.filter(reason => reason !== "observation_conflict"))].sort(),
  ]);
  return signature(previous) !== signature(next);
}

/** Country evidence can disagree without making the displayed price invalid. */
export function mergeEbayLocation(previous:EbayObservation["location"],next:EbayObservation["location"]):EbayObservation["location"]{
  if(previous.status==="conflicting"||next.status==="conflicting"||(previous.status==="country_explicit"&&next.status==="country_explicit"&&previous.countryCode!==next.countryCode))
    return {status:"conflicting",countryCode:null,text:previous.text??next.text};
  return previous.status==="country_explicit"?previous:next.status==="country_explicit"?next:previous;
}

export function evaluateEbayMarket(market: EbayMarket, rows: readonly EbayObservation[], policy: EbayEvaluationPolicy = {}): EbayMarketStatistics {
  if (!isMarket(market)) fail("INVALID_REQUEST");
  const percent = policy.outlierPercent ?? 20;
  if (!Number.isInteger(percent) || percent < 0 || percent > 100) fail("INVALID_REQUEST");
  const inMarket = rows.filter(r => r.market === market), unique = new Map<string, EbayObservation>();
  for (const row of inMarket) {
    const previous = unique.get(row.observationKey);
    if (!previous) { unique.set(row.observationKey, structuredClone(row)); continue; }
    if (ebayObservationsConflict(previous, row)) {
      previous.hardExclusions = [...new Set([...previous.hardExclusions, "observation_conflict" as const])];
    }
    previous.location=mergeEbayLocation(previous.location,row.location);
  }
  const decisions = [...unique.values()].map(observation => {
    const reasons: string[] = [...observation.hardExclusions];
    const productMatch = policy.productBasis ? assessEbayProduct(observation, policy.productBasis, policy.selectedConditions) : undefined;
    if (productMatch && productMatch.status !== "matched" && policy.observationOverrides?.[observation.observationKey] !== "include")
      reasons.push(productMatch.status === "mismatch" ? "product_mismatch" : "product_confirmation_required");
    if (observation.sourceItemId && policy.excludedItemIds?.includes(observation.sourceItemId)) reasons.push("product_excluded");
    if (policy.rejectedObservationKeys?.includes(observation.observationKey)) reasons.push("product_or_condition_mismatch");
    if (policy.excludeKeywords?.some(k => k.trim() && observation.title.normalize("NFKC").toLowerCase().includes(k.normalize("NFKC").trim().toLowerCase()))) reasons.push("excluded_keyword");
    if (policy.observationOverrides?.[observation.observationKey] === "exclude") reasons.push("manual_excluded");
    return { observation, ...(productMatch ? { productMatch } : {}), reasons, autoOutlier: false, included: reasons.length === 0 };
  });
  // Use the fixed pre-outlier set; do not iteratively trim and move the baseline.
  for (const group of ebayConditions) {
    const base = decisions.filter(d => d.included && d.observation.conditionGroup === group);
    if (base.length < 5) continue;
    const prices = sortedPrices(base.map(d => d.observation)), median = quantile(prices, 2)!, q1 = quantile(prices, 1)!, q3 = quantile(prices, 3)!;
    const spread = (q3 - q1) * 3n / 2n;
    for (const decision of base) {
      const amount = units(decision.observation.displayedPrice!.amount), distance = amount > median ? amount - median : median - amount;
      decision.autoOutlier = distance * 100n > median * BigInt(percent) && (amount < q1 - spread || amount > q3 + spread);
      if (decision.autoOutlier && policy.observationOverrides?.[decision.observation.observationKey] !== "include") {
        decision.included = false; decision.reasons.push("price_outlier");
      }
    }
  }
  const selected = sortedPrices(decisions.filter(d => d.included).map(d => d.observation));
  const render = (value: bigint | null | undefined): string | null => value == null ? null : decimal(value);
  const counts: Record<string, number> = {};
  for (const decision of decisions) if (!decision.included) { const reason = decision.reasons[0]!; counts[reason] = (counts[reason] ?? 0) + 1; }
  const explicitCountryCount=decisions.filter(decision=>decision.observation.location.status==="country_explicit").length;
  const conflictingCount=decisions.filter(decision=>decision.observation.location.status==="conflicting").length;
  const included=decisions.filter(decision=>decision.included),auctionCount=included.filter(decision=>decision.observation.format==="auction").length;
  const fixedPriceCount=included.filter(decision=>decision.observation.format==="fixed_price").length;
  return { market, currency: ebayMarketCurrencies[market], receivedRows: inMarket.length, uniqueObservations: unique.size,
    includedCount: selected.length, minimum: render(selected[0]), median: render(quantile(selected, 2)), maximum: render(selected.at(-1)),
    p25: render(quantile(selected, 1)), p75: render(quantile(selected, 3)), primaryExclusionCounts: counts,
    histogram:priceHistogram(included.map(decision=>decision.observation)),
    locationQuality:{denominator:decisions.length,explicitCountryCount,conflictingCount,unknownCount:decisions.length-explicitCountryCount-conflictingCount,identifiedRate:decisions.length?explicitCountryCount/decisions.length:null},
    buyingFormatQuality:{denominator:included.length,auctionCount,fixedPriceCount,unknownCount:included.length-auctionCount-fixedPriceCount,auctionRate:included.length?auctionCount/included.length:null},decisions };
}

export function ebayCrossMarketCounts(rows: readonly EbayObservation[]): { uniqueItemIds: number; marketObservations: number; crossMarketDuplicates: number; missingIdRows: number } {
  const ids = new Set(rows.flatMap(r => r.sourceItemId ? [r.sourceItemId] : []));
  const observations = new Set(rows.filter(r => r.sourceItemId).map(r => `${r.market}:${r.sourceItemId}`));
  return { uniqueItemIds: ids.size, marketObservations: observations.size, crossMarketDuplicates: observations.size - ids.size,
    missingIdRows: rows.filter(r => !r.sourceItemId).length };
}
