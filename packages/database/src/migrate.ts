import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Pool } from "pg";

export interface MigrationResult { applied: string[]; skipped: string[] }
export interface MigrationOptions { through?: string }

// Released upgrade fixes and exact production-applied pre-release checksums
// are accepted explicitly. All other checksum drift still fails.
const compatibleChecksums: Readonly<Record<string, readonly string[]>> = {
  "0021_content_publication_and_role_isolation.sql": [
    "caa19b31e6516521caae9734e7cf5d674193624d30105fe18b10bed42c9f723c",
  ],
  "0023_retention_policy_enforcement.sql": [
    "c7427b1e6042c0e6660de75a946292db03571937f5bbc91e9162ae2c9b32b9ec",
  ],
  "0028_security_definer_rls_owner.sql": [
    "68f131c92355b4cca334b7cabeb0c2df7a15033d603541cf9c61503cfdd1a14f",
  ],
  "0029_visit_info_schema_bootstrap.sql": [
    "4345c4b26c9552ceac778f11f12eb9c669088197bc9503e249c50524268b21f0",
  ],
};

export async function migrate(pool: Pool, options: MigrationOptions = {}): Promise<MigrationResult> {
  const migrationsDir = resolve(dirname(fileURLToPath(import.meta.url)), "../migrations");
  const manifest = (await readdir(migrationsDir)).filter((name) => /^\d{4}_.+\.sql$/.test(name)).sort();
  if (options.through && !manifest.includes(options.through)) throw new Error(`Unknown migration boundary: ${options.through}`);
  const files = options.through ? manifest.slice(0, manifest.indexOf(options.through) + 1) : manifest;
  await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version text PRIMARY KEY,
    checksum char(64) NOT NULL,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`);
  const applied: string[] = [];
  const skipped: string[] = [];
  for (const file of files) {
    const sql = await readFile(resolve(migrationsDir, file), "utf8");
    const checksum = createHash("sha256").update(sql).digest("hex");
    const existing = await pool.query<{ checksum: string }>("SELECT checksum FROM schema_migrations WHERE version=$1", [file]);
    if (existing.rowCount) {
      const appliedChecksum = existing.rows[0]?.checksum;
      const compatible = compatibleChecksums[file]?.includes(appliedChecksum ?? "") ?? false;
      if (appliedChecksum !== checksum && !compatible) throw new Error(`Migration checksum mismatch: ${file}`);
      skipped.push(file);
      continue;
    }
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations(version, checksum) VALUES ($1,$2)", [file, checksum]);
      await client.query("COMMIT");
      applied.push(file);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  return { applied, skipped };
}
