import { describe, expect, it, vi } from "vitest";
import { ebayMarkets, type SoldgraphEnvelope, type SoldgraphPageProvider, type SoldgraphPageRequest } from "@hanamaru/contracts";
import {
  advanceSoldgraphPage, cancelUnsentSoldgraphPage, explicitlyRetryFailedSoldgraphPage,
  newSoldgraphCheckpoint, soldgraphBudgetHeld, type SoldgraphCheckpoint, type SoldgraphCheckpointStore,
} from "./soldgraph-workflow.js";

const request: SoldgraphPageRequest = { keyword: "SYNTHETIC CAMERA X1", market: "us", page: 1, conditions: [], buyingFormat: null };
const initial = () => newSoldgraphCheckpoint("synthetic-search", request);
const pending = (id = "job-1"): SoldgraphEnvelope => ({ requestId: id, status: "pending", credits: 0, cached: false });
const complete = (credits: 0 | 1 = 1): SoldgraphEnvelope => ({ requestId: "job-1", status: "complete", credits, cached: false,
  result: { provider: "ebay", country: "us", query: request.keyword, page: 1, page_size: 200, count: 0,
    next_page: null, collected_at: "2026-10-09T00:00:00Z", schema_version: 2, completeness: "provider_page_only", data: [] } });
function store(start = initial()) {
  let state = structuredClone(start);
  const saves: SoldgraphCheckpoint[] = [];
  const repository: SoldgraphCheckpointStore = {
    load: vi.fn(async key => { if (state.operationKey !== key) throw new Error("NOT_FOUND"); return structuredClone(state); }),
    save: vi.fn(async (next, expectedVersion) => {
      if (state.version !== expectedVersion) throw new Error("VERSION_CONFLICT");
      state = structuredClone(next); saves.push(structuredClone(next));
    }),
  };
  return { repository, saves, read: () => structuredClone(state) };
}
function provider(response: SoldgraphEnvelope = pending()): SoldgraphPageProvider {
  return { submit: vi.fn(async () => response), poll: vi.fn(async () => response) };
}
const allowed = async () => true;

describe("Soldgraph one-page checkpoint execution (synthetic only)", () => {
  it.each(["CONFIGURATION","QUOTA","UPSTREAM_LIMIT","IDEMPOTENCY_CONFLICT","EXTERNAL_DISABLED","CONTRACT"])("stops classified %s errors without declaring the reservation free",async failureClass=>{
    const db=store(),api=provider();
    vi.mocked(api.submit).mockRejectedValue(Object.assign(new Error("synthetic raw text must not be saved"),{name:"SoldgraphProviderError",failureClass}));
    const stopped=await advanceSoldgraphPage(db.repository,api,initial().operationKey,allowed);
    expect(stopped).toMatchObject({state:"blocked",failureClass,creditState:"unknown",credits:null});
    expect(JSON.stringify(stopped)).not.toContain("raw text");
    await advanceSoldgraphPage(db.repository,api,initial().operationKey,allowed);
    expect(api.submit).toHaveBeenCalledTimes(1);
    expect(soldgraphBudgetHeld([stopped])).toBe(1);
  });
  it.each(["RATE_LIMIT","PENDING_LIMIT","TRANSPORT"])("preserves %s and waits until Retry-After before reusing the key",async failureClass=>{
    const db=store(),api=provider(),start=Date.parse("2026-10-09T00:00:00Z");
    vi.mocked(api.submit).mockRejectedValueOnce(Object.assign(new Error("synthetic unsafe message"),{name:"SoldgraphProviderError",failureClass,retryAfterSeconds:600}));
    const delayed=await advanceSoldgraphPage(db.repository,api,initial().operationKey,allowed,()=>start);
    expect(delayed).toMatchObject({state:"unknown",failureClass,retryNotBefore:"2026-10-09T00:10:00.000Z",credits:null});
    const permission=vi.fn(allowed);
    await advanceSoldgraphPage(db.repository,api,initial().operationKey,permission,()=>start+599_000);
    expect(permission).not.toHaveBeenCalled();expect(api.submit).toHaveBeenCalledTimes(1);
    const resumed=await advanceSoldgraphPage(db.repository,api,initial().operationKey,permission,()=>start+600_000);
    expect(resumed).toMatchObject({state:"pending",failureClass:null,retryNotBefore:null});
    expect(vi.mocked(api.submit).mock.calls[1]).toEqual(vi.mocked(api.submit).mock.calls[0]);
  });
  it("does not release already charged accounting when polling a saved parse failure is rate limited",async()=>{
    const db=store({...initial(),state:"parse_failed",requestId:"job-1",creditState:"charged",credits:1}),api=provider();
    vi.mocked(api.poll).mockRejectedValue(Object.assign(new Error("ignored"),{name:"SoldgraphProviderError",failureClass:"RATE_LIMIT",retryAfterSeconds:60}));
    const delayed=await advanceSoldgraphPage(db.repository,api,initial().operationKey,allowed);
    expect(delayed).toMatchObject({failureClass:"RATE_LIMIT",creditState:"charged",credits:1,requestId:"job-1"});
    expect(soldgraphBudgetHeld([delayed])).toBe(1);expect(api.submit).not.toHaveBeenCalled();
  });
  it("does not persist arbitrary failure classes or invalid retry intervals",async()=>{
    const db=store(),api=provider();
    vi.mocked(api.submit).mockRejectedValue(Object.assign(new Error("ignored"),{name:"SoldgraphProviderError",failureClass:"SECRET_VALUE",retryAfterSeconds:-1}));
    const unknown=await advanceSoldgraphPage(db.repository,api,initial().operationKey,allowed);
    expect(unknown).toMatchObject({failureClass:"RESULT_UNKNOWN",retryNotBefore:null});
  });
  it("persists dispatch key before submitting; pending retains one reserved credit", async () => {
    const db = store(), api = provider();
    vi.mocked(api.submit).mockImplementation(async () => {
      expect(db.read().state).toBe("dispatching");
      expect(db.read().operationKey).toBe(initial().operationKey);
      return pending();
    });
    const result = await advanceSoldgraphPage(db.repository, api, initial().operationKey, allowed);
    expect(result).toMatchObject({ state: "pending", requestId: "job-1", creditState: "pending", credits: null });
    expect(soldgraphBudgetHeld([result])).toBe(1);
    expect(api.poll).not.toHaveBeenCalled();
  });
  it("resumes by ID, charges an empty successful page once, and does not re-poll completed data", async () => {
    const db = store(), api = provider();
    await advanceSoldgraphPage(db.repository, api, initial().operationKey, allowed);
    vi.mocked(api.poll).mockResolvedValue(complete());
    const result = await advanceSoldgraphPage(db.repository, api, initial().operationKey, allowed);
    expect(result).toMatchObject({ state: "complete", credits: 1, creditState: "charged", result: { observations: [] } });
    expect(api.submit).toHaveBeenCalledTimes(1);
    expect(api.poll).toHaveBeenCalledWith("job-1");
    expect(soldgraphBudgetHeld([initial(), ...db.saves, result, result])).toBe(1);
    await advanceSoldgraphPage(db.repository, api, initial().operationKey, allowed);
    expect(api.poll).toHaveBeenCalledTimes(1);
  });
  it("records a provider-confirmed free terminal page, never inferring credits from row count", async () => {
    const db = store();
    const result = await advanceSoldgraphPage(db.repository, provider(complete(0)), initial().operationKey, allowed);
    expect(result).toMatchObject({ state: "complete", credits: 0, creditState: "released" });
    expect(soldgraphBudgetHeld([result])).toBe(0);
  });
  it("reuses the same key and parameters after a response is lost", async () => {
    const db = store(), api = provider();
    vi.mocked(api.submit).mockRejectedValueOnce(new Error("synthetic connection lost"));
    const unknown = await advanceSoldgraphPage(db.repository, api, initial().operationKey, allowed);
    expect(unknown).toMatchObject({ state: "unknown", creditState: "unknown", requestId: null });
    expect(soldgraphBudgetHeld([unknown])).toBe(1);
    expect(() => explicitlyRetryFailedSoldgraphPage(unknown)).toThrow("SOLDGRAPH_RETRY_NOT_CONFIRMED_FREE");
    await advanceSoldgraphPage(db.repository, api, initial().operationKey, allowed);
    expect(vi.mocked(api.submit).mock.calls[0]).toEqual(vi.mocked(api.submit).mock.calls[1]);
  });
  it("does not lose already charged accounting on parse failure and reuses the saved result job", async () => {
    const db = store(), api = provider({ ...complete(), result: { invalid: true } } as SoldgraphEnvelope);
    const failed = await advanceSoldgraphPage(db.repository, api, initial().operationKey, allowed);
    expect(failed).toMatchObject({ state: "parse_failed", requestId: "job-1", credits: 1, creditState: "charged" });
    expect(soldgraphBudgetHeld([failed])).toBe(1);
    expect(() => explicitlyRetryFailedSoldgraphPage(failed)).toThrow("SOLDGRAPH_RETRY_NOT_CONFIRMED_FREE");
    vi.mocked(api.poll).mockResolvedValue(complete());
    const resumed = await advanceSoldgraphPage(db.repository, api, initial().operationKey, allowed);
    expect(resumed.state).toBe("complete");
    expect(api.submit).toHaveBeenCalledTimes(1);
    expect(soldgraphBudgetHeld([failed, resumed])).toBe(1);
  });
  it("can recover a storage failure after credit accounting without another submission", async () => {
    const db = store(), api = provider(complete());
    const save = db.repository.save;
    db.repository.save = vi.fn(async (next, version) => {
      if (next.state === "complete") throw new Error("SYNTHETIC_STORAGE_FAILURE");
      await save(next, version);
    });
    await expect(advanceSoldgraphPage(db.repository, api, initial().operationKey, allowed)).rejects.toThrow("SYNTHETIC_STORAGE_FAILURE");
    expect(db.read()).toMatchObject({ credits: 1, requestId: "job-1", creditState: "charged" });
    db.repository.save = save;
    expect((await advanceSoldgraphPage(db.repository, api, initial().operationKey, allowed)).state).toBe("complete");
    expect(api.submit).toHaveBeenCalledTimes(1);
    expect(api.poll).toHaveBeenCalledTimes(1);
  });
  it("needs an explicit new attempt only after provider-confirmed zero-credit failure", async () => {
    const db = store(), api = provider({ status: "failed", requestId: "job-1", credits: 0, cached: false });
    const failed = await advanceSoldgraphPage(db.repository, api, initial().operationKey, allowed);
    expect(soldgraphBudgetHeld([failed])).toBe(0);
    const retry = explicitlyRetryFailedSoldgraphPage(failed);
    expect(retry).toMatchObject({ attempt: 2, state: "reserved", requestId: null, credits: null });
    expect(retry.operationKey).not.toBe(failed.operationKey);
    await advanceSoldgraphPage(db.repository, api, failed.operationKey, allowed);
    expect(api.submit).toHaveBeenCalledTimes(1);
  });
  it("refuses cancellation refunds once dispatch has begun", () => {
    expect(soldgraphBudgetHeld([cancelUnsentSoldgraphPage(initial())])).toBe(0);
    expect(() => cancelUnsentSoldgraphPage({ ...initial(), state: "dispatching" })).toThrow("SOLDGRAPH_RESULT_RECONCILIATION_REQUIRED");
  });
  it("stops both new submission and poll on kill switch without dropping checkpoint", async () => {
    const db = store(), api = provider();
    await expect(advanceSoldgraphPage(db.repository, api, initial().operationKey, async () => false)).rejects.toThrow("SOLDGRAPH_DISABLED");
    expect(api.submit).not.toHaveBeenCalled();
    await advanceSoldgraphPage(db.repository, api, initial().operationKey, allowed);
    await expect(advanceSoldgraphPage(db.repository, api, initial().operationKey, async () => false)).rejects.toThrow("SOLDGRAPH_DISABLED");
    expect(api.poll).not.toHaveBeenCalled();
    expect(db.read().state).toBe("pending");
  });
  it("a losing concurrent CAS never submits a second operation", async () => {
    const db = store(), api = provider();
    const result = await Promise.allSettled([advanceSoldgraphPage(db.repository, api, initial().operationKey, allowed),
      advanceSoldgraphPage(db.repository, api, initial().operationKey, allowed)]);
    expect(result.filter(r => r.status === "fulfilled")).toHaveLength(1);
    expect(api.submit).toHaveBeenCalledTimes(1);
  });
  it("normal stopping reconciles accepted jobs without publishing candidates or submitting new jobs", async () => {
    const db = store(), api = provider();
    await expect(advanceSoldgraphPage(db.repository, api, initial().operationKey, async () => "reconcile_only")).rejects.toThrow("SOLDGRAPH_DISABLED");
    expect(api.submit).not.toHaveBeenCalled();
    await advanceSoldgraphPage(db.repository, api, initial().operationKey, allowed);
    vi.mocked(api.poll).mockResolvedValue(complete());
    const reconciled = await advanceSoldgraphPage(db.repository, api, initial().operationKey, async () => "reconcile_only");
    expect(reconciled).toMatchObject({ creditState: "charged", credits: 1, result: null, state: "pending" });
    expect(api.submit).toHaveBeenCalledTimes(1);
    expect((await advanceSoldgraphPage(db.repository, api, initial().operationKey, allowed)).state).toBe("complete");
    expect(api.submit).toHaveBeenCalledTimes(1);
  });
  it("never accepts an external ID or terminal credits that change during resume", async () => {
    const db = store(), api = provider();
    await advanceSoldgraphPage(db.repository, api, initial().operationKey, allowed);
    vi.mocked(api.poll).mockResolvedValue(pending("different-job"));
    await expect(advanceSoldgraphPage(db.repository, api, initial().operationKey, allowed)).rejects.toThrow("SOLDGRAPH_REQUEST_ID_CONFLICT");
    const charged = store({ ...initial(), state: "parse_failed", requestId: "job-1", creditState: "charged", credits: 1 });
    vi.mocked(api.poll).mockResolvedValue(complete(0));
    await expect(advanceSoldgraphPage(charged.repository, api, initial().operationKey, allowed)).rejects.toThrow("SOLDGRAPH_LEDGER_CONFLICT");
    expect(charged.read().credits).toBe(1);
  });
  it("keeps successful markets while others fail or have unknown results", () => {
    const checkpoints = ebayMarkets.map((market, i): SoldgraphCheckpoint => ({ ...newSoldgraphCheckpoint("synthetic-search", { ...request, market }),
      state: i < 6 ? "complete" : i === 6 ? "failed" : "unknown", requestId: i < 7 ? `job-${i}` : null,
      creditState: i < 6 ? "charged" : i === 6 ? "released" : "unknown", credits: i < 6 ? 1 : i === 6 ? 0 : null }));
    expect(soldgraphBudgetHeld(checkpoints)).toBe(7);
  });
  it("rejects two operations claiming ownership of a single external request", () => {
    const first = { ...initial(), requestId: "job-1" };
    const second = { ...newSoldgraphCheckpoint("another-search", request), requestId: "job-1" };
    expect(() => soldgraphBudgetHeld([first, second])).toThrow("SOLDGRAPH_REQUEST_OWNERSHIP_CONFLICT");
  });
});
