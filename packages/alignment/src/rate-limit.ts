import { createHash } from "node:crypto";
import type { PrismaClient } from "@prisma/client";

/** Shared by every instance; stores only a namespaced hash, never IPs or users. */
export class PrismaRateLimit {
  private operations = 0;
  constructor(private readonly db: PrismaClient) {}
  async consume(namespace: string, identity: string, max: number, seconds = 60): Promise<boolean> {
    if (!/^[a-z][a-z0-9:_-]{0,63}$/.test(namespace) || !identity || identity.length > 1024 ||
        !Number.isSafeInteger(max) || max < 1 || max > 10000 || !Number.isSafeInteger(seconds) || seconds < 1 || seconds > 3600)
      throw new Error("INVALID_RATE_LIMIT_POLICY");
    const key = createHash("sha256").update(`${namespace}\0${identity}`).digest("hex");
    if (++this.operations % 64 === 0) await this.db.$executeRaw`
      DELETE FROM alignment_rate_limits WHERE key IN
      (SELECT key FROM alignment_rate_limits WHERE expires_at<=clock_timestamp() ORDER BY expires_at LIMIT 100)`;
    const rows = await this.db.$queryRaw<Array<{ allowed: boolean }>>`
      INSERT INTO alignment_rate_limits AS bucket(key,hits,expires_at)
      VALUES (${key},1,clock_timestamp()+make_interval(secs=>${seconds}))
      ON CONFLICT (key) DO UPDATE SET
        hits=CASE WHEN bucket.expires_at<=clock_timestamp() THEN 1 ELSE least(bucket.hits+1,10001) END,
        expires_at=CASE WHEN bucket.expires_at<=clock_timestamp() THEN clock_timestamp()+make_interval(secs=>${seconds}) ELSE bucket.expires_at END
      RETURNING hits<=${max} AS allowed`;
    return rows[0]?.allowed === true;
  }
}
