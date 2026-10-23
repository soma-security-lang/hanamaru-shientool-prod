import type { Prisma, PrismaClient } from "@prisma/client";
import { HanamaruRepository, RepositoryTransaction, createPool, type RepositoryContext } from "@hanamaru/database";
import type { PoolClient, QueryResultRow, QueryResult } from "pg";

function pgValue(value: unknown): unknown {
  if (value instanceof Uint8Array) return Buffer.from(value);
  if (typeof value === "bigint") return String(value);
  if (Array.isArray(value)) return value.map(pgValue);
  if (value && typeof value === "object" && "toFixed" in value && typeof value.toFixed === "function") return String(value);
  if (value && typeof value === "object" && !(value instanceof Date) && !Buffer.isBuffer(value))
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key,
      // Existing schema has one SQL time(0) column; pg returns HH:mm:ss,
      // whereas Prisma returns a 1970 Date. Do not reinterpret timestamps.
      key === "scheduled_local_time" && item instanceof Date ? item.toISOString().slice(11,19) : pgValue(item)]));
  return value;
}
function parameter(value: unknown): unknown {
  if (value && typeof value === "object" && !(value instanceof Date) && !Array.isArray(value) && !Buffer.isBuffer(value)) return JSON.stringify(value);
  return value;
}

/** SQL text comes only from the existing server repository, values stay bound.
 * Raw SQL deliberately preserves RLS, locks, triggers, audit and idempotency.
 */
export class PrismaRepository extends HanamaruRepository {
  constructor(private readonly prisma: PrismaClient, url: string, contextRole: string, systemRole: string) {
    super(createPool(url), contextRole, systemRole);
  }
  private async query<T extends QueryResultRow>(tx: Prisma.TransactionClient, sql: string, values: unknown[] = []): Promise<QueryResult<T>> {
    try {
    const bound = values.map(parameter);
    const voidCall = /^\s*SELECT\s+(?:pg_advisory\w*|pg_sleep|assert_soldgraph_reservation|assert_soldgraph_resume|finish_soldgraph_usage|fail_soldgraph_usage|mark_outbox_published)\s*\(/i.test(sql);
    const rowsExpected = (/^\s*(SELECT|WITH|SHOW)\b/i.test(sql) || /\bRETURNING\b/i.test(sql)) && !voidCall;
    if (rowsExpected) {
      const rows = (await tx.$queryRawUnsafe<unknown[]>(sql, ...bound)).map(pgValue) as T[];
      return { rows, rowCount: rows.length, command: "SELECT", oid: 0, fields: [] };
    }
    const rowCount = await tx.$executeRawUnsafe(sql, ...bound);
    return { rows: [], rowCount, command: sql.trim().split(/\s+/)[0]!, oid: 0, fields: [] };
    } catch (error) {
      // Existing services branch on PostgreSQL SQLSTATE (e.g. uniqueness 23505).
      // Preserve that contract without exposing Prisma SQL/parameters in errors.
      const failure = error as { code?: string; meta?: { code?: string; driverAdapterError?: { cause?: { originalCode?: string; originalMessage?: string } } } };
      const state = failure.meta?.driverAdapterError?.cause?.originalCode ?? failure.meta?.code;
      const domainCode = failure.meta?.driverAdapterError?.cause?.originalMessage?.match(/\bSOLDGRAPH_(?:BUDGET_EXCEEDED|USAGE_UNKNOWN|DISABLED|RETENTION_UNCONFIGURED|RATE_LIMIT|PENDING_LIMIT)\b/)?.[0];
      if (failure.code === "P2010" && /^[0-9A-Z]{5}$/.test(state ?? ""))
        throw Object.assign(new Error(domainCode ?? "Database operation failed"), { code: state });
      throw error;
    }
  }
  override async withContext<T>(context: RepositoryContext, operation: (tx: RepositoryTransaction) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(async tx => {
      await tx.$executeRawUnsafe(`SET LOCAL ROLE ${this.contextRole}`);
      await tx.$executeRaw`SELECT set_config('app.organization_id',${context.organizationId},true),set_config('app.membership_id',${context.membershipId},true),set_config('app.role_codes',${context.roles.join(",")},true),set_config('app.request_id',${context.requestId},true)`;
      const client = { query: <R extends QueryResultRow>(sql: string, values?: unknown[]) => this.query<R>(tx, sql, values) } as unknown as PoolClient;
      return operation(new RepositoryTransaction(client, context));
    }, { timeout: 30_000, maxWait: 5000 });
  }
  override async system<T extends QueryResultRow = QueryResultRow>(sql: string, values: unknown[] = []): Promise<QueryResult<T>> {
    return this.prisma.$transaction(async tx => {
      await tx.$executeRawUnsafe(`SET LOCAL ROLE ${this.systemRole}`);
      return this.query<T>(tx, sql, values);
    }, { timeout: 30_000, maxWait: 5000 });
  }
  override async close() { await this.prisma.$disconnect(); await super.close(); }
}
