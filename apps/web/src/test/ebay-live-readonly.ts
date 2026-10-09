import type { EbaySearchDetailDto } from "@hanamaru/contracts";
import { ebayMarketCurrencies, ebayMarkets } from "@hanamaru/contracts";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
export interface EbayReadOnlyConfig { searchId: string; membershipId: string; webOrigin: string; apiBase: string }

/** Opt-in readback only: no credentials, external calls or product mutations. */
export function ebayReadOnlyConfig(env: Record<string, string | undefined>): EbayReadOnlyConfig | null {
  if (env.LIVE_EBAY_READONLY_E2E !== "1") return null;
  if (env.LIVE_EBAY_SYNTHETIC_SCOPE_CONFIRMED !== "1") throw new Error("Dedicated synthetic test scope confirmation is required");
  if (env.REAL_STACK_E2E !== "1" || env.E2E_REMOTE !== "1" || env.E2E_INCLUDE_WEBKIT !== "1") {
    throw new Error("eBay readback requires remote live-stack mode and both browser projects");
  }
  const searchId = env.LIVE_EBAY_CONFIRMED_SEARCH_ID ?? "";
  const membershipId = env.LIVE_EBAY_EXPECTED_MEMBERSHIP_ID ?? "";
  if (!uuid.test(searchId) || !uuid.test(membershipId)) throw new Error("Approved synthetic search and membership IDs are required");
  const web = approvedUrl(env.E2E_WEB_BASE_URL);
  const api = approvedUrl(env.E2E_API_BASE_URL);
  const webAllowed = web.hostname === "monocle-503402.firebaseapp.com" || /^hanamaru-pilot-(?:stage-)?web-[a-z0-9-]+\.a\.run\.app$/u.test(web.hostname);
  if (!webAllowed || web.pathname !== "/" || !/^hanamaru-pilot-api-[a-z0-9-]+\.a\.run\.app$/u.test(api.hostname) || !/^\/api\/v1\/?$/u.test(api.pathname)) {
    throw new Error("eBay readback must use approved hanamaru-pilot Web and API origins");
  }
  return { searchId, membershipId, webOrigin: web.origin, apiBase: api.href.replace(/\/$/u, "") };
}

function approvedUrl(value: string | undefined): URL {
  let url: URL;
  try { url = new URL(value ?? ""); } catch { throw new Error("Explicit HTTPS live origins are required"); }
  if (url.protocol !== "https:" || url.username || url.password || url.port || url.search || url.hash) {
    throw new Error("Live origins cannot contain credentials, ports, query strings or fragments");
  }
  return url;
}

/** Reject pending accounting so another active job cannot be mistaken for readback. */
export function readOnlyResultEvidence(detail: EbaySearchDetailDto, expectedSearchId: string): string {
  if (detail.id !== expectedSearchId || detail.status !== "confirmed" || !Array.isArray(detail.pages) || !detail.pages.length ||
      !Array.isArray(detail.snapshots) || !detail.snapshots.length || !Array.isArray(detail.runs) || !detail.runs.length) {
    throw new Error("An accessible confirmed synthetic result is required");
  }
  if (detail.pages.some(page => !["charged", "released"].includes(page.creditState) ||
      !["complete", "failed", "cancelled"].includes(page.state) ||
      (page.creditState === "charged" ? page.credits !== 1 : page.credits !== 0))) {
    throw new Error("Readback requires settled pages without pending or unknown credits");
  }
  const snapshot = detail.snapshots[0];
  const stats = snapshot?.snapshotJson?.statistics;
  if (!snapshot || !Number.isInteger(snapshot.snapshotVersion) || snapshot.snapshotVersion < 1 ||
      !/^[0-9a-f]{64}$/iu.test(snapshot.snapshotHash) || !Array.isArray(stats) || !stats.length ||
      new Set(stats.map(stat => stat.market)).size !== stats.length ||
      stats.some(stat => !ebayMarkets.includes(stat.market) || stat.currency !== ebayMarketCurrencies[stat.market]) ||
      detail.runs.some(run => !stats.some(stat => stat.market === run.market))) {
    throw new Error("Saved snapshot market and currency evidence is incomplete");
  }
  // Never print this value: assertions compare booleans, not full product DTOs.
  return JSON.stringify({ id: detail.id, version: detail.lockVersion, snapshotHash: snapshot.snapshotHash,
    snapshotVersion: snapshot.snapshotVersion, pages: detail.pages.map(page => ({ market: page.market,
      page: page.pageNumber, attempt: page.attempt, state: page.state, creditState: page.creditState, credits: page.credits })) });
}
