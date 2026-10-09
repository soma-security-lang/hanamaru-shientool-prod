/** eBay observations are deliberately separate from the existing JPY/90-day DTO. */
export const ebayMarkets = ["us", "uk", "ca", "au", "de", "fr", "it", "es"] as const;
export type EbayMarket = (typeof ebayMarkets)[number];
export const ebayMarketCurrencies = {
  us: "USD", uk: "GBP", ca: "CAD", au: "AUD", de: "EUR", fr: "EUR", it: "EUR", es: "EUR",
} as const;
export type EbayCurrency = (typeof ebayMarketCurrencies)[EbayMarket];
export const ebayConditions = ["new", "open_box", "refurbished", "used", "for_parts"] as const;
export type EbayCondition = (typeof ebayConditions)[number];
export type EbayBuyingFormat = "auction" | "buy_it_now" | "best_offer";

export interface SoldgraphPageRequest {
  keyword: string;
  market: EbayMarket;
  page: number;
  conditions: EbayCondition[];
  buyingFormat: EbayBuyingFormat | null;
}

export interface EbaySearchPlan {
  source: "ebay_soldgraph";
  periodMode: "source_sample";
  keyword: string;
  markets: EbayMarket[];
  conditions: EbayCondition[];
  buyingFormat: EbayBuyingFormat | null;
  pageSize: 200;
  maxPages: 20;
  maxPagesPerMarket: 10;
  initialReservedCredits: number;
  maximumInitialRows: number;
  specHash: string;
}

export interface EbayMoney {
  /** Exact base-10 amount, never silently interpreted as JPY. */
  amount: string;
  currency: EbayCurrency;
}

export type EbayPriceExclusion =
  | "missing_item_id" | "missing_title" | "invalid_price" | "currency_mismatch"
  | "price_range" | "best_offer_accepted" | "best_offer_unknown" | "observation_conflict";

export interface EbayObservation {
  observationKey: string;
  market: EbayMarket;
  sourceItemId: string | null;
  title: string;
  canonicalUrl: string | null;
  displayedPrice: EbayMoney | null;
  displayedShipping: EbayMoney | null;
  conditionGroup: EbayCondition | "unknown";
  sourceCondition: string | null;
  format: "auction" | "fixed_price" | "unknown";
  bestOfferAccepted: boolean | null;
  soldOn: string | null;
  datePrecision: "provider_inferred_year_date" | "unknown";
  location: { status: "country_explicit" | "unknown" | "conflicting"; countryCode: string | null; text: string | null };
  hardExclusions: EbayPriceExclusion[];
}

export interface ParsedSoldgraphPage {
  market: EbayMarket;
  page: number;
  nextPage: number | null;
  collectedAt: string;
  sourceCompleteness: "provider_page_only";
  observations: EbayObservation[];
}

export type SoldgraphEnvelope =
  | { requestId: string; status: "pending"; credits: 0; cached: boolean }
  | { requestId: string; status: "failed"; credits: 0; cached: boolean }
  | { requestId: string; status: "complete"; credits: 0 | 1; cached: boolean; result: unknown };

export interface SoldgraphUsage {
  plan: string;
  used: number;
  limit: number | null;
  remaining: number | null;
  extraRequests: number;
  window: "one_time" | "rolling_30_days";
  sharedAllowance: boolean;
  rateLimitPerMinute: number;
}

export interface SoldgraphPageProvider {
  submit(request: SoldgraphPageRequest, idempotencyKey: string): Promise<SoldgraphEnvelope>;
  poll(requestId: string): Promise<SoldgraphEnvelope>;
}

export type SoldgraphCreditState = "reserved" | "pending" | "charged" | "released" | "unknown";
export const soldgraphFailureClasses = ["EXTERNAL_DISABLED", "CONFIGURATION", "RATE_LIMIT", "PENDING_LIMIT",
  "QUOTA", "UPSTREAM_LIMIT", "IDEMPOTENCY_CONFLICT", "RESULT_UNKNOWN", "TRANSPORT", "CONTRACT"] as const;
export type SoldgraphFailureClass = (typeof soldgraphFailureClasses)[number];
export interface SoldgraphCheckpoint {
  operationKey: string;
  searchId: string;
  request: SoldgraphPageRequest;
  attempt: number;
  requestId: string | null;
  creditState: SoldgraphCreditState;
  credits: 0 | 1 | null;
  state: "reserved" | "dispatching" | "pending" | "complete" | "failed" | "unknown" | "parse_failed" | "cancelled" | "blocked";
  failureClass: SoldgraphFailureClass | "PARSE_FAILED" | null;
  retryNotBefore?: string | null;
  result: ParsedSoldgraphPage | null;
  version: number;
}

export interface EbayObservationDecision {
  observation: EbayObservation;
  productMatch?: { status: "matched" | "mismatch" | "unknown"; reasons: string[]; version: string };
  included: boolean;
  reasons: string[];
  autoOutlier: boolean;
}

export interface EbayMarketStatistics {
  market: EbayMarket;
  currency: EbayCurrency;
  receivedRows: number;
  uniqueObservations: number;
  includedCount: number;
  minimum: string | null;
  median: string | null;
  maximum: string | null;
  p25: string | null;
  p75: string | null;
  primaryExclusionCounts: Record<string, number>;
  locationQuality?: { denominator: number; explicitCountryCount: number; unknownCount: number; conflictingCount: number; identifiedRate: number | null };
  buyingFormatQuality?: { denominator: number; auctionCount: number; fixedPriceCount: number; unknownCount: number; auctionRate: number | null };
  /** Absent in historical snapshots; never reconstruct those from newer candidates. */
  histogram?: { version: "ebay-histogram-v1"; populationHash: string; populationCount: number;
    bins: Array<{ lower: string; upper: string; upperInclusive: boolean; count: number }> };
  decisions: EbayObservationDecision[];
}

export interface EbaySearchSelection {
  markets: EbayMarket[];
  conditions: EbayCondition[];
  buyingFormat: EbayBuyingFormat | null;
  consumptionConfirmed: boolean;
}
export interface EbaySearchDetailDto {
  identificationId?: string;
  exclusionKeywords?: string[];
  acquisitionMode?: "reuse" | "latest";
  id: string; status: string; lockVersion: number; plan: EbaySearchPlan; outlierPercent: number;
  runs: Array<{ market: EbayMarket; status: string; nextPage: number | null; failureClass: string | null }>;
  pages: Array<{ market: EbayMarket; pageNumber: number; attempt: number; state: string; creditState: string; credits: number | null; updatedAt: string; cacheHit?: boolean; collectedAt?: string | null; failureClass?: string | null; retryNotBefore?: string | null; canResume?: boolean }>;
  observations: Array<{ id: string; observationJson: EbayObservation; manualDecision: string; lockVersion: string; decisionReason: string | null }>;
  statistics: EbayMarketStatistics[];
  counts: { uniqueItemIds: number };
  snapshots: Array<{ id: string; snapshotVersion: number; snapshotHash: string; confirmedAt: string; snapshotJson: { statistics: EbayMarketStatistics[]; incomplete: boolean; coverage: string } }>;
}
