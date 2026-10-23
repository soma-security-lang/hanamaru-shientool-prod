// Test-only replacement for the unchanged Worker integration suite.
import type { Pool, QueryResult, QueryResultRow } from "pg";
import { localPrisma } from "./client.js";
import { PrismaRepository } from "./repository.js";
export * from "@hanamaru/database";
export class HanamaruRepository extends PrismaRepository {
  constructor(private readonly fixturePool: Pool, contextRole = "hanamaru_worker", systemRole = "hanamaru_worker_system") {
    if (process.env.HANAMARU_PRISMA_WORKER_TEST !== "true") throw new Error("TEST_ONLY");
    const url = process.env.ALIGNMENT_DATABASE_URL ?? "";
    super(localPrisma(url), url, contextRole, systemRole);
  }
  override async system<T extends QueryResultRow = QueryResultRow>(sql: string, values: unknown[] = []): Promise<QueryResult<T>> {
    // The old operations test seeds/cleans through repository.system with an
    // owner connection. Keep only its fixture DML there; runtime scan reads and
    // writes still exercise Prisma with the existing least-privilege roles.
    if (/^\s*(?:INSERT INTO jobs\(|UPDATE jobs SET status='succeeded'|DELETE FROM operational_alerts WHERE job_id\b|DELETE FROM jobs WHERE id\b)/.test(sql))
      return this.fixturePool.query<T>(sql, values);
    return super.system<T>(sql, values);
  }
  override async close() {
    try { await super.close(); } finally { await this.fixturePool.end(); }
  }
}
