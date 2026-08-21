import pg from "pg";
import { migrate } from "./migrate.js";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required");
const pool = new pg.Pool({ connectionString, max: 2, ssl: process.env.DATABASE_SSL === "require" ? { rejectUnauthorized: true } : undefined });
try {
  const through = process.env.MIGRATION_THROUGH?.trim() || undefined;
  const result = await migrate(pool, through ? { through } : {});
  process.stdout.write(`${JSON.stringify(result)}\n`);
} finally {
  await pool.end();
}
