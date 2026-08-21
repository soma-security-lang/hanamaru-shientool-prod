import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  HanamaruRepository,
  createPool,
  developmentIds,
} from "@hanamaru/database";
import { createLocalProviders } from "@hanamaru/platform";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import type { FastifyInstance } from "fastify";

const databaseUrl = process.env.DATABASE_URL;
const sha = (value: string) =>
  createHash("sha256").update(value).digest("hex");

describe.skipIf(!databaseUrl)("branch-scoped manager authorization", () => {
  let app: FastifyInstance;
  let repository: HanamaruRepository;
  const branchId = randomUUID();
  const userId = randomUUID();
  const membershipId = randomUUID();
  const visitId = randomUUID();
  const branchJobId = randomUUID();
  const foreignJobId = randomUUID();
  const ownEntityForeignRequesterJobId = randomUUID();
  const foreignEntityOwnRequesterJobId = randomUUID();
  const identitySubject = `subject-${userId}`;
  const identityEmail = `manager-${userId}@example.invalid`;

  beforeAll(async () => {
    repository = new HanamaruRepository(createPool(databaseUrl!));
    await repository.system(
      "INSERT INTO branches(id,organization_id,branch_key,name) VALUES($1,$2,$3,'権限試験店')",
      [branchId, developmentIds.organizationId, `scope-${branchId}`],
    );
    await repository.system(
      "INSERT INTO users(id,provider_subject_hash,email_hash,email_masked,display_name) VALUES($1,$2,$3,'b***@example.invalid','店舗管理者')",
      [userId, sha(identitySubject), sha(identityEmail)],
    );
    await repository.system(
      "INSERT INTO memberships(id,organization_id,user_id,branch_id) VALUES($1,$2,$3,$4)",
      [membershipId, developmentIds.organizationId, userId, branchId],
    );
    await repository.system(
      "INSERT INTO role_assignments(organization_id,membership_id,role_id,scope_type,scope_id,assigned_by_membership_id) SELECT $1,$2,id,'branch',$3,$4 FROM roles WHERE role_code='manager'",
      [
        developmentIds.organizationId,
        membershipId,
        branchId,
        developmentIds.managerMembershipId,
      ],
    );
    await repository.system(
      "INSERT INTO visits(id,organization_id,branch_id,assigned_membership_id,case_number,status) VALUES($1,$2,$3,$4,$5,'ready')",
      [
        visitId,
        developmentIds.organizationId,
        branchId,
        membershipId,
        `SCOPE-${visitId}`,
      ],
    );
    for (const [id, entityId, requester] of [
      [branchJobId, visitId, membershipId],
      [ownEntityForeignRequesterJobId, visitId, developmentIds.managerMembershipId],
      [foreignEntityOwnRequesterJobId, developmentIds.visitId, membershipId],
      [
        foreignJobId,
        developmentIds.visitId,
        developmentIds.managerMembershipId,
      ],
    ])
      await repository.system(
        "INSERT INTO jobs(id,organization_id,job_type,entity_type,entity_id,idempotency_key,input_hash,input_redacted,requested_by_membership_id) VALUES($1,$2,'review','visit',$3,$4,$5,'{}',$6)",
        [
          id,
          developmentIds.organizationId,
          entityId,
          `scope-${id}`,
          sha(String(id)),
          requester,
        ],
      );
    app = await buildApp({
      repository: new HanamaruRepository(createPool(databaseUrl!)),
      providers: createLocalProviders(),
      config: { ...loadConfig({ NODE_ENV: "test" }), port: 0 },
      identityTokenVerifier: async () => {
        const now = Math.floor(Date.now() / 1000);
        return {
          sub: identitySubject,
          email: identityEmail,
          email_verified: true,
          auth_time: now - 60,
          iat: now - 30,
          exp: now + 3_600,
        };
      },
    });
  });

  afterAll(async () => {
    await app?.close();
    await repository?.close();
  });

  const sessionHeaders = () => ({ authorization: "Bearer identity-test-token" });
  const mutationHeaders = () => ({
    ...sessionHeaders(),
    "idempotency-key": randomUUID(),
  });

  it("confines visits, users, jobs and deletion to the assigned branch", async () => {
    const own = await app.inject({
      method: "GET",
      url: `/api/v1/visits/${visitId}`,
      headers: sessionHeaders(),
    });
    expect(own.statusCode).toBe(200);
    const foreign = await app.inject({
      method: "GET",
      url: `/api/v1/visits/${developmentIds.visitId}`,
      headers: sessionHeaders(),
    });
    expect(foreign.statusCode).toBe(404);

    const users = await app.inject({
      method: "GET",
      url: "/api/v1/admin/users",
      headers: sessionHeaders(),
    });
    expect(users.statusCode).toBe(200);
    expect(users.json().items.map((item: { id: string }) => item.id)).toContain(
      membershipId,
    );
    expect(
      users.json().items.map((item: { id: string }) => item.id),
    ).not.toContain(developmentIds.membershipId);

    const updateForeign = await app.inject({
      method: "PATCH",
      url: `/api/v1/admin/users/${developmentIds.membershipId}`,
      headers: mutationHeaders(),
      payload: { status: "suspended", expectedLockVersion: 1 },
    });
    expect(updateForeign.statusCode).toBe(404);

    const organizationRoleInvite = await app.inject({
      method: "POST",
      url: "/api/v1/admin/users",
      headers: mutationHeaders(),
      payload: {
        displayName: "禁止された組織承認者",
        email: `branch-approver-${randomUUID()}@example.invalid`,
        roles: ["content_approver"],
      },
    });
    expect(organizationRoleInvite.statusCode).toBe(403);

    const jobs = await app.inject({
      method: "GET",
      url: "/api/v1/admin/jobs",
      headers: sessionHeaders(),
    });
    expect(jobs.statusCode).toBe(200);
    expect(jobs.json().items.map((item: { id: string }) => item.id)).toContain(
      branchJobId,
    );
    expect(jobs.json().items.map((item: { id: string }) => item.id)).toContain(
      ownEntityForeignRequesterJobId,
    );
    expect(
      jobs.json().items.map((item: { id: string }) => item.id),
    ).not.toContain(foreignJobId);
    expect(
      jobs.json().items.map((item: { id: string }) => item.id),
    ).not.toContain(foreignEntityOwnRequesterJobId);

    const cancelForeign = await app.inject({
      method: "POST",
      url: `/api/v1/admin/jobs/${foreignJobId}/cancel`,
      headers: mutationHeaders(),
      payload: { reason: "店舗権限の境界確認" },
    });
    expect(cancelForeign.statusCode).toBe(404);

    const deleteForeign = await app.inject({
      method: "POST",
      url: `/api/v1/visits/${developmentIds.visitId}/deletion-requests`,
      headers: mutationHeaders(),
      payload: { requestType: "admin", reasonCode: "scope_test" },
    });
    expect(deleteForeign.statusCode).toBe(404);
  });
});
