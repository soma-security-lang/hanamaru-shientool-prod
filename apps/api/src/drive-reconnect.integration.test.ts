import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  HanamaruRepository,
  createPool,
  developmentIds,
} from "@hanamaru/database";
import { createLocalProviders } from "@hanamaru/platform";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";

const databaseUrl = process.env.DATABASE_URL;

describe.skipIf(!databaseUrl)("Google Drive reconnection", () => {
  let app: FastifyInstance;
  let repository: HanamaruRepository;
  const revoked: string[] = [];
  let failOldRevocation = false;

  beforeAll(async () => {
    const providers = createLocalProviders();
    providers.drive.exchangeAuthorizationCode = async (code) => ({
      providerAccountId: "anonymous-drive-account",
      refreshToken: `refresh-${code}`,
      accessToken: `access-${code}`,
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      scopes: ["https://www.googleapis.com/auth/drive.file"],
    });
    providers.drive.revoke = vi.fn(async (token: string) => {
      revoked.push(token);
      if (token === "refresh-second" && failOldRevocation)
        throw new Error("PROVIDER_TEMPORARY: revoke unavailable");
    });
    repository = new HanamaruRepository(createPool(databaseUrl!));
    await repository.system(
      "UPDATE external_connections SET revoked_at=now() WHERE organization_id=$1 AND membership_id=$2 AND provider='google_drive' AND revoked_at IS NULL",
      [developmentIds.organizationId, developmentIds.managerMembershipId],
    );
    app = await buildApp({
      repository: new HanamaruRepository(createPool(databaseUrl!)),
      providers,
      config: {
        ...loadConfig({ NODE_ENV: "test", ALLOW_DEV_AUTH: "true" }),
        port: 0,
      },
    });
  });

  afterAll(async () => {
    await app?.close();
    await repository?.close();
  });

  const connect = (code: string) =>
    app.inject({
      method: "POST",
      url: "/api/v1/drive-connections",
      headers: {
        "x-dev-role": "manager",
        "idempotency-key": randomUUID(),
      },
      payload: { code },
    });

  it("revokes the previous provider credential before activating its replacement", async () => {
    const first = await connect("first");
    expect(first.statusCode).toBe(201);
    const second = await connect("second");
    expect(second.statusCode).toBe(201);
    expect(revoked).toContain("refresh-first");
    const active = await repository.system<{ id: string }>(
      "SELECT id FROM external_connections WHERE organization_id=$1 AND membership_id=$2 AND provider='google_drive' AND revoked_at IS NULL",
      [developmentIds.organizationId, developmentIds.managerMembershipId],
    );
    expect(active.rows).toEqual([{ id: second.json().id }]);
  });

  it("does not activate another credential when old-token revocation is uncertain", async () => {
    failOldRevocation = true;
    const rejected = await connect("third");
    expect(rejected.statusCode).toBe(503);
    expect(revoked).toContain("refresh-second");
    expect(revoked.filter((token) => token === "refresh-third").length).toBe(1);
    const active = await repository.system<{ count: number }>(
      "SELECT count(*)::int count FROM external_connections WHERE organization_id=$1 AND membership_id=$2 AND provider='google_drive' AND revoked_at IS NULL",
      [developmentIds.organizationId, developmentIds.managerMembershipId],
    );
    expect(active.rows[0]?.count).toBe(1);
  });
});
