import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { PrismaClient } from "@prisma/client";

export interface StoredSession {
  csrf: string; expiresAt: number; attempts: number;
  credential?: string; membershipId?: string; organizationId?: string;
  sso?: { issuer: string; subject: string; authTime: number; accessExpiresAt: number; refreshToken: string };
  renewal?: { owner: string; expiresAt: number };
  flow?: { owner: string; state: string; verifier: string; nonce: string; returnTo: string };
}
export interface SessionStore {
  get(key: string): Promise<{ value: StoredSession; version: number } | null>;
  create(key: string, value: StoredSession): Promise<boolean>;
  replace(key: string, version: number, nextKey: string, value: StoredSession): Promise<boolean>;
  remove(key: string): Promise<void>;
  attempt(key: string): Promise<boolean>;
}

/** Atomic rotation/CAS and attempt counters are shared across web instances. */
export class PrismaSessionStore implements SessionStore {
  private readonly encryptionKey: Buffer;
  constructor(private readonly db: PrismaClient, key: string, private readonly now = Date.now) {
    if (!/^[a-f0-9]{64}$/i.test(key)) throw new Error("SESSION_ENCRYPTION_KEY_REQUIRED");
    this.encryptionKey = Buffer.from(key, "hex");
  }
  private seal(key: string, value: StoredSession) {
    const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", this.encryptionKey, iv);
    cipher.setAAD(Buffer.from(key));
    const data = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), data]).toString("base64");
  }
  private open(key: string, encrypted: string): StoredSession {
    const data = Buffer.from(encrypted, "base64"), cipher = createDecipheriv("aes-256-gcm", this.encryptionKey, data.subarray(0, 12));
    cipher.setAAD(Buffer.from(key)); cipher.setAuthTag(data.subarray(12, 28));
    return JSON.parse(Buffer.concat([cipher.update(data.subarray(28)), cipher.final()]).toString("utf8")) as StoredSession;
  }
  async get(key: string) {
    const row = await this.db.alignmentSession.findUnique({ where: { key } });
    if (!row || row.expiresAt.getTime() <= this.now()) return null;
    return { value: this.open(key, row.encrypted), version: row.version };
  }
  async create(key: string, value: StoredSession) {
    return this.db.$transaction(async tx => {
      // Global admission lock also bounds concurrent unauthenticated bootstraps.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(73310001)`;
      await tx.alignmentSession.deleteMany({ where: { expiresAt: { lte: new Date(this.now()) } } });
      if (await tx.alignmentSession.count() >= 128) return false;
      await tx.alignmentSession.create({ data: { key, encrypted: this.seal(key, value), expiresAt: new Date(value.expiresAt) } });
      return true;
    });
  }
  async replace(key: string, version: number, nextKey: string, value: StoredSession) {
    return this.db.$transaction(async tx => {
      const removed = await tx.alignmentSession.deleteMany({ where: { key, version, expiresAt: { gt: new Date(this.now()) } } });
      if (removed.count !== 1) return false;
      await tx.alignmentSession.create({ data: { key: nextKey, version: version + 1, encrypted: this.seal(nextKey, value), expiresAt: new Date(value.expiresAt) } });
      return true;
    });
  }
  async remove(key: string) { await this.db.alignmentSession.deleteMany({ where: { key } }); }
  async attempt(key: string) {
    return this.db.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key},0))`;
      const row = await tx.alignmentSession.findUnique({ where: { key } });
      if (!row || row.expiresAt.getTime() <= this.now()) return false;
      const value = this.open(key, row.encrypted);
      if (value.attempts >= 5) return false;
      value.attempts++;
      await tx.alignmentSession.update({ where: { key }, data: { encrypted: this.seal(key, value) } });
      return true;
    });
  }
}
