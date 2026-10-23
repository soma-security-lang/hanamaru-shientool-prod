import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

export function localPrisma(url: string, max = 3) {
  const target = new URL(url);
  if (process.env.K_SERVICE !== undefined || !["postgres:", "postgresql:"].includes(target.protocol) ||
      target.hostname !== "127.0.0.1" || !target.pathname.startsWith("/hanamaru_alignment_") || target.search)
    throw new Error("ALIGNMENT_LOCAL_DATABASE_REQUIRED");
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: url, max, options: "-c timezone=UTC" }), log: [] });
}
