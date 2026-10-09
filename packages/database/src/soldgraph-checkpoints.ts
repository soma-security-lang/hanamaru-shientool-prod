import type { SoldgraphCheckpoint, RequestContext } from "@hanamaru/contracts";
import { HanamaruRepository } from "./repository.js";

/** Each save commits before external I/O. Only the currently leased Worker may mutate. */
export class SoldgraphCheckpointRepository {
  constructor(private readonly repository: HanamaruRepository, private readonly context: RequestContext,
    private readonly leaseOwner: string) {}

  async load(operationKey: string): Promise<SoldgraphCheckpoint> {
    return this.repository.withContext(this.context, async tx => {
      const result = await tx.query<{
        operation_key: string; search_id: string; request_json: SoldgraphCheckpoint["request"];
        attempt: number; request_id: string | null; credit_state: SoldgraphCheckpoint["creditState"];
        credits: 0 | 1 | null; state: SoldgraphCheckpoint["state"]; failure_class: SoldgraphCheckpoint["failureClass"];
        normalized_result_json: SoldgraphCheckpoint["result"]; checkpoint_version: string; retry_not_before: Date | null;
      }>(`SELECT operation_key,search_id,request_json,attempt,request_id,credit_state,credits,state,
          failure_class,normalized_result_json,checkpoint_version,retry_not_before
          FROM ebay_market_price_pages WHERE organization_id=$1 AND operation_key=$2
          AND lease_owner=$3 AND lease_until>now()`, [this.context.organizationId, operationKey, this.leaseOwner]);
      const row = result.rows[0];
      if (!row) throw new Error("SOLDGRAPH_CHECKPOINT_LEASE_REQUIRED");
      const version = Number(row.checkpoint_version);
      if (!Number.isSafeInteger(version)) throw new Error("SOLDGRAPH_CHECKPOINT_VERSION_INVALID");
      return { operationKey: row.operation_key, searchId: row.search_id, request: row.request_json,
        attempt: row.attempt, requestId: row.request_id, creditState: row.credit_state, credits: row.credits,
        state: row.state, failureClass: row.failure_class, result: row.normalized_result_json, version, retryNotBefore:row.retry_not_before?.toISOString()??null };
    });
  }

  async save(next: SoldgraphCheckpoint, expectedVersion: number): Promise<void> {
    if (next.version !== expectedVersion + 1 || !Number.isSafeInteger(next.version)) throw new Error("SOLDGRAPH_CHECKPOINT_VERSION_INVALID");
    await this.repository.withContext(this.context, async tx => {
      const result = await tx.query(`UPDATE ebay_market_price_pages SET request_id=$4,credit_state=$5,
        credits=$6,state=$7,failure_class=$8,normalized_result_json=$9,checkpoint_version=$10,retry_not_before=$15::timestamptz,updated_at=now()
        WHERE organization_id=$1 AND operation_key=$2 AND lease_owner=$3 AND lease_until>now()
          AND checkpoint_version=$11 AND search_id=$12 AND attempt=$13 AND request_json=$14::jsonb`,
      [this.context.organizationId, next.operationKey, this.leaseOwner, next.requestId, next.creditState,
        next.credits, next.state, next.failureClass, next.result, next.version, expectedVersion,
        next.searchId, next.attempt, next.request, next.retryNotBefore??null]);
      if (result.rowCount !== 1) throw new Error("SOLDGRAPH_CHECKPOINT_VERSION_CONFLICT");
    });
  }
}
