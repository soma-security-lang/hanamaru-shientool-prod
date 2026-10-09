import type { EbaySearchDetailDto, EbaySearchPlan, EbaySearchSelection, MarketPriceSearchBasis } from "@hanamaru/contracts";
import { apiClient } from "./client";

export const ebayMarketPriceResources = {
  operationResult: (key:string,action:string) => apiClient.request<{status:"unknown"|"succeeded";action:string;searchId:string|null}>(`/market-price/ebay/operations/${encodeURIComponent(key)}?${new URLSearchParams({action})}`),
  create: (input: EbaySearchSelection & { identificationId: string; selectedSearchQueryId: string | null; searchBasis: MarketPriceSearchBasis }, key: string) =>
    apiClient.request<{ searchId: string; reservedCredits: number }>("/market-price/ebay/searches", { method: "POST", body: JSON.stringify(input), headers: { "idempotency-key": key } }),
  get: (id: string) => apiClient.request<EbaySearchDetailDto>(`/market-price/ebay/searches/${encodeURIComponent(id)}`),
  list: () => apiClient.request<{items:Array<{id:string;status:string;planJson:EbaySearchPlan;createdAt:string;lockVersion:string}>}>("/market-price/ebay/searches"),
  mutate: (id: string, action: "confirm" | "cancel" | "retry" | "resume" | "repeat" | "next-page" | "outlier-policy" | `candidates/${string}`, body: Record<string, unknown>, key: string) =>
    apiClient.request<unknown>(`/market-price/ebay/searches/${encodeURIComponent(id)}/${action}`, {
      method: action === "outlier-policy" || action.startsWith("candidates/") ? "PATCH" : "POST",
      body: JSON.stringify(body), headers: { "idempotency-key": key },
    }),
};
