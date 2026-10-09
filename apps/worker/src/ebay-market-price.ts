import { createHash, randomUUID } from "node:crypto";
import type { EbayObservation, RequestContext, SoldgraphCheckpoint } from "@hanamaru/contracts";
import { SoldgraphCheckpointRepository, type HanamaruRepository } from "@hanamaru/database";
import type { PlatformProviders } from "@hanamaru/platform";
import { advanceSoldgraphPage, cancelUnsentSoldgraphPage, ebayObservationsConflict, mergeEbayLocation, SOLDGRAPH_CONTRACT_VERSION, EBAY_CACHE_PROCESSING_VERSION, type SoldgraphExecutionMode } from "@hanamaru/market-price";

/** One bounded step per market. All network I/O occurs outside tenant transactions. */
export async function processEbayMarketPriceSearch(repository: HanamaruRepository, providers: PlatformProviders,
  ctx: RequestContext, searchId: string): Promise<{ pending: boolean; retryAt?: string }> {
  if (!providers.soldgraph) throw new Error("PROVIDER_PERMANENT: Soldgraph provider is not configured");
  const leaseOwner = randomUUID();
  const pages = await repository.withContext(ctx, async tx => {
    const search = await tx.query<{ status: string }>("SELECT status FROM ebay_market_price_searches WHERE organization_id=$1 AND id=$2 AND content_purged_at IS NULL", [ctx.organizationId, searchId]);
    if (!search.rows[0]) throw new Error("PROVIDER_PERMANENT: eBay search not found");
    const selected = await tx.query<{ operation_key: string; request_id: string | null; account_id: string }>(`SELECT operation_key,request_id,account_id FROM ebay_market_price_pages
      WHERE organization_id=$1 AND search_id=$2 AND state NOT IN ('failed','cancelled','blocked')
        AND (retry_not_before IS NULL OR retry_not_before<=now())
        AND (state<>'complete' OR parser_version IS NULL) AND (lease_until IS NULL OR lease_until<now())
      ORDER BY market,page_number,attempt LIMIT 8 FOR UPDATE SKIP LOCKED`, [ctx.organizationId, searchId]);
    for (const page of selected.rows) await tx.query("UPDATE ebay_market_price_pages SET lease_owner=$3,lease_until=now()+interval '5 minutes' WHERE organization_id=$1 AND operation_key=$2", [ctx.organizationId, page.operation_key, leaseOwner]);
    return selected.rows;
  });
  const store = new SoldgraphCheckpointRepository(repository, ctx, leaseOwner);
  for (const page of pages) {
    let checkpoint: SoldgraphCheckpoint | null = null;
    try {
      const isCancelled = async () => repository.withContext(ctx, async tx => {
        const result = await tx.query("SELECT 1 FROM ebay_market_price_searches WHERE organization_id=$1 AND id=$2 AND cancel_requested_at IS NOT NULL", [ctx.organizationId, searchId]);
        return result.rowCount === 1;
      });
      if (await isCancelled()) {
        const retained = await store.load(page.operation_key);
        if (retained.state === "reserved" && !retained.requestId) {
          await store.save(cancelUnsentSoldgraphPage(retained), retained.version);
          continue;
        }
        // Already reconciled cancelled searches do not repeatedly poll or publish.
        if (retained.credits !== null) continue;
      }
      checkpoint = await advanceSoldgraphPage(store, providers.soldgraph, page.operation_key, async () => {
        const result = await repository.system<{ mode: SoldgraphExecutionMode }>("SELECT admit_soldgraph_call($1,$2,$3) mode", [page.operation_key, leaseOwner, page.request_id ? "poll" : "submit"]);
        const mode = result.rows[0]!.mode;
        return mode === "emergency_stop" ? mode : await isCancelled() ? "reconcile_only" : mode;
      });
      if (checkpoint.state === "blocked" && ["CONFIGURATION","QUOTA","UPSTREAM_LIMIT"].includes(checkpoint.failureClass??"")) {
        // A shared-account outage must stop other users' new submits too.
        // Operator reconciliation, not another request, restores enabled mode.
        await repository.system("UPDATE soldgraph_accounts SET execution_mode='reconcile_only',lock_version=lock_version+1,updated_at=now() WHERE id=$1 AND execution_mode='enabled'",[page.account_id]);
      }
      await repository.withContext(ctx, async tx => {
        const search = await tx.query("SELECT cancel_requested_at FROM ebay_market_price_searches WHERE organization_id=$1 AND id=$2 FOR UPDATE", [ctx.organizationId, searchId]);
        const retained = await tx.query("SELECT id,run_id FROM ebay_market_price_pages WHERE organization_id=$1 AND operation_key=$2 AND lease_owner=$3 AND lease_until>now() FOR UPDATE", [ctx.organizationId, page.operation_key, leaseOwner]);
        const persisted = retained.rows[0]; if (!persisted) throw new Error("SOLDGRAPH_CHECKPOINT_LEASE_REQUIRED");
        if (search.rows[0]?.cancel_requested_at) return;
        if (checkpoint!.state === "complete" && checkpoint!.result) {
          const permitted=await tx.query<{allowed:boolean}>("SELECT soldgraph_publication_allowed($1,$2) allowed",[page.operation_key,leaseOwner]);
          if(!permitted.rows[0]?.allowed){
            // Keep the terminal charge and normalized result, but publish neither.
            await tx.query("UPDATE ebay_market_price_pages SET state='blocked',failure_class='EXTERNAL_DISABLED',checkpoint_version=checkpoint_version+1 WHERE organization_id=$1 AND id=$2",[ctx.organizationId,persisted.id]);
            await tx.query("UPDATE ebay_market_price_runs SET status='blocked',failure_class='EXTERNAL_DISABLED',lock_version=lock_version+1 WHERE organization_id=$1 AND id=$2",[ctx.organizationId,persisted.run_id]);
            return;
          }
          for (const observation of checkpoint!.result.observations) {
            const existing = await tx.query<{ id: string; observation_json: EbayObservation }>("SELECT id,observation_json FROM ebay_market_price_observations WHERE organization_id=$1 AND search_id=$2 AND market=$3 AND observation_key=$4 FOR UPDATE", [ctx.organizationId, searchId, observation.market, observation.observationKey]);
            if (!existing.rows[0]) {
              await tx.query(`INSERT INTO ebay_market_price_observations(organization_id,search_id,page_id,market,observation_key,source_item_id,observation_json)
                VALUES($1,$2,$3,$4,$5,$6,$7)`, [ctx.organizationId, searchId, persisted.id, observation.market, observation.observationKey, observation.sourceItemId, observation]);
            } else {
              const previous = existing.rows[0].observation_json;
              const location=mergeEbayLocation(previous.location,observation.location);
              if (ebayObservationsConflict(previous, observation)||JSON.stringify(location)!==JSON.stringify(previous.location)) {
                const conflicted = { ...previous, location, hardExclusions: ebayObservationsConflict(previous,observation)?[...new Set([...previous.hardExclusions,"observation_conflict"])]:previous.hardExclusions };
                await tx.query("UPDATE ebay_market_price_observations SET observation_json=$3,lock_version=lock_version+1 WHERE organization_id=$1 AND id=$2", [ctx.organizationId, existing.rows[0].id, conflicted]);
              }
            }
          }
          await tx.query("UPDATE ebay_market_price_pages SET parser_version=$3,response_hash=$4,processing_version=$5 WHERE organization_id=$1 AND id=$2", [ctx.organizationId, persisted.id, SOLDGRAPH_CONTRACT_VERSION, createHash("sha256").update(JSON.stringify(checkpoint!.result)).digest("hex"),EBAY_CACHE_PROCESSING_VERSION]);
          await tx.query("UPDATE ebay_market_price_runs SET status='complete',next_page=$3,failure_class=NULL,lock_version=lock_version+1,updated_at=now() WHERE organization_id=$1 AND id=$2", [ctx.organizationId, persisted.run_id, checkpoint!.result.nextPage]);
          await tx.audit("market_price.ebay.page_completed", "ebay_market_price_search", searchId, "allowed", { market: checkpoint!.request.market, page: checkpoint!.request.page, count: checkpoint!.result.observations.length, credits: checkpoint!.credits });
        } else if (checkpoint!.state === "blocked") {
          await tx.query("UPDATE ebay_market_price_runs SET status='blocked',failure_class=$3,lock_version=lock_version+1 WHERE organization_id=$1 AND id=$2", [ctx.organizationId,persisted.run_id,checkpoint!.failureClass]);
        } else if (checkpoint!.state === "failed") {
          await tx.query("UPDATE ebay_market_price_runs SET status='failed',failure_class='PROVIDER_FAILED',lock_version=lock_version+1 WHERE organization_id=$1 AND id=$2", [ctx.organizationId, persisted.run_id]);
        } else {
          await tx.query("UPDATE ebay_market_price_runs SET status='pending',failure_class=$3 WHERE organization_id=$1 AND id=$2", [ctx.organizationId, persisted.run_id, checkpoint!.failureClass]);
        }
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (!/SOLDGRAPH_(?:DISABLED|RATE_LIMIT|PENDING_LIMIT)/.test(message)) throw error;
      await repository.withContext(ctx, async tx => {
        await tx.query("UPDATE ebay_market_price_runs SET status=$4,failure_class=$3 WHERE organization_id=$1 AND id=(SELECT run_id FROM ebay_market_price_pages WHERE organization_id=$1 AND operation_key=$2)", [ctx.organizationId, page.operation_key, message.includes("DISABLED") ? "DISABLED" : message.includes("RATE_LIMIT") ? "RATE_LIMIT" : "PENDING_LIMIT", message.includes("DISABLED") ? "blocked" : "pending"]);
      });
    } finally {
      await repository.withContext(ctx, async tx => { await tx.query("UPDATE ebay_market_price_pages SET lease_owner=NULL,lease_until=NULL WHERE organization_id=$1 AND operation_key=$2 AND lease_owner=$3", [ctx.organizationId, page.operation_key, leaseOwner]); });
    }
  }
  return repository.withContext(ctx, async tx => {
    const cancelled = await tx.query("SELECT 1 FROM ebay_market_price_searches WHERE organization_id=$1 AND id=$2 AND cancel_requested_at IS NOT NULL", [ctx.organizationId, searchId]);
    if (cancelled.rowCount) {
      const unsettled = await tx.query("SELECT 1 FROM ebay_market_price_pages WHERE organization_id=$1 AND search_id=$2 AND credits IS NULL LIMIT 1", [ctx.organizationId, searchId]);
      return { pending: unsettled.rowCount === 1 };
    }
    const runs = await tx.query<{ status: string }>("SELECT status FROM ebay_market_price_runs WHERE organization_id=$1 AND search_id=$2", [ctx.organizationId, searchId]);
    const complete = runs.rows.filter(run => run.status === "complete").length;
    const pending = runs.rows.some(run => ["queued","pending","normalizing"].includes(run.status));
    const status = complete === runs.rows.length ? "ready" : complete > 0 ? "partial" : pending ? "fetching" : "blocked";
    await tx.query("UPDATE ebay_market_price_searches SET status=$3,lock_version=lock_version+1,updated_at=now() WHERE organization_id=$1 AND id=$2 AND status NOT IN ('cancelled','confirmed')", [ctx.organizationId, searchId, status]);
    const deferred = await tx.query<{retry_at:Date|null}>("SELECT min(retry_not_before) retry_at FROM ebay_market_price_pages WHERE organization_id=$1 AND search_id=$2 AND state NOT IN ('complete','failed','cancelled','blocked')",[ctx.organizationId,searchId]);
    const retryAt=deferred.rows[0]?.retry_at;
    return { pending, ...(retryAt?{retryAt:retryAt.toISOString()}:{}) };
  });
}
