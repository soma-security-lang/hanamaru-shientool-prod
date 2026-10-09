import { soldgraphFailureClasses, type SoldgraphFailureClass, type ParsedSoldgraphPage, type SoldgraphCheckpoint, type SoldgraphPageProvider, type SoldgraphPageRequest } from "@hanamaru/contracts";
import { parseSoldgraphPage, soldgraphOperationKey, validateSoldgraphPageRequest } from "./soldgraph.js";

export type { SoldgraphCheckpoint, SoldgraphCreditState } from "@hanamaru/contracts";

/**
 * Persistence boundary: transactionally reserve account/org budgets before create;
 * execute one step under a per-operation lease; save via version CAS; enforce unique
 * (provider account, request ID) and operation key. No in-memory production fallback.
 */
export interface SoldgraphCheckpointStore {
  load(operationKey: string): Promise<SoldgraphCheckpoint>;
  save(next: SoldgraphCheckpoint, expectedVersion: number): Promise<void>;
}

/** Normal stopping permits cost reconciliation only; emergency stopping forbids all I/O. */
export type SoldgraphExecutionMode = "enabled" | "reconcile_only" | "emergency_stop";

export function newSoldgraphCheckpoint(searchId: string, input: SoldgraphPageRequest): SoldgraphCheckpoint {
  const request = validateSoldgraphPageRequest(input);
  return { operationKey: soldgraphOperationKey(searchId, request), searchId, request, attempt: 1, requestId: null,
    creditState: "reserved", credits: null, state: "reserved", failureClass: null, result: null, version: 0 };
}

/** Number of credits held, not an invoice amount or count of HTTP requests. */
export function soldgraphBudgetHeld(checkpoints: readonly SoldgraphCheckpoint[]): number {
  const unique = new Map<string, SoldgraphCheckpoint>();
  for (const checkpoint of checkpoints) {
    // Collapse versions by operation first: pre-dispatch versions lack a request ID.
    const key = checkpoint.operationKey;
    const previous = unique.get(key);
    if (previous && previous.version === checkpoint.version && JSON.stringify(previous) !== JSON.stringify(checkpoint)) throw new Error("SOLDGRAPH_LEDGER_CONFLICT");
    if (!previous || previous.version < checkpoint.version) unique.set(key, checkpoint);
  }
  // This helper is account-scoped. A repository must supply only one account.
  const owners = new Map<string, string>();
  for (const checkpoint of unique.values()) {
    if (!checkpoint.requestId) continue;
    if (owners.has(checkpoint.requestId) && owners.get(checkpoint.requestId) !== checkpoint.operationKey) throw new Error("SOLDGRAPH_REQUEST_OWNERSHIP_CONFLICT");
    owners.set(checkpoint.requestId, checkpoint.operationKey);
  }
  return [...unique.values()].reduce((total, c) => total + (c.creditState === "released" ? 0 : c.creditState === "charged" ? c.credits ?? 1 : 1), 0);
}

/** One network attempt per step. The scheduler, not this function, manages backoff. */
export async function advanceSoldgraphPage(store: SoldgraphCheckpointStore, provider: SoldgraphPageProvider,
  operationKey: string, permitted: () => Promise<boolean | SoldgraphExecutionMode>, now: () => number = Date.now): Promise<SoldgraphCheckpoint> {
  let current = await store.load(operationKey);
  if (current.operationKey !== operationKey || soldgraphOperationKey(current.searchId, current.request, current.attempt) !== operationKey) {
    throw new Error("SOLDGRAPH_CHECKPOINT_CONFLICT");
  }
  if (["complete", "failed", "cancelled", "blocked"].includes(current.state)) return current;
  if (current.retryNotBefore) {
    const earliest = Date.parse(current.retryNotBefore);
    if (!Number.isFinite(earliest)) throw new Error("SOLDGRAPH_CHECKPOINT_CONFLICT");
    if (now() < earliest) return current;
  }
  const permission = await permitted();
  const mode = permission === true ? "enabled" : permission === false ? "emergency_stop" : permission;
  if (mode === "emergency_stop" || (mode === "reconcile_only" && !current.requestId)) throw new Error("SOLDGRAPH_DISABLED");
  const save = async (changes: Partial<SoldgraphCheckpoint>) => {
    const next = { ...current, ...changes, version: current.version + 1 };
    await store.save(next, current.version);
    current = next;
  };
  // Must persist the exact key before a potentially charged request. CAS failure stops I/O.
  if (!current.requestId) await save({ state: "dispatching" });
  let envelope;
  try {
    envelope = current.requestId ? await provider.poll(current.requestId) : await provider.submit(current.request, operationKey);
  } catch (error) {
    const classified = error instanceof Error && error.name === "SoldgraphProviderError" ? error as Error & {failureClass?: unknown; retryAfterSeconds?: unknown} : null;
    const failureClass: SoldgraphFailureClass = classified && soldgraphFailureClasses.includes(classified.failureClass as SoldgraphFailureClass)
      ? classified.failureClass as SoldgraphFailureClass : "RESULT_UNKNOWN";
    const blocked = ["EXTERNAL_DISABLED","CONFIGURATION","QUOTA","UPSTREAM_LIMIT","IDEMPOTENCY_CONFLICT","CONTRACT"].includes(failureClass);
    const retry = classified?.retryAfterSeconds;
    const delay = typeof retry === "number" && Number.isSafeInteger(retry) && retry >= 0 ? retry : null;
    const retryAt = delay !== null ? now() + delay * 1000 : null;
    const retryNotBefore = retryAt !== null && Number.isSafeInteger(retryAt) && retryAt < 8.64e15 ? new Date(retryAt).toISOString() : null;
    // A rejection of a poll does not prove that the original submitted request was free.
    // Keep unsettled reservations until provider terminal credits are reconciled.
    await save({ state: blocked ? "blocked" : "unknown", failureClass, retryNotBefore,
      ...(current.credits === null ? {creditState:"unknown" as const} : {}) });
    return current;
  }
  if (current.requestId && current.requestId !== envelope.requestId) throw new Error("SOLDGRAPH_REQUEST_ID_CONFLICT");
  // A charged or released completed response cannot regress to pending/failed.
  if (current.credits !== null && (envelope.status !== "complete" || envelope.credits !== current.credits)) {
    throw new Error("SOLDGRAPH_LEDGER_CONFLICT");
  }
  if (envelope.status === "pending") {
    await save({ requestId: envelope.requestId, state: "pending", creditState: "pending", failureClass: null, retryNotBefore: null });
    return current;
  }
  if (envelope.status === "failed") {
    await save({ requestId: envelope.requestId, state: "failed", creditState: "released", credits: 0, failureClass: null, retryNotBefore: null });
    return current;
  }
  // Credit accounting precedes parsing. Local parsing/storage failure is not a refund.
  await save({ requestId: envelope.requestId, credits: envelope.credits, creditState: envelope.credits === 1 ? "charged" : "released" });
  // Keep the page unpublished until normal execution resumes. Cost is already final.
  if (mode === "reconcile_only") return current;
  let parsed: ParsedSoldgraphPage;
  try { parsed = parseSoldgraphPage(envelope.result, current.request); }
  catch {
    await save({ state: "parse_failed", failureClass: "PARSE_FAILED" });
    return current;
  }
  await save({ state: "complete", result: parsed, failureClass: null, retryNotBefore: null });
  return current;
}

export function explicitlyRetryFailedSoldgraphPage(previous: SoldgraphCheckpoint): SoldgraphCheckpoint {
  if (previous.state !== "failed" || previous.credits !== 0 || previous.creditState !== "released" || !previous.requestId) {
    throw new Error("SOLDGRAPH_RETRY_NOT_CONFIRMED_FREE");
  }
  const attempt = previous.attempt + 1;
  return { ...newSoldgraphCheckpoint(previous.searchId, previous.request), attempt,
    operationKey: soldgraphOperationKey(previous.searchId, previous.request, attempt) };
}

export function cancelUnsentSoldgraphPage(previous: SoldgraphCheckpoint): SoldgraphCheckpoint {
  if (previous.state !== "reserved" || previous.requestId || previous.creditState !== "reserved") throw new Error("SOLDGRAPH_RESULT_RECONCILIATION_REQUIRED");
  return { ...previous, state: "cancelled", creditState: "released", credits: 0, version: previous.version + 1 };
}
