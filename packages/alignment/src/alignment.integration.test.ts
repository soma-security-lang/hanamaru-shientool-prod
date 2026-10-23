import { afterAll, describe, expect, it } from "vitest";
import { randomBytes, createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createPool, HanamaruRepository, developmentIds as d, type RepositoryContext } from "@hanamaru/database";
import { localPrisma } from "./client.js";
import { PrismaSessionStore } from "./session-store.js";
import { PrismaRepository } from "./repository.js";
const url = process.env.ALIGNMENT_DATABASE_URL;
describe.skipIf(!url)("isolated Prisma and persistent session", () => {
  const db = url ? localPrisma(url, 1) : undefined;
  const pool = url ? createPool(url) : undefined;
  const legacy = pool ? new HanamaruRepository(pool, "hanamaru_api", "hanamaru_api_system") : undefined;
  const modern = db ? new PrismaRepository(db, url!, "hanamaru_api", "hanamaru_api_system") : undefined;
  afterAll(async () => { await modern?.close(); await legacy?.close(); });
  const context: RepositoryContext = { organizationId: d.organizationId, membershipId: d.membershipId, branchId: d.branchId, roles: ["assessor"], capabilities: ["visit:self"], authorizationScopes: [], requestId: randomUUID(), traceId: randomUUID() };
  it("reopens encrypted session from another client and consumes rotation once", async () => {
    const cipher = randomBytes(32).toString("hex"), id = createHash("sha256").update(randomUUID()).digest("hex");
    const first = new PrismaSessionStore(db!, cipher);
    const value = { csrf: "synthetic-csrf", attempts: 0, expiresAt: Date.now() + 60_000, credential: "Bearer synthetic-credential" };
    expect(await first.create(id, value)).toBe(true);
    const child = await promisify(execFile)(process.execPath,["--input-type=module","-e",`
      import {localPrisma,PrismaSessionStore} from ${JSON.stringify(new URL("../dist/index.js",import.meta.url).href)};
      const db=localPrisma(process.env.ALIGNMENT_DATABASE_URL);
      const store=new PrismaSessionStore(db,process.env.TEST_CIPHER);
      const row=await store.get(process.env.TEST_SESSION_ID);
      process.stdout.write(row?.value.credential==='Bearer synthetic-credential'?'restored':'missing');
      await db.$disconnect();
    `],{env:{...process.env,TEST_CIPHER:cipher,TEST_SESSION_ID:id}});
    expect(child.stdout).toBe("restored");
    const otherDb = localPrisma(url!, 1), other = new PrismaSessionStore(otherDb, cipher);
    try {
      expect((await other.get(id))?.value).toEqual(value);
      expect((await pool!.query("SELECT encrypted FROM alignment_sessions WHERE key=$1", [id])).rows[0].encrypted).not.toContain("synthetic");
      const changes = await Promise.all([first.replace(id, 0, "a".repeat(64), value), other.replace(id, 0, "b".repeat(64), value)]);
      expect(changes.filter(Boolean)).toHaveLength(1);
      expect(await other.get(id)).toBeNull();
      const next = changes[0] ? "a".repeat(64) : "b".repeat(64);
      await other.remove(next); expect(await first.get(next)).toBeNull();
    } finally { await otherDb.$disconnect(); }
  });
  it("bounds attempts across clients, rejects expiry and wrong encryption key", async () => {
    let now = Date.now(); const key = randomBytes(32).toString("hex"), id = randomBytes(32).toString("hex");
    const store = new PrismaSessionStore(db!, key, () => now);
    await store.create(id, { csrf: "synthetic", attempts: 0, expiresAt: now + 1000 });
    expect((await Promise.all(Array.from({ length: 9 }, () => store.attempt(id)))).filter(Boolean)).toHaveLength(5);
    await expect(new PrismaSessionStore(db!, randomBytes(32).toString("hex")).get(id)).rejects.toThrow();
    now += 1001; expect(await store.get(id)).toBeNull(); expect(await store.attempt(id)).toBe(false);
  });
  it("encrypts long-session credentials, rejects stale same-key CAS and expires after restart", async () => {
    let now = Date.now(); const cipher = randomBytes(32).toString("hex"), id = randomBytes(32).toString("hex");
    const first = new PrismaSessionStore(db!, cipher, () => now);
    const otherDb = localPrisma(url!, 1), second = new PrismaSessionStore(otherDb, cipher, () => now);
    const value = { csrf: "synthetic-long-csrf", attempts: 0, expiresAt: now + 8 * 3600_000, credential: "Bearer synthetic-long-access",
      sso: { issuer: "http://127.0.0.1:3381", subject: "synthetic-immutable-subject", authTime: Math.floor(now / 1000), accessExpiresAt: now + 300_000, refreshToken: "synthetic-long-refresh" } };
    try {
      expect(await first.create(id, value)).toBe(true);
      const claims = await Promise.all([first, second].map(store => store.replace(id, 0, id, { ...value, renewal: { owner: randomUUID(), expiresAt: now + 10_000 } })));
      expect(claims.filter(Boolean)).toHaveLength(1);
      const claimed = await second.get(id); expect(claimed!.version).toBe(1);
      expect(await first.replace(id, 0, id, value)).toBe(false);
      expect(await second.replace(id, claimed!.version, id, value)).toBe(true);
      const encrypted = (await pool!.query("SELECT encrypted FROM alignment_sessions WHERE key=$1", [id])).rows[0].encrypted;
      for (const field of [value.sso.refreshToken, value.sso.subject, value.credential]) expect(encrypted).not.toContain(field);
      now += 3 * 3600_000; expect((await second.get(id))?.value).toEqual(value);
      now += 5 * 3600_000; expect(await first.get(id)).toBeNull();
    } finally { await first.remove(id); await otherDb.$disconnect(); }
  });
  it("preserves bigint decimal null timestamp and existing SQL rows", async () => {
    const query = "SELECT id,lock_version,created_at,NULL::text missing,123456789012345678::bigint large,1234.56::numeric amount,'synthetic'::bytea binary,'{\"toFixed\":\"keep\",\"nested\":[{\"toFixed\":123}]}'::jsonb metadata FROM visits WHERE id=$1";
    const old = await legacy!.withContext(context, tx => tx.query(query, [d.visitId]));
    const next = await modern!.withContext(context, tx => tx.query(query, [d.visitId]));
    expect(next.rows).toEqual(old.rows);
  });
  it("does not leak organization context through a one-connection pool after rollback", async () => {
    await expect(modern!.withContext(context, async tx => { await tx.query("SELECT id FROM visits"); throw new Error("rollback"); })).rejects.toThrow("rollback");
    const other = { ...context, organizationId: "00000000-0000-4000-8000-000000009999" };
    expect((await modern!.withContext(other, tx => tx.query("SELECT id FROM visits"))).rows).toEqual([]);
    expect((await modern!.withContext(context, tx => tx.query("SELECT id FROM visits WHERE id=$1", [d.visitId]))).rowCount).toBe(1);
    const raw = await db!.$queryRawUnsafe<Array<{ context: string | null }>>("SELECT current_setting('app.organization_id',true) context");
    expect(raw[0]!.context || null).toBeNull();
  });
  it("keeps transaction rollback and immutable IDs when writing through Prisma", async () => {
    const before = await legacy!.withContext(context, tx => tx.query("SELECT notes_redacted FROM visits WHERE id=$1", [d.visitId]));
    await expect(modern!.withContext(context, async tx => { await tx.query("UPDATE visits SET notes_redacted=$2 WHERE id=$1", [d.visitId, "synthetic-rollback"]); throw new Error("rollback"); })).rejects.toThrow();
    expect((await legacy!.withContext(context, tx => tx.query("SELECT notes_redacted FROM visits WHERE id=$1", [d.visitId]))).rows).toEqual(before.rows);
  });
  it("preserves SQLSTATE for existing conflict handlers", async () => {
    await expect(modern!.withContext(context, tx => tx.query("INSERT INTO visits(organization_id,branch_id,assigned_membership_id,case_number) VALUES($1,$2,$3,'HV-000001')",[d.organizationId,d.branchId,d.membershipId]))).rejects.toMatchObject({code:"23505"});
  });
});
it("refuses remote, existing production-named DB and Cloud Run", () => {
  expect(() => localPrisma("postgresql://127.0.0.1/production")).toThrow();
  expect(() => localPrisma("postgresql://example.invalid/hanamaru_alignment_test")).toThrow();
});
