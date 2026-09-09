import { createHash } from "node:crypto";
import type {
  GeneratedYahooSearchUrl,
  MarketPriceOutlierPolicy,
  ProductCondition,
  YahooClosedSearchSpec,
} from "@hanamaru/contracts";

export const YAHOO_CLOSED_SEARCH_ORIGIN = "https://auctions.yahoo.co.jp";
export const YAHOO_CLOSED_SEARCH_PATH = "/closedsearch/closedsearch";
export const YAHOO_CLOSED_SEARCH_SORT = { ENDED_AT_NEWEST: 6 } as const;
export const MARKET_PRICE_POLICY = {
  periodDays: 90,
  pageSize: 100,
  maxPages: 20,
  requestIntervalMs: 5_000,
  cacheHours: 24,
} as const;
export const YAHOO_URL_GENERATOR_VERSION = "1.0.0";
export const YAHOO_RESULT_PARSER_VERSION = "1.0.0";
export const YAHOO_PARAMETER_REGISTRY_VERSION = "2026-09-09";

const allowedParameters = ["p", "auccat", "brand_id", "istatus", "select", "n", "b"] as const;
const conditionIdByProductCondition: Readonly<Partial<Record<ProductCondition, 1 | 3 | 4 | 5 | 6 | 7>>> = {
  unused: 1,
  near_unused: 3,
  good: 4,
  fair: 5,
  poor: 6,
  very_poor: 7,
};

export type YahooRegistryStatus = "CONFIRMED" | "COMPATIBLE" | "DEPRECATED";
export interface YahooDimensionMapping {
  key: string;
  sourceId: string;
  canonicalName: string;
  aliases: string[];
  status: YahooRegistryStatus;
  verifiedAt: string;
  expiresAt?: string;
}

export interface YahooClosedSearchItem {
  sourceItemId: string;
  sourceType: "auction" | "fleamarket";
  canonicalUrl: string;
  title: string;
  closingPrice: number;
  endedAt: string;
  sourceCondition: string | null;
  normalizedCondition: ProductCondition;
  taxDisplay: "included" | "not_included" | "unknown";
  categoryId: string | null;
  brandId: string | null;
  contentHash: string;
}

export interface ParsedYahooClosedSearchPage {
  parserVersion: string;
  items: YahooClosedSearchItem[];
  sourceItemCount: number;
  parseFailureCount: number;
  totalResultsAvailable: number;
  pageSize: number;
  sourceSort: "-END_TIME";
  newestEndedAt: string | null;
  oldestEndedAt: string | null;
  responseHash: string;
}

export class YahooClosedSearchContractError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "YahooClosedSearchContractError";
  }
}

export function normalizeSearchKeyword(value: string): string {
  return value.normalize("NFKC").replace(/\s+/gu, " ").trim();
}

export function normalizeRegistryLabel(value: string): string {
  return normalizeSearchKeyword(value).toLocaleLowerCase("ja-JP");
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function validatedSourceId(value: string | undefined, field: string): string | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim();
  if (!/^[1-9]\d{0,18}$/u.test(normalized))
    throw new YahooClosedSearchContractError("PARAMETER_INVALID", `${field} is invalid`);
  return normalized;
}

function validatedOffset(offset: number): number {
  if (!Number.isSafeInteger(offset) || offset < 1 || (offset - 1) % MARKET_PRICE_POLICY.pageSize !== 0)
    throw new YahooClosedSearchContractError("PARAMETER_INVALID", "offset must be 1 + 100n");
  return offset;
}

export function mapProductConditions(conditions: readonly ProductCondition[]): Array<1 | 3 | 4 | 5 | 6 | 7> | undefined {
  if (!conditions.length)
    throw new YahooClosedSearchContractError("PARAMETER_INVALID", "at least one product condition is required");
  if (conditions.includes("unspecified")) return undefined;
  const mapped = conditions.map((condition) => conditionIdByProductCondition[condition]);
  if (mapped.some((value) => value === undefined))
    throw new YahooClosedSearchContractError("PARAMETER_INVALID", "product condition is invalid");
  return [...new Set(mapped as Array<1 | 3 | 4 | 5 | 6 | 7>)].sort((a, b) => a - b);
}

export function pageOffset(pageNumber: number): number {
  if (!Number.isSafeInteger(pageNumber) || pageNumber < 1 || pageNumber > MARKET_PRICE_POLICY.maxPages)
    throw new YahooClosedSearchContractError("PARAMETER_INVALID", "page number is invalid");
  return 1 + (pageNumber - 1) * MARKET_PRICE_POLICY.pageSize;
}

export function generateYahooClosedSearchUrl(
  input: YahooClosedSearchSpec,
  registryVersion = YAHOO_PARAMETER_REGISTRY_VERSION,
): GeneratedYahooSearchUrl {
  const keyword = normalizeSearchKeyword(input.keyword);
  if (!keyword || keyword.length > 200)
    throw new YahooClosedSearchContractError("PARAMETER_INVALID", "keyword is required and must be 200 characters or fewer");
  if (input.sort !== "ENDED_AT_NEWEST" || input.pageSize !== 100)
    throw new YahooClosedSearchContractError("PARAMETER_INVALID", "sort and page size are fixed");
  const categoryId = validatedSourceId(input.categoryId, "categoryId");
  const brandId = validatedSourceId(input.brandId, "brandId");
  const offset = validatedOffset(input.offset);
  const conditions = input.conditionIds
    ? [...new Set(input.conditionIds)].sort((a, b) => a - b)
    : undefined;
  if (conditions?.some((value) => ![1, 3, 4, 5, 6, 7].includes(value)))
    throw new YahooClosedSearchContractError("PARAMETER_INVALID", "conditionIds contain an unsupported value");

  const params = new URLSearchParams();
  params.set("p", keyword);
  if (categoryId) params.set("auccat", categoryId);
  if (brandId) params.set("brand_id", brandId);
  if (conditions?.length) params.set("istatus", conditions.join(","));
  params.set("select", String(YAHOO_CLOSED_SEARCH_SORT.ENDED_AT_NEWEST));
  params.set("n", String(MARKET_PRICE_POLICY.pageSize));
  params.set("b", String(offset));
  const canonicalParams = Object.fromEntries(params.entries());
  const url = `${YAHOO_CLOSED_SEARCH_ORIGIN}${YAHOO_CLOSED_SEARCH_PATH}?${params.toString()}`;
  const canonicalSpec = { keyword, categoryId, brandId, conditionIds: conditions, sort: input.sort, pageSize: input.pageSize, offset };
  const specHash = sha256(JSON.stringify(canonicalSpec));
  return { url, canonicalParams, generatorVersion: YAHOO_URL_GENERATOR_VERSION, registryVersion, specHash, urlHash: sha256(url) };
}

export function parseYahooClosedSearchUrl(value: string): YahooClosedSearchSpec {
  let url: URL;
  try { url = new URL(value); }
  catch { throw new YahooClosedSearchContractError("URL_INVALID", "Yahoo closed-search URL is invalid"); }
  if (url.origin !== YAHOO_CLOSED_SEARCH_ORIGIN || url.pathname.replace(/\/$/u, "") !== YAHOO_CLOSED_SEARCH_PATH || url.username || url.password || url.hash)
    throw new YahooClosedSearchContractError("URL_INVALID", "Yahoo closed-search origin or path is invalid");
  const keys = [...url.searchParams.keys()];
  if (new Set(keys).size !== keys.length || keys.some((key) => !allowedParameters.includes(key as typeof allowedParameters[number])))
    throw new YahooClosedSearchContractError("PARAMETER_INVALID", "URL contains unknown or duplicate parameters");
  const keyword = normalizeSearchKeyword(url.searchParams.get("p") ?? "");
  const select = Number(url.searchParams.get("select"));
  const pageSize = Number(url.searchParams.get("n"));
  const offset = Number(url.searchParams.get("b"));
  if (!keyword || select !== 6 || pageSize !== 100) throw new YahooClosedSearchContractError("PARAMETER_INVALID", "URL fixed parameters are invalid");
  validatedOffset(offset);
  const categoryId = validatedSourceId(url.searchParams.get("auccat") ?? undefined, "categoryId");
  const brandId = validatedSourceId(url.searchParams.get("brand_id") ?? undefined, "brandId");
  const conditionText = url.searchParams.get("istatus");
  const conditionIds = conditionText
    ? conditionText.split(",").map(Number).sort((a, b) => a - b) as Array<1 | 3 | 4 | 5 | 6 | 7>
    : undefined;
  if (conditionIds?.some((item) => ![1, 3, 4, 5, 6, 7].includes(item)))
    throw new YahooClosedSearchContractError("PARAMETER_INVALID", "URL condition is invalid");
  return {
    keyword,
    ...(categoryId ? { categoryId } : {}),
    ...(brandId ? { brandId } : {}),
    ...(conditionIds?.length ? { conditionIds } : {}),
    sort: "ENDED_AT_NEWEST",
    pageSize: 100,
    offset,
  };
}

export function resolveYahooDimensionMapping(
  value: string | null | undefined,
  mappings: readonly YahooDimensionMapping[],
  now = new Date(),
): YahooDimensionMapping | null {
  if (!value) return null;
  const needle = normalizeRegistryLabel(value);
  const matches = mappings.filter((mapping) => {
    if (!(["CONFIRMED", "COMPATIBLE"] as const).includes(mapping.status as "CONFIRMED" | "COMPATIBLE")) return false;
    if (mapping.expiresAt && new Date(mapping.expiresAt).getTime() < now.getTime()) return false;
    return [mapping.canonicalName, ...mapping.aliases].some((candidate) => normalizeRegistryLabel(candidate) === needle);
  });
  return matches.length === 1 ? matches[0]! : null;
}

function normalizedItemCondition(value: unknown): ProductCondition {
  switch (String(value ?? "")) {
    case "NEW": return "unused";
    case "USED10": return "near_unused";
    case "USED20": return "good";
    case "USED40": return "fair";
    case "USED60": return "poor";
    case "USED80": return "very_poor";
    default: return "unspecified";
  }
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new YahooClosedSearchContractError("PARSER_CONTRACT_MISMATCH", "Yahoo structured data object is missing");
  return value as Record<string, unknown>;
}

function finiteInteger(value: unknown, field: string, minimum = 0): number {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < minimum)
    throw new YahooClosedSearchContractError("PARSER_CONTRACT_MISMATCH", `${field} is invalid`);
  return result;
}

export function parseYahooClosedSearchHtml(html: string): ParsedYahooClosedSearchPage {
  if (Buffer.byteLength(html) > 5 * 1024 * 1024)
    throw new YahooClosedSearchContractError("RESPONSE_TOO_LARGE", "Yahoo response exceeds the parser limit");
  if (/captcha|画像認証|ロボットではないこと/u.test(html))
    throw new YahooClosedSearchContractError("CAPTCHA_DETECTED", "Yahoo CAPTCHA was detected");
  const match = html.match(/<script\s+id=["']__NEXT_DATA__["']\s+type=["']application\/json["']>([\s\S]*?)<\/script>/u);
  if (!match?.[1]) throw new YahooClosedSearchContractError("PARSER_CONTRACT_MISMATCH", "Yahoo structured data was not found");
  let root: Record<string, unknown>;
  try { root = object(JSON.parse(match[1])); }
  catch (error) {
    if (error instanceof YahooClosedSearchContractError) throw error;
    throw new YahooClosedSearchContractError("PARSER_CONTRACT_MISMATCH", "Yahoo structured data is invalid JSON");
  }
  const props = object(root.props);
  const pageProps = object(props.pageProps);
  const initialState = object(pageProps.initialState);
  const search = object(initialState.search);
  const items = object(search.items);
  const listing = object(items.listing);
  const metadata = object(listing.metadata);
  if (metadata.sort !== "-END_TIME" || finiteInteger(metadata.limit, "metadata.limit", 1) !== 100)
    throw new YahooClosedSearchContractError("SORT_CONTRACT_MISMATCH", "Yahoo result is not the requested newest-first 100-item page");
  if (!Array.isArray(listing.items)) throw new YahooClosedSearchContractError("PARSER_CONTRACT_MISMATCH", "Yahoo result items are missing");
  const totalResultsAvailable=finiteInteger(listing.totalResultsAvailable,"totalResultsAvailable");
  if(listing.items.length>100||totalResultsAvailable<listing.items.length)throw new YahooClosedSearchContractError("PARSER_CONTRACT_MISMATCH","Yahoo result count contract is invalid");
  const parsed:YahooClosedSearchItem[]=[];let parseFailureCount=0;
  for(const raw of listing.items){
    try{
      const item = object(raw);
      const sourceItemId = String(item.auctionId ?? "").trim();
      const title = String(item.title ?? "").normalize("NFKC").replace(/\s+/gu, " ").trim();
      const closingPrice = finiteInteger(item.price, "item.price", 1);
      const endedAt = String(item.endTime ?? "");
      if (!sourceItemId || !title || !Number.isFinite(Date.parse(endedAt)))
        throw new YahooClosedSearchContractError("PARSER_CONTRACT_MISMATCH", "Yahoo item identity or end time is invalid");
      const sourceType = item.isFleamarketItem === true ? "fleamarket" as const : "auction" as const;
      const canonicalUrl = sourceType === "fleamarket"
        ? `https://paypayfleamarket.yahoo.co.jp/item/${encodeURIComponent(sourceItemId)}`
        : `https://auctions.yahoo.co.jp/jp/auction/${encodeURIComponent(sourceItemId)}`;
      const sourceCondition = typeof item.itemCondition === "string" ? item.itemCondition : null;
      const category = item.category && typeof item.category === "object" ? item.category as Record<string, unknown> : null;
      parsed.push({
        sourceItemId,sourceType,canonicalUrl,title,closingPrice,endedAt:new Date(endedAt).toISOString(),sourceCondition,
        normalizedCondition: normalizedItemCondition(sourceCondition),
        taxDisplay: item.taxFlag === 1 ? "included" : item.taxFlag === 0 ? "not_included" : "unknown",
        categoryId: category?.id == null ? null : String(category.id),brandId:item.brandId == null ? null : String(item.brandId),
        contentHash: sha256(JSON.stringify({ sourceItemId, title, closingPrice, endedAt, sourceCondition })),
      });
    }catch(error){if(!(error instanceof YahooClosedSearchContractError))throw error;parseFailureCount+=1;}
  }
  if(listing.items.length>0&&(!parsed.length||parseFailureCount/listing.items.length>.05))
    throw new YahooClosedSearchContractError("PRICE_PARSE_FAILURE_RATE", "Yahoo item parsing failure rate exceeded the safety threshold");
  for (let index = 1; index < parsed.length; index++) {
    if (Date.parse(parsed[index - 1]!.endedAt) < Date.parse(parsed[index]!.endedAt))
      throw new YahooClosedSearchContractError("SORT_CONTRACT_MISMATCH", "Yahoo items are not ordered newest first");
  }
  return {
    parserVersion: YAHOO_RESULT_PARSER_VERSION,
    items: parsed,
    sourceItemCount:listing.items.length,
    parseFailureCount,
    totalResultsAvailable,
    pageSize: 100,
    sourceSort: "-END_TIME",
    newestEndedAt: parsed[0]?.endedAt ?? null,
    oldestEndedAt: parsed.at(-1)?.endedAt ?? null,
    responseHash: sha256(html),
  };
}

export function searchPeriod(startedAt: Date): { periodStart: Date; periodEnd: Date } {
  if (!Number.isFinite(startedAt.getTime())) throw new YahooClosedSearchContractError("PARAMETER_INVALID", "search start time is invalid");
  return { periodStart: new Date(startedAt.getTime() - MARKET_PRICE_POLICY.periodDays * 24 * 60 * 60 * 1_000), periodEnd: new Date(startedAt) };
}

export interface EvaluatedMarketPriceCandidate extends YahooClosedSearchItem {
  matchScore:number;
  matchReasons:string[];
  conditionMatched:boolean;
  exclusionReasons:string[];
  conditionGroupCount:number;
  conditionMedianPrice:number|null;
  priceDeviationRate:number|null;
  iqrLowerBound:number|null;
  iqrUpperBound:number|null;
  autoOutlier:boolean;
  included:boolean;
}

export interface MarketPriceStatistics {
  candidateCount:number;
  includedCount:number;
  minimumPrice:number|null;
  medianPriceBeforeOutlierExclusion:number|null;
  medianPrice:number|null;
  maximumPrice:number|null;
  exclusionCounts:Record<string,number>;
}

function median(values:readonly number[]):number|null{
  if(!values.length)return null;
  const sorted=[...values].sort((a,b)=>a-b);const middle=Math.floor(sorted.length/2);
  return sorted.length%2?sorted[middle]!:((sorted[middle-1]!+sorted[middle]!)/2);
}

function quantile(values:readonly number[],quantileValue:number):number|null{
  if(!values.length)return null;const sorted=[...values].sort((a,b)=>a-b);
  const position=(sorted.length-1)*quantileValue;const lower=Math.floor(position);const remainder=position-lower;
  return sorted[lower]!+(sorted[Math.min(lower+1,sorted.length-1)]!-sorted[lower]!)*remainder;
}

export function evaluateMarketPriceCandidates(input:{
  items:readonly YahooClosedSearchItem[];
  selectedKeyword:string;
  periodStart:Date;
  periodEnd:Date;
  selectedConditions:readonly ProductCondition[];
  excludeKeywords:readonly string[];
  outlierPolicy:MarketPriceOutlierPolicy;
}):{candidates:EvaluatedMarketPriceCandidate[];statistics:MarketPriceStatistics}{
  const conditions=new Set(input.selectedConditions);const omitConditionFilter=conditions.has("unspecified");
  const exclusions=input.excludeKeywords.map(normalizeSearchKeyword).filter(Boolean).map(value=>value.toLocaleLowerCase("ja-JP"));
  const keyword=normalizeSearchKeyword(input.selectedKeyword).toLocaleLowerCase("ja-JP");
  const queryTokens=[...new Set(keyword.split(/[\s\p{P}\p{S}]+/u).filter(token=>token.length>=2))];
  const modelTokens=queryTokens.filter(token=>/[a-z]*\d[\da-z-]*/iu.test(token));
  const accessorySignals=["ケース","カバー","バッテリー","充電器","ストラップ","箱のみ","空箱","部品取り","ジャンク","取扱説明書"];
  const initially=input.items.map(item=>{
    const reasons:string[]=[];const endedAt=Date.parse(item.endedAt);const title=item.title.toLocaleLowerCase("ja-JP");
    const matchedTokens=queryTokens.filter(token=>title.includes(token));
    const coverage=queryTokens.length?matchedTokens.length/queryTokens.length:(title.includes(keyword)?1:0);
    const missingModel=modelTokens.some(token=>!title.includes(token));
    const accessoryOnly=accessorySignals.some(signal=>title.includes(signal)&&!keyword.includes(signal));
    const matchScore=Math.max(0,Math.min(1,coverage*(missingModel?.35:1)*(accessoryOnly?.4:1)));
    const matchReasons=[`keyword_coverage:${matchedTokens.length}/${queryTokens.length}`,...(missingModel?["model_token_missing"]:[]),...(accessoryOnly?["accessory_signal"]:[])];
    if(matchScore<.75)reasons.push("product_mismatch");
    const conditionMatched=omitConditionFilter||conditions.has(item.normalizedCondition);
    if(item.sourceType!=="auction")reasons.push("source_type");
    if(endedAt<input.periodStart.getTime()||endedAt>input.periodEnd.getTime())reasons.push("period");
    if(!conditionMatched)reasons.push("condition");
    if(exclusions.some(keyword=>title.includes(keyword)))reasons.push("exclude_keyword");
    return{item,reasons,conditionMatched,matchScore,matchReasons};
  });
  const eligible=initially.filter(candidate=>candidate.reasons.length===0);
  const pricesByCondition=new Map<ProductCondition,number[]>();
  for(const candidate of eligible){const prices=pricesByCondition.get(candidate.item.normalizedCondition)??[];prices.push(candidate.item.closingPrice);pricesByCondition.set(candidate.item.normalizedCondition,prices);}
  const candidates=initially.map(({item,reasons,conditionMatched,matchScore,matchReasons}):EvaluatedMarketPriceCandidate=>{
    const prices=pricesByCondition.get(item.normalizedCondition)??[];const groupMedian=median(prices);const q1=quantile(prices,.25);const q3=quantile(prices,.75);const iqr=q1!=null&&q3!=null?q3-q1:null;
    const lower=q1!=null&&iqr!=null?Math.max(0,q1-1.5*iqr):null;const upper=q3!=null&&iqr!=null?q3+1.5*iqr:null;
    const deviation=groupMedian&&groupMedian>0?Math.abs(item.closingPrice-groupMedian)/groupMedian:null;
    const autoOutlier=reasons.length===0&&input.outlierPolicy.enabled&&prices.length>=input.outlierPolicy.minimumGroupSize&&deviation!=null&&deviation>input.outlierPolicy.deviationThreshold&&lower!=null&&upper!=null&&(item.closingPrice<lower||item.closingPrice>upper);
    const exclusionReasons=autoOutlier?[...reasons,"price_outlier"]:reasons;
    return{...item,matchScore,matchReasons,conditionMatched,exclusionReasons,conditionGroupCount:prices.length,conditionMedianPrice:groupMedian,priceDeviationRate:deviation,iqrLowerBound:lower,iqrUpperBound:upper,autoOutlier,included:exclusionReasons.length===0};
  });
  const preOutlier=candidates.filter(candidate=>candidate.exclusionReasons.length===0||candidate.exclusionReasons.every(reason=>reason==="price_outlier"));
  const included=candidates.filter(candidate=>candidate.included);const exclusionCounts:Record<string,number>={};
  for(const candidate of candidates)for(const reason of candidate.exclusionReasons)exclusionCounts[reason]=(exclusionCounts[reason]??0)+1;
  return{candidates,statistics:{candidateCount:candidates.length,includedCount:included.length,minimumPrice:included.length?Math.min(...included.map(item=>item.closingPrice)):null,medianPriceBeforeOutlierExclusion:median(preOutlier.map(item=>item.closingPrice)),medianPrice:median(included.map(item=>item.closingPrice)),maximumPrice:included.length?Math.max(...included.map(item=>item.closingPrice)):null,exclusionCounts}};
}

export interface MarketPriceEvaluationCase{
  relevantItemIds:string[];
  baselineItemIds:string[];
  enhancedItemIds:string[];
  baselinePages:number;
  enhancedPages:number;
  baselineDurationMs:number;
  enhancedDurationMs:number;
}

export interface MarketPriceEvaluationSummary{
  caseCount:number;
  precisionTop50Improvement:number;
  recallTop100Change:number;
  medianPageReduction:number;
  baselineMedianDurationMs:number;
  enhancedMedianDurationMs:number;
  baselineZeroResultRate:number;
  enhancedZeroResultRate:number;
}

export function summarizeMarketPriceEvaluation(cases:readonly MarketPriceEvaluationCase[]):MarketPriceEvaluationSummary{
  if(cases.length<30)throw new YahooClosedSearchContractError("EVALUATION_SAMPLE_TOO_SMALL","at least 30 anonymized products are required");
  const precision=(ids:string[],relevant:Set<string>)=>{const top=ids.slice(0,50);return top.length?top.filter(id=>relevant.has(id)).length/top.length:0;};
  const recall=(ids:string[],relevant:Set<string>)=>relevant.size?ids.slice(0,100).filter(id=>relevant.has(id)).length/relevant.size:0;
  const precisionDeltas:number[]=[],recallDeltas:number[]=[],pageReductions:number[]=[];
  for(const item of cases){const relevant=new Set(item.relevantItemIds);precisionDeltas.push(precision(item.enhancedItemIds,relevant)-precision(item.baselineItemIds,relevant));recallDeltas.push(recall(item.enhancedItemIds,relevant)-recall(item.baselineItemIds,relevant));pageReductions.push(item.baselinePages>0?(item.baselinePages-item.enhancedPages)/item.baselinePages:0);}
  const average=(values:number[])=>values.reduce((total,value)=>total+value,0)/values.length;
  return{caseCount:cases.length,precisionTop50Improvement:average(precisionDeltas),recallTop100Change:average(recallDeltas),medianPageReduction:median(pageReductions)??0,baselineMedianDurationMs:median(cases.map(item=>item.baselineDurationMs))??0,enhancedMedianDurationMs:median(cases.map(item=>item.enhancedDurationMs))??0,baselineZeroResultRate:cases.filter(item=>!item.baselineItemIds.length).length/cases.length,enhancedZeroResultRate:cases.filter(item=>!item.enhancedItemIds.length).length/cases.length};
}
