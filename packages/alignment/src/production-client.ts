import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

export interface ProductionDatabaseConfig {
  url: string;
  connectionName: string;
  databaseName: string;
  max?: number;
  sessionOnly?: boolean;
}

/** Production is a separate, pinned Cloud SQL path; the local gate stays intact. */
export function assertProductionDatabase(config: ProductionDatabaseConfig, env: Readonly<Record<string, string | undefined>> = process.env): void {
  let url: URL;
  try { url = new URL(config.url); } catch { throw new Error("PRODUCTION_DATABASE_CONFIGURATION_REQUIRED"); }
  if (env.NODE_ENV !== "production" || !/^hanamaru-(?:(?:pilot|alignment-stage)-(?:web|api|worker)|pilot-stage-web)$/.test(env.K_SERVICE ?? "") ||
      env.PROVIDER_MODE !== "gcp" || env.ALLOW_DEV_AUTH === "true" ||
      !/^monocle-503402:asia-northeast1:(?:hanamaru-pilot-postgres|sso-review-pg16)$/.test(config.connectionName) ||
      !/^[a-z][a-z0-9_]{1,62}$/.test(config.databaseName) ||
      !["postgres:", "postgresql:"].includes(url.protocol) || !url.username || !url.password || url.hash ||
      decodeURIComponent(url.pathname) !== `/${config.databaseName}` ||
      url.searchParams.get("host") !== `/cloudsql/${config.connectionName}` ||
      [...url.searchParams.keys()].some(key => !["host", "sslmode"].includes(key)) ||
      !Number.isInteger(config.max ?? 3) || (config.max ?? 3) < 1 || (config.max ?? 3) > 5 ||
      (env.K_SERVICE?.includes("stage") && config.connectionName.endsWith(":hanamaru-pilot-postgres"))) {
    throw new Error("PRODUCTION_DATABASE_CONFIGURATION_REQUIRED");
  }
}

export function productionPrisma(config: ProductionDatabaseConfig) {
  assertProductionDatabase(config);
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: config.url, max: config.max ?? 3,
    options: `-c timezone=UTC${config.sessionOnly ? " -c role=hanamaru_session" : ""}`,
    connectionTimeoutMillis: 10_000, idleTimeoutMillis: 30_000 }), log: [] });
}
