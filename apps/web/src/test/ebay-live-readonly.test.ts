import { describe, expect, it } from "vitest";
import type { EbaySearchDetailDto } from "@hanamaru/contracts";
import { ebayReadOnlyConfig, readOnlyResultEvidence } from "./ebay-live-readonly";

const searchId = "00000000-0000-4000-8000-000000000067";
const env = { LIVE_EBAY_READONLY_E2E: "1", LIVE_EBAY_SYNTHETIC_SCOPE_CONFIRMED: "1", REAL_STACK_E2E: "1", E2E_REMOTE: "1", E2E_INCLUDE_WEBKIT: "1",
  LIVE_EBAY_CONFIRMED_SEARCH_ID: searchId, LIVE_EBAY_EXPECTED_MEMBERSHIP_ID: "00000000-0000-4000-8000-000000000101",
  E2E_WEB_BASE_URL: "https://hanamaru-pilot-stage-web-example-an.a.run.app", E2E_API_BASE_URL: "https://hanamaru-pilot-api-example-an.a.run.app/api/v1" };
const result = () => ({ id: searchId, status: "confirmed", lockVersion: 2,
  runs: [{ market: "us", status: "complete", nextPage: null, failureClass: null }],
  pages: [{ market: "us", pageNumber: 1, attempt: 1, state: "complete", creditState: "charged", credits: 1, updatedAt: "2026-10-09T00:00:00Z" }],
  snapshots: [{ id: searchId, snapshotVersion: 1, snapshotHash: "a".repeat(64), confirmedAt: "2026-10-09T00:00:00Z",
    snapshotJson: { statistics: [{ market: "us", currency: "USD" }], incomplete: false, coverage: "provider_page_only" } }],
}) as unknown as EbaySearchDetailDto;

describe("opt-in eBay live readback gate", () => {
  it("does not enable live calls implicitly", () => expect(ebayReadOnlyConfig({})).toBeNull());
  it("requires explicit synthetic scope confirmation", () => expect(() => ebayReadOnlyConfig({ ...env, LIVE_EBAY_SYNTHETIC_SCOPE_CONFIRMED: undefined })).toThrow());
  it("accepts an explicit dual-browser fixed Stage readback", () => expect(ebayReadOnlyConfig(env)?.searchId).toBe(searchId));
  it("also accepts the approved Firebase public origin", () => expect(ebayReadOnlyConfig({ ...env, E2E_WEB_BASE_URL: "https://monocle-503402.firebaseapp.com/" })?.webOrigin).toBe("https://monocle-503402.firebaseapp.com"));
  it.each(["E2E_REMOTE", "E2E_INCLUDE_WEBKIT", "REAL_STACK_E2E"])("rejects missing %s instead of skipping acceptance", key => {
    expect(() => ebayReadOnlyConfig({ ...env, [key]: undefined })).toThrow();
  });
  it.each(["LIVE_EBAY_CONFIRMED_SEARCH_ID", "LIVE_EBAY_EXPECTED_MEMBERSHIP_ID"])("requires approved ID %s", key => {
    expect(() => ebayReadOnlyConfig({ ...env, [key]: "not-an-id" })).toThrow();
  });
  it.each(["http://hanamaru-pilot-stage-web-example-an.a.run.app", "https://user:secret@example.invalid",
    "https://hanamaru-pilot-stage-web-example-an.a.run.app?token=secret", "https://example.com", "https://monocle-503402.firebaseapp.com/market-price"])("rejects unsafe Web origin", value => {
    expect(() => ebayReadOnlyConfig({ ...env, E2E_WEB_BASE_URL: value })).toThrow();
  });
  it("does not accept another API or an arbitrary path", () => {
    expect(() => ebayReadOnlyConfig({ ...env, E2E_API_BASE_URL: "https://example.com/api/v1" })).toThrow();
    expect(() => ebayReadOnlyConfig({ ...env, E2E_API_BASE_URL: env.E2E_API_BASE_URL + "/market-price" })).toThrow();
  });
  it("compares minimal unchanged snapshot and credit evidence", () => {
    expect(readOnlyResultEvidence(result(), searchId)).toBe(readOnlyResultEvidence(result(), searchId));
    const changed = result(); changed.lockVersion++;
    expect(readOnlyResultEvidence(changed, searchId)).not.toBe(readOnlyResultEvidence(result(), searchId));
  });
  it.each(["reserved", "pending", "unknown"])("rejects unsettled %s credit", value => {
    const changed = result(); changed.pages[0]!.creditState = value;
    expect(() => readOnlyResultEvidence(changed, searchId)).toThrow();
  });
  it("rejects inconsistent settled credits and accepts a cached zero-credit page", () => {
    const changed = result(); changed.pages[0]!.credits = 0;
    expect(() => readOnlyResultEvidence(changed, searchId)).toThrow();
    changed.pages[0]!.creditState = "released";
    expect(() => readOnlyResultEvidence(changed, searchId)).not.toThrow();
    changed.pages[0]!.credits = 1;
    expect(() => readOnlyResultEvidence(changed, searchId)).toThrow();
  });
  it("rejects absent snapshot and foreign-currency mixing", () => {
    const absent = result(); absent.snapshots = [];
    expect(() => readOnlyResultEvidence(absent, searchId)).toThrow();
    const changed = result(); changed.snapshots[0]!.snapshotJson.statistics[0]!.currency = "GBP";
    expect(() => readOnlyResultEvidence(changed, searchId)).toThrow();
  });
});
