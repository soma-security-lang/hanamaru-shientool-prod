import { describe, expect, it } from "vitest";
import { assertProductionDatabase } from "./production-client.js";

const config = { url: "postgresql://service:synthetic@localhost/hanamaru?host=%2Fcloudsql%2Fmonocle-503402%3Aasia-northeast1%3Ahanamaru-pilot-postgres",
  connectionName: "monocle-503402:asia-northeast1:hanamaru-pilot-postgres", databaseName: "hanamaru", max: 3 };
const env = { NODE_ENV: "production", K_SERVICE: "hanamaru-pilot-web", PROVIDER_MODE: "gcp", ALLOW_DEV_AUTH: "false" };
describe("production Cloud SQL boundary", () => {
  it("accepts the pinned private socket and production service", () => expect(() => assertProductionDatabase(config, env)).not.toThrow());
  it.each([
    { url: "postgresql://service:synthetic@127.0.0.1/hanamaru" }, { databaseName: "other" },
    { connectionName: "other:asia-northeast1:hanamaru-pilot-postgres" }, { max: 10 },
    { url: `${config.url}&options=anything` },
  ])("rejects an unapproved database or connection: %j", change => expect(() => assertProductionDatabase({ ...config, ...change }, env)).toThrow("PRODUCTION_DATABASE_CONFIGURATION_REQUIRED"));
  it.each([{ NODE_ENV: "development" }, { K_SERVICE: "unrelated" }, { PROVIDER_MODE: "local" }, { ALLOW_DEV_AUTH: "true" },
    { K_SERVICE: "hanamaru-alignment-stage-web" }])("fails closed for runtime drift: %j", change =>
    expect(() => assertProductionDatabase(config, { ...env, ...change })).toThrow("PRODUCTION_DATABASE_CONFIGURATION_REQUIRED"));
});
