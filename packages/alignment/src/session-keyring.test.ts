import { randomBytes } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { PrismaSessionStore } from "./session-store.js";

function memoryDatabase() {
  const rows = new Map<string, { key: string; encrypted: string; expiresAt: Date; version: number }>();
  const tx = { $executeRaw: async () => 1, alignmentSession: {
    findUnique: async ({ where }: { where: { key: string } }) => rows.get(where.key) ?? null,
    count: async () => rows.size,
    create: async ({ data }: { data: { key: string; encrypted: string; expiresAt: Date; version?: number } }) => {
      if (rows.has(data.key)) throw new Error("duplicate");
      rows.set(data.key, { ...data, version: data.version ?? 0 });
    },
    deleteMany: async ({ where }: { where: { key?: string; version?: number; expiresAt?: { lte?: Date; gt?: Date } } }) => {
      let count = 0;
      for (const [key, row] of rows) if ((!where.key || where.key === key) && (where.version === undefined || row.version === where.version) &&
        (!where.expiresAt?.lte || row.expiresAt <= where.expiresAt.lte) && (!where.expiresAt?.gt || row.expiresAt > where.expiresAt.gt)) {
        rows.delete(key); count++;
      }
      return { count };
    },
    update: async ({ where, data }: { where: { key: string }; data: { encrypted: string } }) => {
      const row = rows.get(where.key);
      if (!row) throw new Error("not found");
      rows.set(where.key, { ...row, ...data });
    },
  } };
  return { rows, db: { ...tx, $transaction: async <T>(fn: (client: typeof tx) => Promise<T>) => fn(tx) } as unknown as PrismaClient };
}
describe("versioned session encryption", () => {
  it("reads old sessions across rotation and seals new sessions with the active key", async () => {
    const { db, rows } = memoryDatabase();
    const first = randomBytes(32).toString("hex"), second = randomBytes(32).toString("hex");
    const value = { csrf: "synthetic", attempts: 0, expiresAt: Date.now() + 100000 };
    const old = new PrismaSessionStore(db, { activeVersion: "first", keys: { first } });
    await old.create("a".repeat(64), value);
    expect(rows.get("a".repeat(64))!.encrypted).toMatch(/^v1:first:/);
    const rotated = new PrismaSessionStore(db, { activeVersion: "second", keys: { first, second } });
    expect((await rotated.get("a".repeat(64)))!.value).toEqual(value);
    await rotated.replace("a".repeat(64), 0, "b".repeat(64), value);
    expect(rows.get("b".repeat(64))!.encrypted).toMatch(/^v1:second:/);
    await expect(old.get("b".repeat(64))).rejects.toThrow("SESSION_KEY_VERSION_UNAVAILABLE");
    const swapped = rows.get("b".repeat(64))!;
    rows.set("c".repeat(64), { ...swapped, key: "c".repeat(64) });
    await expect(rotated.get("c".repeat(64))).rejects.toThrow();
  });
  it("does not accept malformed or missing encryption keys", () => {
    const { db } = memoryDatabase();
    expect(() => new PrismaSessionStore(db, { activeVersion: "first", keys: {} })).toThrow("SESSION_ENCRYPTION_KEY_REQUIRED");
  });
});
