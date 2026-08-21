import { createHash, randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { describe, expect, it } from "vitest";
import { migrate } from "./migrate.js";

interface LegacySourceItem {
  id: string;
  legacy_id: string;
  type: string;
  category: string;
  title: string;
  body: string;
  tags: string[];
  original_sha256: string;
  legacy_payload: Record<string, unknown>;
  source: Record<string, unknown>;
}

const databaseUrl = process.env.DATABASE_URL;
const sourceRoot = dirname(fileURLToPath(import.meta.url));
const pocPath = resolve(sourceRoot, "../../../apps/web/src/mocks/poc-content.json");
const migrationsDir = resolve(sourceRoot, "../migrations");
const legacyOrganizationId = "20000000-0000-4000-8000-000000000001";
const legacy0021Checksum = "caa19b31e6516521caae9734e7cf5d674193624d30105fe18b10bed42c9f723c";
const legacy0023Checksum = "c7427b1e6042c0e6660de75a946292db03571937f5bbc91e9162ae2c9b32b9ec";
const production0028Checksum = "68f131c92355b4cca334b7cabeb0c2df7a15033d603541cf9c61503cfdd1a14f";
const production0029Checksum = "4345c4b26c9552ceac778f11f12eb9c669088197bc9503e249c50524268b21f0";

describe.skipIf(!databaseUrl)("populated database upgrade", () => {
  it("upgrades the released 0012 schema with all 1,676 legacy PoC rows", async () => {
    const admin = new pg.Client({ connectionString: databaseUrl });
    await admin.connect();
    const database = `upgrade_${Date.now()}_${randomUUID().replaceAll("-", "")}`;
    await admin.query(`CREATE DATABASE ${database}`);
    const targetUrl = new URL(databaseUrl!);
    targetUrl.pathname = `/${database}`;
    const pool = new pg.Pool({ connectionString: targetUrl.toString() });
    try {
      const through = await migrate(pool, { through: "0012_retention_scheduler.sql" });
      expect(through.applied).toHaveLength(12);

      const source = JSON.parse(await readFile(pocPath, "utf8")) as { records: LegacySourceItem[] };
      expect(source.records).toHaveLength(1676);
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(
          "INSERT INTO organizations(id,organization_key,name) VALUES($1,'legacy-upgrade','Legacy upgrade fixture')",
          [legacyOrganizationId],
        );
        await client.query(`INSERT INTO retention_policies(organization_id,data_type,version,retention_days,legal_hold_supported,status,effective_from)
          VALUES($1,'audit',1,365,false,'active',now()-interval '1 day')`,[legacyOrganizationId]);
        await client.query(`INSERT INTO audit_events(organization_id,actor_type,actor_id,action,resource_type,result,request_id,trace_id,prev_event_hash,event_hash)
          VALUES($1,'system','upgrade-fixture','legacy.event','migration','allowed','upgrade-request','upgrade-trace',$2,$3)`,[legacyOrganizationId,"0".repeat(64),"1".repeat(64)]);
        for (const item of source.records) {
          const contentId = randomUUID();
          const versionId = randomUUID();
          const searchText = [item.title, item.category, item.body, ...item.tags].join(" ");
          const bodyJson = {
            body: item.body,
            tags: item.tags,
            legacyPayload: item.legacy_payload,
            sourceRef: item.source,
            legacyId: item.legacy_id,
          };
          await client.query(
            `INSERT INTO content_items(
               id,organization_id,content_type,stable_key,title,category,status,search_text
             ) VALUES($1,$2,$3,$4,$5,$6,'draft',$7)`,
            [contentId, legacyOrganizationId, item.type, item.id, item.title, item.category, searchText],
          );
          await client.query(
            `INSERT INTO content_versions(
               id,organization_id,content_item_id,version,body_json,source_type,
               source_reference,source_hash,review_status,published_at
             ) VALUES($1,$2,$3,1,$4,'poc','legacy-poc:app.html',$5,'approved',now())`,
            [versionId, legacyOrganizationId, contentId, bodyJson, item.original_sha256],
          );
          await client.query(
            "UPDATE content_items SET current_version_id=$2,status='published' WHERE id=$1",
            [contentId, versionId],
          );
        }
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }

      const legacyState = await pool.query<{ total: number; published: number }>(`SELECT
        count(*)::int total,
        count(*) FILTER (WHERE status='published' AND current_version_id IS NOT NULL)::int published
        FROM content_items WHERE organization_id=$1`, [legacyOrganizationId]);
      expect(legacyState.rows[0]).toEqual({ total: 1676, published: 1676 });

      const upgraded = await migrate(pool);
      const manifest = (await readdir(migrationsDir)).filter((name) => /^\d{4}_.+\.sql$/.test(name)).sort();
      expect(upgraded.applied).toHaveLength(manifest.length - 12);
      const applied = await pool.query<{ version: string }>("SELECT version FROM schema_migrations ORDER BY version");
      expect(applied.rows.map((row) => row.version)).toEqual(manifest);

      const preserved = await pool.query<{
        total: number;
        stable_keys: number;
        current_versions: number;
        pilot_records: number;
      }>(`SELECT
        count(*)::int total,
        count(DISTINCT stable_key)::int stable_keys,
        count(current_version_id)::int current_versions,
        count(*) FILTER (
          WHERE status='draft' AND availability_state='pilot' AND published_version_id IS NULL
        )::int pilot_records
        FROM content_items WHERE organization_id=$1`, [legacyOrganizationId]);
      expect(preserved.rows[0]).toEqual({
        total: 1676,
        stable_keys: 1676,
        current_versions: 1676,
        pilot_records: 1676,
      });

      const repaired = await pool.query<{ count: number }>(`SELECT count(*)::int count
        FROM content_versions
        WHERE organization_id=$1 AND source_type='poc' AND review_status='draft'
          AND published_at IS NULL AND migration_state='extracted_needs_review'`, [legacyOrganizationId]);
      expect(repaired.rows[0]?.count).toBe(1676);
      expect((await pool.query(
        "SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='content_published_version_idx'",
      )).rowCount).toBe(1);
      const retainedAudit=await pool.query<{retention_policy_id:string|null;retention_until:Date|null}>("SELECT retention_policy_id,retention_until FROM audit_events WHERE organization_id=$1 AND action='legacy.event'",[legacyOrganizationId]);
      expect(retainedAudit.rows[0]?.retention_policy_id).not.toBeNull();
      expect(retainedAudit.rows[0]?.retention_until).toBeInstanceOf(Date);
      await expect(pool.query("UPDATE audit_events SET action='mutated' WHERE organization_id=$1 AND action='legacy.event'",[legacyOrganizationId])).rejects.toMatchObject({message:"audit_events are append-only"});

      const migrationFile = "0021_content_publication_and_role_isolation.sql";
      const canonicalSql = await readFile(resolve(migrationsDir, migrationFile), "utf8");
      const canonicalChecksum = createHash("sha256").update(canonicalSql).digest("hex");
      expect(canonicalChecksum).not.toBe(legacy0021Checksum);
      expect((await pool.query<{ checksum: string }>(
        "SELECT checksum FROM schema_migrations WHERE version=$1", [migrationFile],
      )).rows[0]?.checksum).toBe(canonicalChecksum);

      // Empty databases could apply the pre-fix 0021. Preserve that exact
      // history while continuing to reject all unknown checksum drift.
      await pool.query("UPDATE schema_migrations SET checksum=$1 WHERE version=$2", [legacy0021Checksum, migrationFile]);
      await pool.query("UPDATE schema_migrations SET checksum=$1 WHERE version='0023_retention_policy_enforcement.sql'", [legacy0023Checksum]);
      await pool.query("UPDATE schema_migrations SET checksum=$1 WHERE version='0028_security_definer_rls_owner.sql'", [production0028Checksum]);
      await pool.query("UPDATE schema_migrations SET checksum=$1 WHERE version='0029_visit_info_schema_bootstrap.sql'", [production0029Checksum]);
      const compatibleRerun = await migrate(pool);
      expect(compatibleRerun.applied).toEqual([]);
      expect(compatibleRerun.skipped).toEqual(manifest);
      await pool.query("UPDATE schema_migrations SET checksum=$1 WHERE version=$2", ["0".repeat(64), migrationFile]);
      await expect(migrate(pool)).rejects.toThrow(`Migration checksum mismatch: ${migrationFile}`);
    } finally {
      await pool.end();
      await admin.query(`DROP DATABASE IF EXISTS ${database}`);
      await admin.end();
    }
  }, 120_000);
});
