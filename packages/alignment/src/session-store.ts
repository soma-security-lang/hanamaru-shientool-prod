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

export interface SessionKeyRing {
  activeVersion: string;
  keys: Record<string, string>;
  maxSessions?: number;
}

/** Atomic rotation/CAS and attempt counters are shared across web instances. */
export class PrismaSessionStore implements SessionStore {
  private readonly keys: Record<string, Buffer>;
  private readonly activeVersion: string;
  private readonly capacity: number;
  private readonly legacy: boolean;
  constructor(private readonly db: PrismaClient, key: string | SessionKeyRing, private readonly now = Date.now) {
    const ring = typeof key === "string" ? { activeVersion: "legacy", keys: { legacy: key }, maxSessions: 128 } : key;
    if (!ring || !/^[a-zA-Z0-9_-]{1,32}$/.test(ring.activeVersion) || !ring.keys?.[ring.activeVersion] ||
        Object.keys(ring.keys).length > 4 || Object.entries(ring.keys).some(([version, value]) =>
          !/^[a-zA-Z0-9_-]{1,32}$/.test(version) || !/^[a-f0-9]{64}$/i.test(value)) ||
        !Number.isSafeInteger(ring.maxSessions ?? 128) || (ring.maxSessions ?? 128) < 1 || (ring.maxSessions ?? 128) > 100000)
      throw new Error("SESSION_ENCRYPTION_KEY_REQUIRED");
    this.keys = Object.fromEntries(Object.entries(ring.keys).map(([version, value]) => [version, Buffer.from(value, "hex")]));
    this.activeVersion = ring.activeVersion;
    this.capacity = ring.maxSessions ?? 128;
    this.legacy = typeof key === "string";
  }
  private seal(key: string, value: StoredSession) {
    const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", this.keys[this.activeVersion]!, iv);
    cipher.setAAD(Buffer.from(this.legacy ? key : `${key}:${this.activeVersion}`));
    const data = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
    const sealed = Buffer.concat([iv, cipher.getAuthTag(), data]).toString("base64");
    return this.legacy ? sealed : `v1:${this.activeVersion}:${sealed}`;
  }
  private open(key: string, encrypted: string): StoredSession {
    const parts = encrypted.split(":");
    const versioned = parts.length === 3 && parts[0] === "v1";
    const version = versioned ? parts[1]! : "legacy";
    const secret = this.keys[version];
    if (!secret || (!versioned && parts.length !== 1)) throw new Error("SESSION_KEY_VERSION_UNAVAILABLE");
    const data = Buffer.from(versioned ? parts[2]! : encrypted, "base64");
    if (data.length < 29) throw new Error("SESSION_CIPHERTEXT_INVALID");
    const cipher = createDecipheriv("aes-256-gcm", secret, data.subarray(0, 12));
    cipher.setAAD(Buffer.from(versioned ? `${key}:${version}` : key)); cipher.setAuthTag(data.subarray(12, 28));
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
      if (await tx.alignmentSession.count() >= this.capacity) return false;
      await tx.alignmentSession.create({ data: { key, encrypted: this.seal(key, value), expiresAt: new Date(value.expiresAt) } });
      return true;
    });
  }
  async replace(key: string, version: number, nextKey: string, value: StoredSession) {
    return this.db.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key},0))`;
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
