import { createHash, randomUUID } from "node:crypto";
import type { EbayCondition, EbayMarket, EbayObservation, EbaySearchPlan, ParsedSoldgraphPage, RequestContext, SoldgraphPageRequest } from "@hanamaru/contracts";
import type { RepositoryTransaction } from "@hanamaru/database";
import { createEbaySearchPlan, ebayCrossMarketCounts, evaluateEbayMarket, ebayObservationsConflict, mergeEbayLocation, soldgraphOperationKey, SOLDGRAPH_CONTRACT_VERSION, EBAY_CACHE_PROCESSING_VERSION } from "@hanamaru/market-price";
import type { BackendService } from "./service.js";
import { camel } from "./service.js";
import { ApiProblem, denied, invalid, notFound } from "./errors.js";

type Input = Record<string, unknown>;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
interface SearchRow { id: string; branch_id: string; created_by_membership_id: string; account_id: string;
  identification_id: string; acquisition_mode:"reuse"|"latest"; plan_json: EbaySearchPlan; product_basis_json: {keyword?: string; modelNumber?: string | null}; status: string; lock_version: string; outlier_percent: string; exclusion_keywords_json: string[] }

/** eBay data never passes through the existing JPY/ninety-day result serializer. */
export class EbayMarketPriceService {
  constructor(private readonly service: BackendService) {}
  private write(...args:Parameters<BackendService["write"]>){
    const [ctx,endpoint,key,body,action,resourceType,operation]=args;
    return this.service.write(ctx,endpoint,key,body,action,resourceType,operation,async(tx,id)=>{
      if(!id)throw notFound();
      await this.search(tx,ctx,id,true);
      // Repeats also require current access to the source search, not only the new result.
      if(endpoint==="ebay.search.repeat"&&typeof body==="object"&&body!==null&&"id" in body&&typeof body.id==="string")
        await this.search(tx,ctx,body.id,true);
    });
  }
  private scope(ctx: RequestContext, capability: "market_price:read" | "market_price:search") {
    if (ctx.roles.includes("system_admin") || !ctx.capabilities.includes(capability)) throw denied();
    const scopes = ctx.authorizationScopes.filter(scope => scope.capabilities.includes(capability));
    const organization = scopes.some(scope => scope.scopeType === "organization" && scope.scopeId === ctx.organizationId);
    const branches = scopes.filter(scope => scope.scopeType === "branch").map(scope => scope.scopeId);
    const self = scopes.some(scope => scope.scopeType === "self" && scope.scopeId === ctx.membershipId);
    if (!organization && !branches.length && !self) throw denied();
    return { organization, branches, self };
  }
  private async enabled(tx: RepositoryTransaction, ctx: RequestContext) {
    const flags = await tx.query<{ flag_key: string }>(`SELECT flag_key FROM feature_flags WHERE organization_id=$1
      AND flag_key IN ('market_price_search','market_price_ebay') AND enabled AND (expires_at IS NULL OR expires_at>now())`, [ctx.organizationId]);
    if (flags.rows.length !== 2) throw new ApiProblem("FEATURE_DISABLED", 404, "eBay相場は現在利用できません");
  }
  private async approvedRetention(tx:RepositoryTransaction){
    const retention=await tx.query<{configured:boolean}>("SELECT ebay_retention_configured() configured");
    if(!retention.rows[0]?.configured)throw new ApiProblem("JOB_STATE_CONFLICT",409,"保存期間の承認済み設定がありません。新しい検索は開始していません");
  }
  private async search(tx: RepositoryTransaction, ctx: RequestContext, id: string, mutate = false) {
    if (!uuid.test(id)) throw notFound();
    const access = this.scope(ctx, mutate ? "market_price:search" : "market_price:read");
    await this.enabled(tx, ctx);
    const result = await tx.query<SearchRow>(`SELECT id,branch_id,created_by_membership_id,account_id,identification_id,acquisition_mode,plan_json,product_basis_json,status,
      lock_version,outlier_percent,exclusion_keywords_json FROM ebay_market_price_searches
      WHERE organization_id=$1 AND id=$2 AND content_purged_at IS NULL AND ($3::boolean OR branch_id=ANY($4::uuid[])
        OR ($5::boolean AND created_by_membership_id=$6)) ${mutate ? "FOR UPDATE" : ""}`,
    [ctx.organizationId, id, access.organization, access.branches, access.self, ctx.membershipId]);
    if (!result.rows[0]) throw notFound();
    return result.rows[0];
  }
  private version(row: SearchRow, input: Input) {
    if (!Number.isSafeInteger(input.expectedLockVersion) || Number(row.lock_version) !== input.expectedLockVersion)
      throw new ApiProblem("VERSION_CONFLICT", 409, "検索結果を再読み込みしてください");
  }
  private async reserve(tx: RepositoryTransaction, id: string) {
    try { await tx.query("SELECT assert_soldgraph_reservation($1)", [id]); }
    catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (/SOLDGRAPH_(?:BUDGET_EXCEEDED|USAGE_UNKNOWN|DISABLED|RETENTION_UNCONFIGURED)/.test(message))
        throw new ApiProblem("JOB_STATE_CONFLICT", 409, "検索枠または取得設定を確認できません。新しい取得は開始していません");
      throw error;
    }
  }
  private async page(tx: RepositoryTransaction, ctx: RequestContext, searchId: string, runId: string,
    accountId: string, request: SoldgraphPageRequest, attempt = 1) {
    const operationKey = soldgraphOperationKey(searchId, request, attempt);
    await tx.query(`INSERT INTO ebay_market_price_pages(organization_id,search_id,run_id,account_id,market,page_number,operation_key,request_json,attempt)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [ctx.organizationId, searchId, runId, accountId, request.market, request.page, operationKey, request, attempt]);
  }
  private async reusePage(tx:RepositoryTransaction,ctx:RequestContext,row:SearchRow,runId:string,request:SoldgraphPageRequest){
    if(row.acquisition_mode!=="reuse")return false;
    const access=this.scope(ctx,"market_price:read");
    const cache=await tx.query<{id:string;normalized_result_json:ParsedSoldgraphPage;response_hash:string}>(`SELECT p.id,p.normalized_result_json,p.response_hash FROM ebay_market_price_pages p
      JOIN ebay_market_price_searches s ON s.organization_id=p.organization_id AND s.id=p.search_id
      JOIN ebay_market_price_runs r ON r.organization_id=p.organization_id AND r.id=p.run_id
      WHERE p.organization_id=$1 AND p.request_json=$2::jsonb AND p.state='complete' AND p.parser_version=$3 AND p.processing_version=$11
        AND p.cache_from_page_id IS NULL AND p.normalized_result_json IS NOT NULL AND r.status='complete'
        AND p.account_id=$12 AND p.search_id<>$13 AND s.status IN ('ready','partial','confirmed') AND s.cancel_requested_at IS NULL
        AND s.product_basis_json=$4::jsonb AND s.exclusion_keywords_json=$5::jsonb AND s.outlier_percent=$6
        AND (p.normalized_result_json->>'collectedAt')::timestamptz>=now()-interval '24 hours'
        AND (p.normalized_result_json->>'collectedAt')::timestamptz<=now()
        AND ($7::boolean OR s.branch_id=ANY($8::uuid[]) OR ($9::boolean AND s.created_by_membership_id=$10))
      ORDER BY (p.normalized_result_json->>'collectedAt')::timestamptz DESC,p.id LIMIT 1 FOR SHARE OF p,s,r`,
    [ctx.organizationId,JSON.stringify(request),SOLDGRAPH_CONTRACT_VERSION,JSON.stringify(row.product_basis_json),JSON.stringify(row.exclusion_keywords_json),row.outlier_percent,access.organization,access.branches,access.self,ctx.membershipId,EBAY_CACHE_PROCESSING_VERSION,row.account_id,row.id]);
    const source=cache.rows[0];if(!source)return false;
    const cached=await tx.query<{id:string}>(`UPDATE ebay_market_price_pages SET state='complete',credit_state='released',credits=0,cache_from_page_id=$5,
      normalized_result_json=$6,parser_version=$7,response_hash=$8,processing_version=$9 WHERE organization_id=$1 AND search_id=$2 AND market=$3 AND page_number=$4 AND attempt=1 RETURNING id`,
    [ctx.organizationId,row.id,request.market,request.page,source.id,source.normalized_result_json,SOLDGRAPH_CONTRACT_VERSION,source.response_hash,EBAY_CACHE_PROCESSING_VERSION]);
    for(const {observation} of evaluateEbayMarket(request.market,source.normalized_result_json.observations).decisions){
      const existing=await tx.query<{id:string;observation_json:EbayObservation}>("SELECT id,observation_json FROM ebay_market_price_observations WHERE organization_id=$1 AND search_id=$2 AND market=$3 AND observation_key=$4 FOR UPDATE",[ctx.organizationId,row.id,request.market,observation.observationKey]);
      if(!existing.rows[0])await tx.query(`INSERT INTO ebay_market_price_observations(organization_id,search_id,page_id,market,observation_key,source_item_id,observation_json)
        VALUES($1,$2,$3,$4,$5,$6,$7)`,[ctx.organizationId,row.id,cached.rows[0]!.id,request.market,observation.observationKey,observation.sourceItemId,observation]);
      else{
        const previous=existing.rows[0].observation_json,conflict=ebayObservationsConflict(previous,observation),location=mergeEbayLocation(previous.location,observation.location);
        if(conflict||JSON.stringify(location)!==JSON.stringify(previous.location))await tx.query("UPDATE ebay_market_price_observations SET observation_json=$3,lock_version=lock_version+1 WHERE organization_id=$1 AND id=$2",[ctx.organizationId,existing.rows[0].id,{...previous,location,hardExclusions:conflict?[...new Set([...previous.hardExclusions,"observation_conflict"])]:previous.hardExclusions}]);
      }
    }
    await tx.query("UPDATE ebay_market_price_runs SET status='complete',next_page=$3,lock_version=lock_version+1,updated_at=now() WHERE organization_id=$1 AND id=$2",[ctx.organizationId,runId,source.normalized_result_json.nextPage]);
    return true;
  }
  private async dispatch(tx: RepositoryTransaction, ctx: RequestContext, searchId: string, key: string, hash: string) {
    const jobId = randomUUID();
    await tx.query(`INSERT INTO jobs(id,organization_id,job_type,entity_type,entity_id,idempotency_key,input_hash,input_redacted,max_attempts,requested_by_membership_id)
      VALUES($1,$2,'market_price_ebay_search','ebay_market_price_search',$3,$4,$5,$6,20,$7)`,
    [jobId, ctx.organizationId, searchId, key, hash, { searchId }, ctx.membershipId]);
    await tx.query(`INSERT INTO outbox_events(organization_id,event_type,aggregate_type,aggregate_id,payload_redacted,deduplication_key)
      VALUES($1,'job.dispatch','job',$2,$3,$4)`, [ctx.organizationId, jobId, { job_id: jobId, job_type: "market_price_ebay_search" }, `job:${jobId}`]);
    return jobId;
  }
  async create(ctx: RequestContext, key: string | undefined, input: Input) {
    const access = this.scope(ctx, "market_price:search");
    const allowed = ["identificationId", "selectedSearchQueryId", "searchBasis", "markets", "conditions", "buyingFormat", "outlierPercent", "consumptionConfirmed","acquisitionMode"];
    if (Object.keys(input).some(name => !allowed.includes(name)) || ![undefined,"keyword","model_number"].includes(input.searchBasis as string | undefined))
      throw invalid("検索条件に未対応の項目があります");
    if (input.consumptionConfirmed !== true) throw invalid("対象市場と最大消費枠を確認してください");
    if(![undefined,"reuse","latest"].includes(input.acquisitionMode as string|undefined))throw invalid("取得方法を確認してください");
    if (typeof input.identificationId !== "string" || !uuid.test(input.identificationId)) throw invalid("確認済み商品を選択してください");
    const accountId = process.env.SOLDGRAPH_ACCOUNT_ID;
    if (!accountId || !uuid.test(accountId)) throw new ApiProblem("FEATURE_DISABLED", 404, "eBay取得設定はまだ利用できません");
    return this.write(ctx, "ebay.search.create", key, input, "market_price.ebay.search_requested", "ebay_market_price_search", async tx => {
      await this.enabled(tx, ctx);
      await this.approvedRetention(tx);
      if (!access.organization && !access.branches.includes(ctx.branchId) && !access.self) throw denied();
      const identified = await tx.query<{ confirmed_fields_json: Input }>(`SELECT confirmed_fields_json FROM market_price_identifications
        WHERE organization_id=$1 AND id=$2 AND status='confirmed' AND expires_at>now()
        AND ($3::boolean OR branch_id=ANY($4::uuid[]) OR ($5::boolean AND created_by_membership_id=$6))`,
      [ctx.organizationId, input.identificationId, access.organization, access.branches, access.self, ctx.membershipId]);
      const confirmed = identified.rows[0]?.confirmed_fields_json;
      if (!confirmed) throw notFound("確認済みの商品情報を再確認してください");
      const queries = Array.isArray(confirmed.searchQueries) ? confirmed.searchQueries as Input[] : [];
      const selected = queries.find(query => query.id === input.selectedSearchQueryId && query.decision === "accepted");
      const keyword = input.searchBasis === "model_number" ? confirmed.modelNumber : selected?.keyword;
      if (typeof keyword !== "string" || !keyword.trim()) throw invalid("採用した検索語または型番を確認してください");
      let plan: EbaySearchPlan;
      try { plan = createEbaySearchPlan({ keyword, markets: input.markets as EbayMarket[], conditions: input.conditions as EbayCondition[],
        buyingFormat: (input.buyingFormat ?? null) as SoldgraphPageRequest["buyingFormat"] }); }
      catch { throw invalid("市場・状態・販売形式を確認してください"); }
      const outlierPercent = input.outlierPercent ?? 20;
      if (!Number.isInteger(outlierPercent) || Number(outlierPercent) < 1 || Number(outlierPercent) > 100) throw invalid("外れ値基準は1〜100%で指定してください");
      const exclusions = Array.isArray(confirmed.excludeKeywords) ? confirmed.excludeKeywords.filter((value): value is string => typeof value === "string") : [];
      const id = randomUUID();
      await tx.query(`INSERT INTO ebay_market_price_searches(id,organization_id,branch_id,created_by_membership_id,identification_id,
        account_id,plan_json,plan_hash,exclusion_keywords_json,outlier_percent,product_basis_json,acquisition_mode) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11::jsonb,$12)`,
      [id, ctx.organizationId, ctx.branchId, ctx.membershipId, input.identificationId, accountId, plan, plan.specHash, JSON.stringify(exclusions), outlierPercent,
        JSON.stringify({keyword:plan.keyword,modelNumber:typeof confirmed.modelNumber==="string"?confirmed.modelNumber:null}),input.acquisitionMode??"reuse"]);
      let cachedPages=0;
      const cacheTarget=await this.search(tx,ctx,id,true);
      for (const market of plan.markets) {
        const run = await tx.query<{ id: string }>("INSERT INTO ebay_market_price_runs(organization_id,search_id,market) VALUES($1,$2,$3) RETURNING id", [ctx.organizationId, id, market]);
        const request={keyword:plan.keyword,market,page:1,conditions:plan.conditions,buyingFormat:plan.buyingFormat};
        await this.page(tx, ctx, id, run.rows[0]!.id, accountId, request);
        if(await this.reusePage(tx,ctx,cacheTarget,run.rows[0]!.id,request))cachedPages++;
      }
      const reservedCredits=plan.markets.length-cachedPages;
      if(reservedCredits)await this.reserve(tx,id);
      const jobId=reservedCredits?await this.dispatch(tx,ctx,id,key!,plan.specHash):null;
      const status=reservedCredits?"queued":"ready";
      if(!reservedCredits)await tx.query("UPDATE ebay_market_price_searches SET status='ready' WHERE organization_id=$1 AND id=$2",[ctx.organizationId,id]);
      return { status: 202, body: { searchId: id, jobId, sourceProvider: "soldgraph_ebay", status, reservedCredits,cachedPages,
        statusUrl: `/api/v1/market-price/ebay/searches/${id}` }, resourceId: id };
    });
  }
  private async detail(tx: RepositoryTransaction, ctx: RequestContext, row: SearchRow) {
    const runs = await tx.query("SELECT market,status,next_page,failure_class FROM ebay_market_price_runs WHERE organization_id=$1 AND search_id=$2 ORDER BY market", [ctx.organizationId, row.id]);
    const pages = await tx.query(`SELECT p.market,p.page_number,p.attempt,p.state,p.credit_state,p.credits,p.failure_class,p.retry_not_before,p.updated_at,
      (p.cache_from_page_id IS NOT NULL) cache_hit,p.normalized_result_json->>'collectedAt' collected_at,
      (p.request_id IS NOT NULL AND p.state IN ('blocked','parse_failed','unknown') AND p.lease_until IS NULL
        AND (p.retry_not_before IS NULL OR p.retry_not_before<=now()) AND $3::text<>'cancelled'
        AND NOT EXISTS(SELECT 1 FROM ebay_market_price_pages newer WHERE newer.organization_id=p.organization_id
          AND newer.search_id=p.search_id AND newer.market=p.market AND newer.page_number=p.page_number AND newer.attempt>p.attempt)) can_resume
      FROM ebay_market_price_pages p WHERE p.organization_id=$1 AND p.search_id=$2 ORDER BY p.market,p.page_number,p.attempt`, [ctx.organizationId, row.id,row.status]);
    const observations = await tx.query<{ id: string; observation_json: EbayObservation; manual_decision: string; lock_version: string; decision_reason: string | null }>(
      "SELECT id,observation_json,manual_decision,lock_version,decision_reason FROM ebay_market_price_observations WHERE organization_id=$1 AND search_id=$2 ORDER BY market,id", [ctx.organizationId, row.id]);
    const excluded = await tx.query<{ source_item_id: string }>("SELECT source_item_id FROM ebay_market_price_item_decisions WHERE organization_id=$1 AND search_id=$2 AND excluded", [ctx.organizationId, row.id]);
    const values = observations.rows.map(item => item.observation_json);
    const overrides = Object.fromEntries(observations.rows.filter(item => item.manual_decision !== "default").map(item => [item.observation_json.observationKey, item.manual_decision as "include" | "exclude"]));
    const statistics = row.plan_json.markets.map(market => evaluateEbayMarket(market, values, { outlierPercent: Number(row.outlier_percent),
      productBasis: {keyword:row.product_basis_json.keyword??row.plan_json.keyword,modelNumber:row.product_basis_json.modelNumber??null}, selectedConditions:row.plan_json.conditions,
      excludeKeywords: row.exclusion_keywords_json, excludedItemIds: excluded.rows.map(item => item.source_item_id), observationOverrides: overrides }));
    const snapshots = await tx.query("SELECT id,snapshot_version,snapshot_hash,snapshot_json,confirmed_at FROM ebay_market_price_results WHERE organization_id=$1 AND search_id=$2 ORDER BY snapshot_version DESC", [ctx.organizationId, row.id]);
    const response = { id: row.id, identificationId: row.identification_id, sourceProvider: "soldgraph_ebay", periodMode: "source_sample", status: row.status, lockVersion: Number(row.lock_version),
      plan: row.plan_json, exclusionKeywords:row.exclusion_keywords_json, acquisitionMode:row.acquisition_mode,outlierPercent: Number(row.outlier_percent), runs: runs.rows, pages: pages.rows, observations: observations.rows,
      statistics, counts: ebayCrossMarketCounts(values), snapshots: snapshots.rows };
    return camel<typeof response>(response);
  }
  async get(ctx: RequestContext, id: string) {
    return this.service.read(ctx, "market_price.ebay.read", "ebay_market_price_search", async tx => this.detail(tx, ctx, await this.search(tx, ctx, id)));
  }
  async list(ctx: RequestContext) {
    const access = this.scope(ctx, "market_price:read");
    return this.service.read(ctx, "market_price.ebay.list", "ebay_market_price_search", async tx => {
      await this.enabled(tx, ctx);
      const result = await tx.query(`SELECT id,status,plan_json,created_at,lock_version FROM ebay_market_price_searches
        WHERE organization_id=$1 AND content_purged_at IS NULL AND ($2::boolean OR branch_id=ANY($3::uuid[]) OR ($4::boolean AND created_by_membership_id=$5))
        ORDER BY created_at DESC,id DESC LIMIT 100`, [ctx.organizationId, access.organization, access.branches, access.self, ctx.membershipId]);
      return { items: camel(result.rows), sourceProvider: "soldgraph_ebay" };
    });
  }
  async operationResult(ctx:RequestContext,key:string,action:unknown){
    const endpoints:Record<string,string>={create:"ebay.search.create",confirm:"ebay.result.confirm",cancel:"ebay.search.cancel",
      retry:"ebay.page.retry",resume:"ebay.page.resume",repeat:"ebay.search.repeat","next-page":"ebay.page.create",
      "outlier-policy":"ebay.outlier.change",candidate:"ebay.candidate.change"};
    if(!uuid.test(key)||typeof action!=="string"||!Object.hasOwn(endpoints,action))throw invalid("確認する操作を指定してください");
    this.scope(ctx,"market_price:search");
    return this.service.read(ctx,"market_price.ebay.operation_result","ebay_market_price_search",async tx=>{
      await this.enabled(tx,ctx);
      const result=await tx.query<{resource_id:string|null}>(`SELECT resource_id FROM idempotency_records
        WHERE organization_id=$1 AND membership_id=$2 AND endpoint_key=$3 AND idempotency_key=$4
        AND expires_at>now() AND response_status BETWEEN 200 AND 299`,[ctx.organizationId,ctx.membershipId,endpoints[action],key]);
      const id=result.rows[0]?.resource_id;
      if(!id)return {status:"unknown",action,searchId:null};
      // Recheck current product scope rather than relying on authority at save time.
      await this.search(tx,ctx,id,true);
      return {status:"succeeded",action,searchId:id};
    });
  }
  async nextPage(ctx: RequestContext, id: string, key: string | undefined, input: Input) {
    return this.write(ctx, "ebay.page.create", key, { id, ...input }, "market_price.ebay.page_requested", "ebay_market_price_search", async tx => {
      const row = await this.search(tx, ctx, id, true); this.version(row, input);
      await this.approvedRetention(tx);
      if (input.consumptionConfirmed !== true || typeof input.market !== "string" || !row.plan_json.markets.includes(input.market as EbayMarket)) throw invalid("対象市場と追加1枠の消費を確認してください");
      if (["cancelled", "blocked"].includes(row.status)) throw new ApiProblem("JOB_STATE_CONFLICT", 409, "この検索は追加取得できません");
      const run = await tx.query<{ id: string; next_page: number | null; status: string }>("SELECT id,next_page,status FROM ebay_market_price_runs WHERE organization_id=$1 AND search_id=$2 AND market=$3 FOR UPDATE", [ctx.organizationId, id, input.market]);
      const selected = run.rows[0];
      if (!selected || selected.status !== "complete" || selected.next_page === null || selected.next_page > 10) throw new ApiProblem("JOB_STATE_CONFLICT", 409, "この市場の次ページは取得できません");
      const count = await tx.query<{ count: number }>("SELECT count(DISTINCT (market,page_number))::int count FROM ebay_market_price_pages WHERE organization_id=$1 AND search_id=$2", [ctx.organizationId, id]);
      if (count.rows[0]!.count >= 20) throw new ApiProblem("JOB_STATE_CONFLICT", 409, "検索全体の20ページ上限に達しています");
      const request={ keyword: row.plan_json.keyword, market: input.market as EbayMarket,
        page: selected.next_page, conditions: row.plan_json.conditions, buyingFormat: row.plan_json.buyingFormat };
      await this.page(tx, ctx, id, selected.id, row.account_id,request);
      if(await this.reusePage(tx,ctx,row,selected.id,request)){
        const unfinished=await tx.query("SELECT 1 FROM ebay_market_price_runs WHERE organization_id=$1 AND search_id=$2 AND status<>'complete' LIMIT 1",[ctx.organizationId,id]);
        await tx.query("UPDATE ebay_market_price_searches SET status=$3,lock_version=lock_version+1,updated_at=now() WHERE organization_id=$1 AND id=$2",[ctx.organizationId,id,unfinished.rowCount?"partial":"ready"]);
        return {status:202,body:{searchId:id,jobId:null,reservedCredits:0,cacheHit:true},resourceId:id};
      }
      await this.reserve(tx, id);
      await tx.query("UPDATE ebay_market_price_runs SET status='queued',lock_version=lock_version+1 WHERE organization_id=$1 AND id=$2", [ctx.organizationId, selected.id]);
      await tx.query("UPDATE ebay_market_price_searches SET status='queued',lock_version=lock_version+1,updated_at=now() WHERE organization_id=$1 AND id=$2", [ctx.organizationId, id]);
      const jobId = await this.dispatch(tx, ctx, id, key!, row.plan_json.specHash);
      return { status: 202, body: { searchId: id, jobId, reservedCredits: 1 }, resourceId: id };
    });
  }
  async confirm(ctx: RequestContext, id: string, key: string | undefined, input: Input) {
    return this.write(ctx, "ebay.result.confirm", key, { id, ...input }, "market_price.ebay.result_confirmed", "ebay_market_price_search", async tx => {
      const row = await this.search(tx, ctx, id, true); this.version(row, input);
      if (row.status === "cancelled") throw new ApiProblem("JOB_STATE_CONFLICT", 409, "取消済みの検索は確定できません");
      const detail = await this.detail(tx, ctx, row);
      if (!detail.statistics.some(item => item.includedCount > 0)) throw invalid("採用する候補を1件以上確認してください");
      const incomplete = detail.runs.some(run => run.status !== "complete");
      if (incomplete && input.partialAcknowledged !== true) throw invalid("未完了の市場があることを確認してください");
      const snapshot = { plan: detail.plan, statistics: detail.statistics, counts: detail.counts, runs: detail.runs,
        coverage: "provider_page_only", incomplete, version: 1 };
      const hash = createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");
      const result = await tx.query("INSERT INTO ebay_market_price_results(organization_id,search_id,snapshot_version,snapshot_json,snapshot_hash,confirmed_by_membership_id) SELECT $1,$2,COALESCE(max(snapshot_version),0)+1,$3,$4,$5 FROM ebay_market_price_results WHERE organization_id=$1 AND search_id=$2 RETURNING id,snapshot_version,snapshot_hash,confirmed_at", [ctx.organizationId, id, snapshot, hash, ctx.membershipId]);
      await tx.query("UPDATE ebay_market_price_searches SET status='confirmed',lock_version=lock_version+1,updated_at=now() WHERE organization_id=$1 AND id=$2", [ctx.organizationId, id]);
      return { status: 201, body: camel(result.rows[0]), resourceId: id, auditMetadata: { snapshotHash: hash } };
    });
  }
  async candidate(ctx: RequestContext, id: string, candidateId: string, key: string | undefined, input: Input) {
    if (!uuid.test(candidateId)) throw notFound();
    if (!["default","include","exclude"].includes(String(input.decision)) || !["observation","product"].includes(String(input.scope))) throw invalid("採否と適用範囲を確認してください");
    if (typeof input.reason !== "string" || !input.reason.trim() || input.reason.length > 1000) throw invalid("変更理由を1〜1000文字で入力してください");
    return this.write(ctx, "ebay.candidate.change", key, { id, candidateId, ...input }, "market_price.ebay.candidate_changed", "ebay_market_price_search", async tx => {
      const row = await this.search(tx, ctx, id, true); this.version(row, input);
      const found = await tx.query<{ observation_json: EbayObservation }>("SELECT observation_json FROM ebay_market_price_observations WHERE organization_id=$1 AND search_id=$2 AND id=$3 FOR UPDATE", [ctx.organizationId, id, candidateId]);
      const observation = found.rows[0]?.observation_json;
      if (!observation) throw notFound();
      if (input.scope === "product") {
        if (!observation.sourceItemId || input.decision === "include") throw invalid("商品単位では除外または除外解除を指定してください");
        await tx.query(`INSERT INTO ebay_market_price_item_decisions(organization_id,search_id,source_item_id,excluded,reason,changed_by_membership_id)
          VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(organization_id,search_id,source_item_id)
          DO UPDATE SET excluded=EXCLUDED.excluded,reason=EXCLUDED.reason,changed_by_membership_id=EXCLUDED.changed_by_membership_id,updated_at=now()`,
        [ctx.organizationId, id, observation.sourceItemId, input.decision === "exclude", input.reason, ctx.membershipId]);
      } else {
        if (input.decision === "include" && observation.hardExclusions.length) throw invalid("価格・根拠の必須除外は復帰できません");
        await tx.query("UPDATE ebay_market_price_observations SET manual_decision=$4,decision_reason=$5,changed_by_membership_id=$6,lock_version=lock_version+1,updated_at=now() WHERE organization_id=$1 AND search_id=$2 AND id=$3", [ctx.organizationId, id, candidateId, input.decision, input.reason, ctx.membershipId]);
      }
      const changed = await tx.query<SearchRow>("UPDATE ebay_market_price_searches SET lock_version=lock_version+1,updated_at=now() WHERE organization_id=$1 AND id=$2 RETURNING *", [ctx.organizationId, id]);
      return { status: 200, body: await this.detail(tx, ctx, changed.rows[0]!), resourceId: id,
        auditMetadata: { decisionScope: input.scope, decision: input.decision, candidateId } };
    });
  }
  async outlierPolicy(ctx: RequestContext, id: string, key: string | undefined, input: Input) {
    if (!Number.isInteger(input.outlierPercent) || Number(input.outlierPercent) < 1 || Number(input.outlierPercent) > 100) throw invalid("外れ値基準は1〜100%で指定してください");
    return this.write(ctx, "ebay.outlier.change", key, { id, ...input }, "market_price.ebay.outlier_changed", "ebay_market_price_search", async tx => {
      const row = await this.search(tx, ctx, id, true); this.version(row, input);
      const updated = await tx.query<SearchRow>("UPDATE ebay_market_price_searches SET outlier_percent=$3,lock_version=lock_version+1,updated_at=now() WHERE organization_id=$1 AND id=$2 RETURNING *", [ctx.organizationId, id, input.outlierPercent]);
      return { status: 200, body: await this.detail(tx, ctx, updated.rows[0]!), resourceId: id };
    });
  }
  async cancel(ctx: RequestContext, id: string, key: string | undefined, input: Input) {
    if (Object.keys(input).some(name => name !== "expectedLockVersion")) throw invalid("取消条件に未対応の項目があります");
    return this.write(ctx, "ebay.search.cancel", key, { id, ...input }, "market_price.ebay.search_cancelled", "ebay_market_price_search", async tx => {
      const row = await this.search(tx, ctx, id, true); this.version(row, input);
      if (row.status === "confirmed") throw new ApiProblem("JOB_STATE_CONFLICT", 409, "確定済み結果は取消できません");
      // Leased pages may already be crossing the external dispatch boundary. Only
      // definitely unsent pages are released here; the worker reconciles the rest.
      await tx.query(`UPDATE ebay_market_price_pages SET state='cancelled',credit_state='released',credits=0,
        checkpoint_version=checkpoint_version+1,updated_at=now() WHERE organization_id=$1 AND search_id=$2
        AND state='reserved' AND credit_state='reserved' AND request_id IS NULL AND lease_owner IS NULL`, [ctx.organizationId, id]);
      await tx.query(`UPDATE ebay_market_price_runs SET status='cancelled',lock_version=lock_version+1,updated_at=now()
        WHERE organization_id=$1 AND search_id=$2 AND status<>'complete'`, [ctx.organizationId, id]);
      const updated = await tx.query<SearchRow>(`UPDATE ebay_market_price_searches SET status='cancelled',
        cancel_requested_at=coalesce(cancel_requested_at,now()),lock_version=lock_version+1,updated_at=now()
        WHERE organization_id=$1 AND id=$2 RETURNING *`, [ctx.organizationId, id]);
      return { status: 200, body: await this.detail(tx, ctx, updated.rows[0]!), resourceId: id };
    });
  }
  async retry(ctx: RequestContext, id: string, key: string | undefined, input: Input) {
    const allowed = ["expectedLockVersion","market","pageNumber","consumptionConfirmed"];
    if (Object.keys(input).some(name => !allowed.includes(name)) || input.consumptionConfirmed !== true
      || !Number.isInteger(input.pageNumber) || Number(input.pageNumber)<1 || Number(input.pageNumber)>10)
      throw invalid("対象ページと再試行の最大1枠を確認してください");
    return this.write(ctx, "ebay.page.retry", key, { id, ...input }, "market_price.ebay.page_retry_requested", "ebay_market_price_search", async tx => {
      const row = await this.search(tx, ctx, id, true); this.version(row, input);
      if (row.status === "cancelled" || typeof input.market !== "string" || !row.plan_json.markets.includes(input.market as EbayMarket))
        throw new ApiProblem("JOB_STATE_CONFLICT",409,"この検索は再試行できません");
      const result = await tx.query<{run_id:string;attempt:number;request_json:SoldgraphPageRequest;state:string;credit_state:string;credits:number|null;request_id:string|null;lease_owner:string|null}>(
        `SELECT run_id,attempt,request_json,state,credit_state,credits,request_id,lease_owner FROM ebay_market_price_pages
          WHERE organization_id=$1 AND search_id=$2 AND market=$3 AND page_number=$4 ORDER BY attempt DESC LIMIT 1 FOR UPDATE`,
        [ctx.organizationId,id,input.market,input.pageNumber]);
      const previous = result.rows[0];
      if (!previous || previous.state!=="failed" || previous.credit_state!=="released" || previous.credits!==0 || !previous.request_id || previous.lease_owner)
        throw new ApiProblem("JOB_STATE_CONFLICT",409,"外部失敗と消費0枠が確認できたページだけ再試行できます。結果不明は照合が必要です");
      if (!Number.isSafeInteger(previous.attempt+1)) throw invalid("試行回数を確認してください");
      await this.page(tx,ctx,id,previous.run_id,row.account_id,previous.request_json,previous.attempt+1);
      await this.reserve(tx,id);
      await tx.query("UPDATE ebay_market_price_runs SET status='queued',failure_class=NULL,lock_version=lock_version+1,updated_at=now() WHERE organization_id=$1 AND id=$2",[ctx.organizationId,previous.run_id]);
      await tx.query("UPDATE ebay_market_price_searches SET status='queued',failure_class=NULL,lock_version=lock_version+1,updated_at=now() WHERE organization_id=$1 AND id=$2",[ctx.organizationId,id]);
      const jobId = await this.dispatch(tx,ctx,id,key!,row.plan_json.specHash);
      return {status:202,body:{searchId:id,jobId,market:input.market,pageNumber:input.pageNumber,attempt:previous.attempt+1,reservedCredits:1},resourceId:id,
        auditMetadata:{market:input.market,pageNumber:input.pageNumber,attempt:previous.attempt+1}};
    });
  }
  async resume(ctx: RequestContext, id: string, key: string | undefined, input: Input) {
    const allowed=["expectedLockVersion","market","pageNumber","resumeConfirmed"];
    if(Object.keys(input).some(name=>!allowed.includes(name)) || input.resumeConfirmed!==true
      || !Number.isInteger(input.pageNumber) || Number(input.pageNumber)<1 || Number(input.pageNumber)>10)
      throw invalid("保存済み取得の再確認を確認してください");
    return this.write(ctx,"ebay.page.resume",key,{id,...input},"market_price.ebay.page_resume_requested","ebay_market_price_search",async tx=>{
      const row=await this.search(tx,ctx,id,true);this.version(row,input);
      if(row.status==="cancelled" || typeof input.market!=="string" || !row.plan_json.markets.includes(input.market as EbayMarket))
        throw new ApiProblem("JOB_STATE_CONFLICT",409,"この検索は再開できません");
      const selected=await tx.query<{id:string;run_id:string;state:string;request_id:string|null;lease_until:Date|null;retry_not_before:Date|null}>(
        `SELECT id,run_id,state,request_id,lease_until,retry_not_before FROM ebay_market_price_pages
        WHERE organization_id=$1 AND search_id=$2 AND market=$3 AND page_number=$4 ORDER BY attempt DESC LIMIT 1 FOR UPDATE`,
        [ctx.organizationId,id,input.market,input.pageNumber]);
      const page=selected.rows[0];
      if(!page || !page.request_id || !["blocked","parse_failed","unknown"].includes(page.state) || page.lease_until)
        throw new ApiProblem("JOB_STATE_CONFLICT",409,"保存済みの外部受付を確認できるページだけ再開できます。新しい検索は作成していません");
      if(page.retry_not_before && page.retry_not_before.getTime()>Date.now())
        throw new ApiProblem("JOB_STATE_CONFLICT",409,"再確認の待機時間が終了していません");
      try{await tx.query("SELECT assert_soldgraph_resume($1)",[id]);}
      catch(error){if(error instanceof Error && error.message.includes("SOLDGRAPH_DISABLED"))
        throw new ApiProblem("JOB_STATE_CONFLICT",409,"運用担当者による取得設定の復旧が必要です。停止状態は変更していません");throw error;}
      await tx.query(`UPDATE ebay_market_price_pages SET state=CASE WHEN normalized_result_json IS NOT NULL AND credits IS NOT NULL THEN 'complete' ELSE 'unknown' END,failure_class=NULL,retry_not_before=NULL,
        checkpoint_version=checkpoint_version+1,updated_at=now() WHERE organization_id=$1 AND id=$2`,[ctx.organizationId,page.id]);
      await tx.query("UPDATE ebay_market_price_runs SET status='queued',failure_class=NULL,lock_version=lock_version+1,updated_at=now() WHERE organization_id=$1 AND id=$2",[ctx.organizationId,page.run_id]);
      await tx.query("UPDATE ebay_market_price_searches SET status='fetching',failure_class=NULL,lock_version=lock_version+1,updated_at=now() WHERE organization_id=$1 AND id=$2",[ctx.organizationId,id]);
      const jobId=await this.dispatch(tx,ctx,id,key!,row.plan_json.specHash);
      return {status:202,body:{searchId:id,jobId,status:"queued",reservedCredits:0,resumedExistingRequest:true},resourceId:id};
    });
  }
  async repeat(ctx: RequestContext, id: string, key: string | undefined, input: Input) {
    const edited=input.mode==="edited";
    const allowed=["expectedLockVersion","consumptionConfirmed","mode",...(edited?["keyword","markets","conditions","buyingFormat","exclusionKeywords","outlierPercent","acquisitionMode"]:[])];
    if (Object.keys(input).some(name=>!allowed.includes(name))
      || input.consumptionConfirmed!==true || !["latest","edited"].includes(input.mode as string)) throw invalid("再検索の条件・対象市場と最大消費枠を確認してください");
    if(edited && (!["reuse","latest"].includes(input.acquisitionMode as string)
      || !Array.isArray(input.exclusionKeywords) || input.exclusionKeywords.length>20
      || input.exclusionKeywords.some(value=>typeof value!=="string"||!value.trim()||value.normalize("NFKC").trim().length>100)
      || !Number.isInteger(input.outlierPercent)||Number(input.outlierPercent)<1||Number(input.outlierPercent)>100))
      throw invalid("取得方法・除外語・外れ値基準を確認してください");
    return this.write(ctx,"ebay.search.repeat",key,{id,...input},"market_price.ebay.search_repeated","ebay_market_price_search",async tx=>{
      const previous=await this.search(tx,ctx,id,true);this.version(previous,input);
      await this.approvedRetention(tx);
      const unresolved=await tx.query("SELECT 1 FROM ebay_market_price_pages WHERE organization_id=$1 AND search_id=$2 AND credits IS NULL LIMIT 1",[ctx.organizationId,id]);
      if(unresolved.rowCount)throw new ApiProblem("JOB_STATE_CONFLICT",409,"前回の消費状態が未確定です。同じ取得の照合を終えてから再検索してください");
      const accountId=process.env.SOLDGRAPH_ACCOUNT_ID;
      if(!accountId||!uuid.test(accountId))throw new ApiProblem("FEATURE_DISABLED",404,"eBay取得設定はまだ利用できません");
      let plan:EbaySearchPlan;
      try{plan=createEbaySearchPlan(edited?{keyword:input.keyword as string,markets:input.markets as EbayMarket[],
        conditions:input.conditions as EbayCondition[],buyingFormat:input.buyingFormat as SoldgraphPageRequest["buyingFormat"]}:
        {keyword:previous.plan_json.keyword,markets:previous.plan_json.markets,conditions:previous.plan_json.conditions,buyingFormat:previous.plan_json.buyingFormat});}
      catch{throw invalid("確認済み検索語・市場・状態・販売形式を確認してください");}
      const exclusions=edited?[...new Set((input.exclusionKeywords as string[]).map(value=>value.normalize("NFKC").trim()))]:previous.exclusion_keywords_json;
      const outlierPercent=edited?input.outlierPercent:previous.outlier_percent;
      const acquisitionMode=edited?input.acquisitionMode:"latest";
      const productBasis={...previous.product_basis_json,keyword:plan.keyword};
      const searchId=randomUUID();
      await tx.query(`INSERT INTO ebay_market_price_searches(id,organization_id,branch_id,created_by_membership_id,
        identification_id,account_id,plan_json,plan_hash,exclusion_keywords_json,outlier_percent,product_basis_json,acquisition_mode)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11::jsonb,$12)`,[searchId,ctx.organizationId,previous.branch_id,ctx.membershipId,
        previous.identification_id,accountId,plan,plan.specHash,JSON.stringify(exclusions),outlierPercent,JSON.stringify(productBasis),acquisitionMode]);
      const cacheTarget=await this.search(tx,ctx,searchId,true);
      let cachedPages=0;
      for(const market of plan.markets){
        const run=await tx.query<{id:string}>("INSERT INTO ebay_market_price_runs(organization_id,search_id,market) VALUES($1,$2,$3) RETURNING id",[ctx.organizationId,searchId,market]);
        const request={keyword:plan.keyword,market,page:1,conditions:plan.conditions,buyingFormat:plan.buyingFormat};
        await this.page(tx,ctx,searchId,run.rows[0]!.id,accountId,request);
        if(await this.reusePage(tx,ctx,cacheTarget,run.rows[0]!.id,request))cachedPages++;
      }
      const reservedCredits=plan.markets.length-cachedPages;
      if(reservedCredits)await this.reserve(tx,searchId);
      const jobId=reservedCredits?await this.dispatch(tx,ctx,searchId,key!,plan.specHash):null;
      const status=reservedCredits?"queued":"ready";
      if(!reservedCredits)await tx.query("UPDATE ebay_market_price_searches SET status='ready' WHERE organization_id=$1 AND id=$2",[ctx.organizationId,searchId]);
      return{status:202,body:{searchId,jobId,sourceProvider:"soldgraph_ebay",status,reservedCredits,cachedPages,cacheHit:cachedPages>0},resourceId:searchId,
        auditMetadata:{previousSearchId:id,marketCount:plan.markets.length,mode:input.mode,acquisitionMode}};
    });
  }
}
