import { createHash, randomBytes } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { localPrisma } from "./client.js";
import { PrismaRateLimit } from "./rate-limit.js";
import { PrismaSessionStore } from "./session-store.js";

const url = process.env.ALIGNMENT_DATABASE_URL;
describe.skipIf(!url)("production session SQL contracts on isolated PostgreSQL", () => {
  const first = url ? new PrismaClient({ adapter: new PrismaPg({ connectionString: url, max: 1, options: "-c role=hanamaru_session" }), log: [] }) : undefined;
  const second = url ? new PrismaClient({ adapter: new PrismaPg({ connectionString: url, max: 1, options: "-c role=hanamaru_session" }), log: [] }) : undefined;
  const owner = url ? localPrisma(url, 1) : undefined;
  afterAll(async () => { await first?.$disconnect(); await second?.$disconnect(); await owner?.$disconnect(); });
  it("shares an atomic rate bucket across connections and resets only after expiry", async () => {
    const a = new PrismaRateLimit(first!), b = new PrismaRateLimit(second!);
    const identity = randomBytes(16).toString("hex");
    const outcomes = await Promise.all(Array.from({ length: 10 }, (_, index) => (index % 2 ? a : b).consume("db-test", identity, 5)));
    expect(outcomes.filter(Boolean)).toHaveLength(5);
    const key = createHash("sha256").update(`db-test\0${identity}`).digest("hex");
    await owner!.$executeRaw`UPDATE alignment_rate_limits SET expires_at=clock_timestamp()-interval '1 second' WHERE key=${key}`;
    expect(await a.consume("db-test", identity, 5)).toBe(true);
  });
  it("uses the session-only role and rotates keys without changing business IDs", async () => {
    const roles = await first!.$queryRaw<Array<{ role: string }>>`SELECT current_role::text AS role`;
    expect(roles[0]?.role).toBe("hanamaru_session");
    const key = randomBytes(32).toString("hex"), old = randomBytes(32).toString("hex"), next = randomBytes(32).toString("hex");
    const original = new PrismaSessionStore(first!, { activeVersion: "old", keys: { old }, maxSessions: 10000 });
    const rotated = new PrismaSessionStore(second!, { activeVersion: "next", keys: { old, next }, maxSessions: 10000 });
    const value = { csrf: "synthetic", expiresAt: Date.now() + 60_000, attempts: 0, credential: "Bearer synthetic-test-credential" };
    expect(await original.create(key, value)).toBe(true);
    expect((await rotated.get(key))!.value).toEqual(value);
    const row = await first!.alignmentSession.findUniqueOrThrow({ where: { key } });
    expect(row.encrypted).not.toContain(value.credential);
    expect(await rotated.replace(key, 0, key, value)).toBe(true);
    expect((await first!.alignmentSession.findUniqueOrThrow({ where: { key } })).encrypted).toMatch(/^v1:next:/);
    await rotated.remove(key);
    expect(await original.get(key)).toBeNull();
  });
  it.each(["hanamaru_api", "hanamaru_worker", "hanamaru_api_system", "hanamaru_worker_system"])("does not expose session data to %s", async role => {
    const denied = new Pool({ connectionString: url, max: 1, options: `-c role=${role}` });
    try { await expect(denied.query("SELECT key FROM alignment_sessions LIMIT 1")).rejects.toMatchObject({ code: "42501" }); }
    finally { await denied.end(); }
  });
});
