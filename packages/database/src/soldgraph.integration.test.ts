import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import type { RequestContext, SoldgraphCheckpoint } from "@hanamaru/contracts";
import { createPool, HanamaruRepository } from "./repository.js";
import { SoldgraphCheckpointRepository } from "./soldgraph-checkpoints.js";
import { developmentIds, seedDevelopment } from "./seed.js";

const databaseUrl = process.env.DATABASE_URL;
const tables = ["ebay_market_price_searches", "ebay_market_price_runs", "ebay_market_price_pages",
  "ebay_market_price_observations", "ebay_market_price_item_decisions", "ebay_market_price_results"];

describe.skipIf(!databaseUrl)("eBay additive storage (isolated PostgreSQL)", () => {
  beforeAll(async () => { const pool = createPool(databaseUrl); try { await seedDevelopment(pool); } finally { await pool.end(); } });
  it("forces organization isolation on every product-data table", async () => {
    const pool = createPool(databaseUrl);
    try {
      const result = await pool.query<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>(
        "SELECT relname,relrowsecurity,relforcerowsecurity FROM pg_class WHERE relname=ANY($1) ORDER BY relname", [tables]);
      expect(result.rows).toHaveLength(tables.length);
      expect(result.rows.every(row => row.relrowsecurity && row.relforcerowsecurity)).toBe(true);
      const policies = await pool.query("SELECT tablename,qual,with_check FROM pg_policies WHERE tablename=ANY($1)", [tables]);
      expect(policies.rows).toHaveLength(tables.length);
      expect(policies.rows.every(row => row.qual.includes("app_org_id()") && row.with_check.includes("app_org_id()"))).toBe(true);
    } finally { await pool.end(); }
  });
  it("keeps snapshots immutable for runtime roles and credentials outside product storage", async () => {
    const pool = createPool(databaseUrl);
    try {
      const permission = await pool.query<{ can_insert: boolean; can_update: boolean; can_delete: boolean; account_access: boolean }>(
        `SELECT has_table_privilege('hanamaru_api','ebay_market_price_results','INSERT') can_insert,
          has_table_privilege('hanamaru_api','ebay_market_price_results','UPDATE') can_update,
          has_table_privilege('hanamaru_api','ebay_market_price_results','DELETE') can_delete,
          has_table_privilege('hanamaru_api','soldgraph_accounts','SELECT') account_access`);
      expect(permission.rows[0]).toEqual({ can_insert: true, can_update: false, can_delete: false, account_access: false });
      const publication=await pool.query(`SELECT has_function_privilege('hanamaru_worker','soldgraph_publication_allowed(text,uuid)','EXECUTE') worker,
        has_function_privilege('hanamaru_api','soldgraph_publication_allowed(text,uuid)','EXECUTE') api,
        has_function_privilege('public','soldgraph_publication_allowed(text,uuid)','EXECUTE') public`);
      expect(publication.rows[0]).toEqual({worker:true,api:false,public:false});
      const budgets=await pool.query("SELECT has_table_privilege('hanamaru_api','soldgraph_budgets','SELECT') can_read,has_table_privilege('hanamaru_api','soldgraph_budgets','UPDATE') can_update");
      expect(budgets.rows[0]).toEqual({can_read:false,can_update:false});
      const monitor=await pool.query("SELECT has_function_privilege('hanamaru_worker_system','soldgraph_operational_candidates()','EXECUTE') worker,has_function_privilege('hanamaru_api_system','soldgraph_operational_candidates()','EXECUTE') api,has_function_privilege('public','soldgraph_operational_candidates()','EXECUTE') public");
      expect(monitor.rows[0]).toEqual({worker:true,api:false,public:false});
      for(const signature of ["begin_soldgraph_usage(uuid,uuid)","finish_soldgraph_usage(uuid,uuid,jsonb,integer)","fail_soldgraph_usage(uuid,uuid)"]){
        const access=await pool.query("SELECT has_function_privilege('hanamaru_worker_system',$1,'EXECUTE') worker,has_function_privilege('hanamaru_api_system',$1,'EXECUTE') api,has_function_privilege('public',$1,'EXECUTE') public",[signature]);
        expect(access.rows[0]).toEqual({worker:true,api:false,public:false});
      }
      const columns = await pool.query<{ column_name: string }>(
        "SELECT column_name FROM information_schema.columns WHERE table_name=ANY($1)", [[...tables, "soldgraph_accounts"]]);
      expect(columns.rows.some(row => /api_key|authorization|raw_response|seller_text/.test(row.column_name))).toBe(false);
    } finally { await pool.end(); }
  });
  it("defaults accounts to no budget and emergency stop, without enabling eBay for organizations", async () => {
    const pool = createPool(databaseUrl), client = await pool.connect();
    try {
      await client.query("BEGIN");
      const inserted = await client.query("INSERT INTO soldgraph_accounts(account_key) VALUES('synthetic-integration-account') RETURNING execution_mode,credit_budget,pending_limit,usage_remaining");
      expect(inserted.rows[0]).toEqual({ execution_mode: "emergency_stop", credit_budget: 0, pending_limit: 1, usage_remaining: null });
      const flag = await client.query("SELECT * FROM feature_flags WHERE flag_key='market_price_ebay' AND enabled=true");
      expect(flag.rowCount).toBe(0);
    } finally { await client.query("ROLLBACK"); client.release(); await pool.end(); }
  });
  it.each([
    ["rolling_30_days", "UTC"], ["calendar_month", "UTC"], ["calendar_month", "Asia/Tokyo"],
  ])("counts the exact %s boundary in %s without dropping older unresolved holds", async (period, timezone) => {
    const pool=createPool(databaseUrl), client=await pool.connect(), ids=developmentIds;
    const accountId=randomUUID(), identificationId=randomUUID(), searchId=randomUUID(), runId=randomUUID(), pageId=randomUUID();
    try {
      // A single transaction fixes now() for both historical fixtures and the real SQL gate.
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.organization_id',$1,true),set_config('app.membership_id',$2,true)",[ids.organizationId,ids.managerMembershipId]);
      await client.query("INSERT INTO ebay_retention_policies(organization_id,content_days,approved_at,approved_by_membership_id) VALUES($1,90,now(),$2)",[ids.organizationId,ids.managerMembershipId]);
      await client.query("INSERT INTO feature_flags(organization_id,flag_key,enabled,owner_membership_id,rollback_note) VALUES($1,'market_price_ebay',true,$2,'synthetic boundary transaction only') ON CONFLICT(organization_id,flag_key) DO UPDATE SET enabled=true,expires_at=NULL",[ids.organizationId,ids.managerMembershipId]);
      await client.query("INSERT INTO soldgraph_accounts(id,account_key,execution_mode,credit_budget,usage_remaining,usage_checked_at,usage_window_json) VALUES($1,$2,'enabled',10,10,now(),'{}')",[accountId,`synthetic-boundary-${accountId}`]);
      await client.query(`INSERT INTO soldgraph_budgets(account_id,scope_type,organization_id,membership_id,period_kind,calendar_timezone,credit_limit)
        VALUES($1,'account',NULL,NULL,$4,$5,0),($1,'organization',$2,NULL,$4,$5,0),($1,'membership',$2,$3,$4,$5,0)`,[accountId,ids.organizationId,ids.managerMembershipId,period,timezone]);
      await client.query("INSERT INTO market_price_identifications(id,organization_id,branch_id,created_by_membership_id,status,expires_at) VALUES($1,$2,$3,$4,'confirmed',now()+interval '1 hour')",[identificationId,ids.organizationId,ids.branchId,ids.managerMembershipId]);
      await client.query("INSERT INTO ebay_market_price_searches(id,organization_id,branch_id,created_by_membership_id,identification_id,account_id,plan_json,plan_hash) VALUES($1,$2,$3,$4,$5,$6,'{}',$7)",[searchId,ids.organizationId,ids.branchId,ids.managerMembershipId,identificationId,accountId,"c".repeat(64)]);
      await client.query("INSERT INTO ebay_market_price_runs(id,organization_id,search_id,market) VALUES($1,$2,$3,'us')",[runId,ids.organizationId,searchId]);
      await client.query("INSERT INTO ebay_market_price_pages(id,organization_id,search_id,run_id,account_id,market,page_number,operation_key,request_json,state,credit_state,credits) VALUES($1,$2,$3,$4,$5,'us',1,$6,'{}','blocked','charged',1)",[pageId,ids.organizationId,searchId,runId,accountId,`sg-${"d".repeat(64)}`]);
      for (const [offset, denied] of [[-1,false],[0,true],[1,true]] as const) {
        // Only this disposable database owner may construct an immutable historical charge.
        await client.query("SET LOCAL session_replication_role='replica'");
        await client.query(`UPDATE ebay_market_price_pages SET charged_at=(CASE WHEN $2='rolling_30_days' THEN now()-interval '30 days'
          ELSE date_trunc('month',now() AT TIME ZONE $3) AT TIME ZONE $3 END)+$4*interval '1 microsecond' WHERE id=$1`,[pageId,period,timezone,offset]);
        await client.query("SET LOCAL session_replication_role='origin'");
        await client.query("SAVEPOINT boundary_gate");
        await client.query("SET LOCAL ROLE hanamaru_api");
        if (denied) {
          await expect(client.query("SELECT assert_soldgraph_reservation($1)",[searchId])).rejects.toThrow("SOLDGRAPH_BUDGET_EXCEEDED");
        } else { await client.query("SELECT assert_soldgraph_reservation($1)",[searchId]); }
        await client.query("ROLLBACK TO SAVEPOINT boundary_gate");
      }
      await client.query("SET LOCAL session_replication_role='replica'");
      await client.query("UPDATE ebay_market_price_pages SET charged_at=now()-interval '1 year' WHERE id=$1",[pageId]);
      await client.query("SET LOCAL session_replication_role='origin'");
      await client.query("UPDATE ebay_market_price_pages SET credit_state='unknown',credits=NULL WHERE id=$1",[pageId]);
      await client.query("SET LOCAL ROLE hanamaru_api");
      await expect(client.query("SELECT assert_soldgraph_reservation($1)",[searchId])).rejects.toThrow("SOLDGRAPH_BUDGET_EXCEEDED");
    } finally { await client.query("ROLLBACK");client.release();await pool.end(); }
  });
  it("leaves legacy JPY and ninety-day constraints in place", async () => {
    const pool = createPool(databaseUrl);
    try {
      const constraints = await pool.query<{ definition: string }>(
        "SELECT pg_get_constraintdef(oid) definition FROM pg_constraint WHERE conrelid='market_price_searches'::regclass");
      expect(constraints.rows.some(row => row.definition.includes("period_days = 90"))).toBe(true);
      const columns = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name='ebay_market_price_searches' AND column_name IN ('period_days','min_price','median_price')");
      expect(columns.rowCount).toBe(0);
    } finally { await pool.end(); }
  });
  it("commits checkpoints with CAS, lease and organization guards under the actual Worker role", async () => {
    const pool = createPool(databaseUrl), ids = developmentIds, accountId = randomUUID(), identificationId = randomUUID();
    const searchId = randomUUID(), runId = randomUUID(), leaseOwner = randomUUID();
    const operationKey = `sg-${randomUUID().replaceAll("-", "").repeat(2)}`;
    const request = { keyword: "SYNTHETIC CAMERA X1", market: "us" as const, page: 1, conditions: [], buyingFormat: null };
    const context: RequestContext = { requestId: randomUUID(), traceId: randomUUID(), organizationId: ids.organizationId,
      membershipId: ids.membershipId, branchId: ids.branchId, roles: [], capabilities: [], authorizationScopes: [] };
    const repository = new HanamaruRepository(pool, "hanamaru_worker", "hanamaru_worker_system");
    try {
      await pool.query("INSERT INTO soldgraph_accounts(id,account_key) VALUES($1,$2)", [accountId, `synthetic-${accountId}`]);
      await pool.query("INSERT INTO market_price_identifications(id,organization_id,branch_id,created_by_membership_id,status,expires_at) VALUES($1,$2,$3,$4,'confirmed',now()+interval '1 hour')", [identificationId, ids.organizationId, ids.branchId, ids.membershipId]);
      await pool.query("INSERT INTO ebay_market_price_searches(id,organization_id,branch_id,created_by_membership_id,identification_id,account_id,plan_json,plan_hash) VALUES($1,$2,$3,$4,$5,$6,'{}',$7)", [searchId, ids.organizationId, ids.branchId, ids.membershipId, identificationId, accountId, "a".repeat(64)]);
      await pool.query("INSERT INTO ebay_market_price_runs(id,organization_id,search_id,market) VALUES($1,$2,$3,'us')", [runId, ids.organizationId, searchId]);
      await pool.query("INSERT INTO ebay_market_price_pages(organization_id,search_id,run_id,account_id,market,page_number,operation_key,request_json,lease_owner,lease_until) VALUES($1,$2,$3,$4,'us',1,$5,$6,$7,now()+interval '1 minute')", [ids.organizationId, searchId, runId, accountId, operationKey, request, leaseOwner]);
      const store = new SoldgraphCheckpointRepository(repository, context, leaseOwner);
      const initial = await store.load(operationKey);
      expect(initial).toMatchObject({ version: 0, state: "reserved", credits: null, request });
      const pending: SoldgraphCheckpoint = { ...initial, version: 1, state: "pending", creditState: "pending", requestId: "synthetic-job-1" };
      const parallel = await Promise.allSettled([store.save(pending, 0), store.save(pending, 0)]);
      expect(parallel.filter(result => result.status === "fulfilled")).toHaveLength(1);
      expect((await store.load(operationKey)).version).toBe(1);
      await expect(new SoldgraphCheckpointRepository(repository, { ...context, organizationId: randomUUID() }, leaseOwner).load(operationKey)).rejects.toThrow("LEASE_REQUIRED");
      await expect(new SoldgraphCheckpointRepository(repository, context, randomUUID()).load(operationKey)).rejects.toThrow("LEASE_REQUIRED");
      const permission=await repository.withContext(context,tx=>tx.query<{allowed:boolean}>("SELECT soldgraph_publication_allowed($1,$2) allowed",[operationKey,leaseOwner]));
      expect(permission.rows[0]?.allowed).toBe(false);
      await expect(repository.withContext({...context,organizationId:randomUUID()},tx=>tx.query("SELECT soldgraph_publication_allowed($1,$2)",[operationKey,leaseOwner]))).rejects.toThrow("LEASE_REQUIRED");
      await expect(repository.withContext(context,tx=>tx.query("SELECT soldgraph_publication_allowed($1,$2)",[operationKey,randomUUID()]))).rejects.toThrow("LEASE_REQUIRED");
      await pool.query("UPDATE ebay_market_price_pages SET lease_until=now()-interval '1 second' WHERE operation_key=$1", [operationKey]);
      await expect(store.save({ ...pending, version: 2 }, 1)).rejects.toThrow("VERSION_CONFLICT");
      expect((await pool.query("SELECT checkpoint_version FROM ebay_market_price_pages WHERE operation_key=$1", [operationKey])).rows[0]?.checkpoint_version).toBe("1");
      await pool.query("UPDATE ebay_market_price_pages SET credit_state='charged',credits=1 WHERE operation_key=$1",[operationKey]);
      const charged=await pool.query<{charged_at:Date}>("SELECT charged_at FROM ebay_market_price_pages WHERE operation_key=$1",[operationKey]);
      expect(charged.rows[0]!.charged_at).toBeInstanceOf(Date);
      await pool.query("UPDATE ebay_market_price_pages SET charged_at=now()-interval '60 days',updated_at=now()+interval '1 day' WHERE operation_key=$1",[operationKey]);
      expect((await pool.query<{charged_at:Date}>("SELECT charged_at FROM ebay_market_price_pages WHERE operation_key=$1",[operationKey])).rows[0]!.charged_at.getTime()).toBe(charged.rows[0]!.charged_at.getTime());
    } finally {
      await pool.query("DELETE FROM ebay_market_price_pages WHERE search_id=$1", [searchId]);
      await pool.query("DELETE FROM ebay_market_price_runs WHERE search_id=$1", [searchId]);
      await pool.query("DELETE FROM ebay_market_price_searches WHERE id=$1", [searchId]);
      await pool.query("DELETE FROM market_price_identifications WHERE id=$1", [identificationId]);
      await pool.query("DELETE FROM soldgraph_accounts WHERE id=$1", [accountId]);
      await repository.close();
    }
  });
});
