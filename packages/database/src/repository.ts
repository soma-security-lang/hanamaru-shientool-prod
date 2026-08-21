import { createHash } from "node:crypto";
import pg, { type Pool, type PoolClient, type QueryResult, type QueryResultRow } from "pg";
import type { RequestContext } from "@hanamaru/contracts";

export type RepositoryContext = RequestContext;

export function createPool(connectionString = process.env.DATABASE_URL): Pool {
  if (!connectionString) throw new Error("DATABASE_URL is required");
  const ssl = process.env.DATABASE_SSL === "require" ? { rejectUnauthorized: true } : undefined;
  return new pg.Pool({ connectionString, max: Number(process.env.DATABASE_POOL_MAX ?? 10), idleTimeoutMillis: 30_000, ssl });
}

export class RepositoryTransaction {
  constructor(private readonly client: PoolClient, readonly context: RepositoryContext) {}

  query<T extends QueryResultRow = QueryResultRow>(sql: string, values: unknown[] = []): Promise<QueryResult<T>> {
    return this.client.query<T>(sql, values);
  }

  async audit(action: string, resourceType: string, resourceId: string | null, result: "allowed" | "denied" | "failed", metadata: Record<string, unknown> = {}): Promise<void> {
    await this.client.query("SELECT pg_advisory_xact_lock(hashtextextended('audit:'||$1::text,0))",[this.context.organizationId]);
    const previous = await this.client.query<{ event_hash: string|null }>(
      `SELECT COALESCE(
         (SELECT event_hash FROM audit_events WHERE organization_id=$1 ORDER BY occurred_at DESC,id DESC LIMIT 1),
         (SELECT last_event_hash FROM audit_retention_anchors WHERE organization_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1)
       ) event_hash`,[this.context.organizationId]);
    const prevHash = previous.rows[0]?.event_hash ?? "0".repeat(64);
    const policy=await this.client.query<{id:string;retention_days:number}>("SELECT id,retention_days FROM retention_policies WHERE organization_id=$1 AND data_type='audit' AND effective_from<=now() ORDER BY effective_from DESC,version DESC LIMIT 1",[this.context.organizationId]);
    if(!policy.rows[0])throw new Error("ACTIVE_AUDIT_RETENTION_POLICY_REQUIRED");
    const canonical = JSON.stringify({ prevHash, action, resourceType, resourceId, result, requestId: this.context.requestId, metadata });
    const eventHash = createHash("sha256").update(canonical).digest("hex");
    await this.client.query(
      `INSERT INTO audit_events(organization_id,actor_type,actor_id,action,resource_type,resource_id,result,request_id,trace_id,metadata_redacted,prev_event_hash,event_hash,retention_until,retention_policy_id)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,now()+($13||' days')::interval,$14)`,
      [this.context.organizationId, this.context.roles.length ? "user" : "service", this.context.roles.length ? this.context.membershipId : "worker", action, resourceType, resourceId, result, this.context.requestId, this.context.traceId, metadata, prevHash, eventHash,policy.rows[0].retention_days,policy.rows[0].id],
    );
  }
}

export class HanamaruRepository {
  readonly contextRole:string|undefined;
  readonly systemRole:string|undefined;
  constructor(readonly pool: Pool,contextRole=process.env.DATABASE_CONTEXT_ROLE,systemRole=process.env.DATABASE_SYSTEM_ROLE) {
    if(contextRole&&!['hanamaru_api','hanamaru_worker'].includes(contextRole))throw new Error("DATABASE_CONTEXT_ROLE must be hanamaru_api or hanamaru_worker");
    if(systemRole&&!['hanamaru_api_system','hanamaru_worker_system'].includes(systemRole))throw new Error("DATABASE_SYSTEM_ROLE must be hanamaru_api_system or hanamaru_worker_system");
    if(contextRole==='hanamaru_api'&&systemRole&&systemRole!=='hanamaru_api_system')throw new Error("hanamaru_api requires hanamaru_api_system");
    if(contextRole==='hanamaru_worker'&&systemRole&&systemRole!=='hanamaru_worker_system')throw new Error("hanamaru_worker requires hanamaru_worker_system");
    if(process.env.NODE_ENV==="production"&&(!contextRole||!systemRole))throw new Error("DATABASE_CONTEXT_ROLE and DATABASE_SYSTEM_ROLE are required in production");
    this.contextRole=contextRole;
    this.systemRole=systemRole;
  }

  async withContext<T>(context: RepositoryContext, operation: (tx: RepositoryTransaction) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      if(this.contextRole)await client.query(`SET LOCAL ROLE ${this.contextRole}`);
      await client.query("SELECT set_config('app.organization_id',$1,true),set_config('app.membership_id',$2,true),set_config('app.role_codes',$3,true),set_config('app.request_id',$4,true)", [
        context.organizationId, context.membershipId, context.roles.join(","), context.requestId,
      ]);
      const value = await operation(new RepositoryTransaction(client, context));
      await client.query("COMMIT");
      return value;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async system<T extends QueryResultRow = QueryResultRow>(sql: string, values: unknown[] = []): Promise<QueryResult<T>> {
    const client=await this.pool.connect();
    try{
      await client.query("BEGIN");
      if(this.systemRole)await client.query(`SET LOCAL ROLE ${this.systemRole}`);
      const result=await client.query<T>(sql,values);
      await client.query("COMMIT");
      return result;
    }catch(error){
      await client.query("ROLLBACK");
      throw error;
    }finally{client.release();}
  }

  async close(): Promise<void> { await this.pool.end(); }
}
