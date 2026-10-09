import type { SoldgraphEnvelope, SoldgraphPageProvider, SoldgraphPageRequest } from "@hanamaru/contracts";
import { ebayMarketCurrencies } from "@hanamaru/contracts";

/** Explicit local/test fixture. Never installed by GCP or local-connected factories. */
export function createSoldgraphFixtureProvider(): SoldgraphPageProvider {
  const completed = new Map<string, SoldgraphEnvelope>();
  return {
    async submit(request: SoldgraphPageRequest, key: string) {
      if (process.env.NODE_ENV !== "test" && process.env.LOCAL_PROVIDER_TEST_FIXTURES !== "enabled") throw new Error("SOLDGRAPH_FIXTURE_DISABLED");
      if (!/^sg-[a-f0-9]{64}$/.test(key)) throw new Error("SOLDGRAPH_FIXTURE_KEY_INVALID");
      const requestId = `synthetic-${key.slice(3)}`;
      const previous = completed.get(requestId);
      if (previous) return previous;
      const currency = ebayMarketCurrencies[request.market];
      const data = [100,105,110,115,120,800].map((amount, index) => ({
        id: String(100000000000 + (request.page - 1) * 10 + index), title: request.keyword,
        link: `https://www.ebay.${request.market === "uk" ? "co.uk" : request.market === "au" ? "com.au" : request.market === "us" ? "com" : request.market}/itm/${100000000000 + (request.page - 1) * 10 + index}`,
        displayed_price: { amount, currency }, displayed_shipping: null, displayed_price_range: null,
        best_offer_accepted: false, condition: "used", format: "fixed_price", sold_date: "2026-10-01", location_text: null,
      }));
      const envelope: SoldgraphEnvelope = { requestId, status: "complete", credits: 1, cached: false,
        result: { provider: "ebay", country: request.market, query: request.keyword, page: request.page, page_size: 200,
          count: data.length, next_page: request.page === 1 ? 2 : null, collected_at: new Date().toISOString(), schema_version: 2,
          completeness: "provider_page_only", data } };
      completed.set(requestId, envelope);
      return envelope;
    },
    async poll(requestId) {
      if (process.env.NODE_ENV !== "test" && process.env.LOCAL_PROVIDER_TEST_FIXTURES !== "enabled") throw new Error("SOLDGRAPH_FIXTURE_DISABLED");
      const result = completed.get(requestId);
      if (!result) throw new Error("SOLDGRAPH_FIXTURE_RESULT_UNKNOWN");
      return result;
    },
  };
}
