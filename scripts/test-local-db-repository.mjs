#!/usr/bin/env node

import { HanamaruRepository, createPool, developmentIds } from "../packages/database/dist/index.js";

const apiUrl = process.env.TEST_API_DATABASE_URL;
const workerUrl = process.env.TEST_WORKER_DATABASE_URL;
if (!apiUrl || !workerUrl) process.exit(2);

const context = {
  requestId: "runtime-role-test",
  traceId: "runtime-role-test",
  organizationId: developmentIds.organizationId,
  membershipId: developmentIds.membershipId,
  branchId: developmentIds.branchId,
  roles: ["assessor"],
  capabilities: ["visit:self", "content:read"],
};

const api = new HanamaruRepository(createPool(apiUrl), "hanamaru_api", "hanamaru_api_system");
const worker = new HanamaruRepository(createPool(workerUrl), "hanamaru_worker", "hanamaru_worker_system");
let stage = "api-system-role";

try {
  const apiSystem = await api.system("SELECT current_role role");
  if (apiSystem.rows[0]?.role !== "hanamaru_api_system") throw new Error("api-system-role");
  await api.system("SELECT count(*)::int count FROM organizations");
  stage = "api-context-role";
  const apiContext = await api.withContext(context, (tx) => tx.query("SELECT current_role role"));
  if (apiContext.rows[0]?.role !== "hanamaru_api") throw new Error("api-context-role");
  await api.withContext(context, (tx) => tx.query("SELECT count(*)::int count FROM visits"));
  stage = "api-deletion-fence-privileges";
  await api.withContext(context, (tx) => tx.query("DELETE FROM visit_deletion_fences WHERE organization_id=$1 AND false", [developmentIds.organizationId]));

  stage = "api-cross-privilege";
  let apiDenied = false;
  try { await api.system("SELECT count(*) FROM jobs"); } catch { apiDenied = true; }
  if (!apiDenied) throw new Error("api-system-overprivileged");

  stage = "worker-system-role";
  const workerSystem = await worker.system("SELECT current_role role");
  if (workerSystem.rows[0]?.role !== "hanamaru_worker_system") throw new Error("worker-system-role");
  await worker.system("SELECT count(*)::int count FROM jobs");
  stage = "worker-context-role";
  const workerContext = await worker.withContext({ ...context, roles: [], capabilities: [] }, (tx) => tx.query("SELECT current_role role"));
  if (workerContext.rows[0]?.role !== "hanamaru_worker") throw new Error("worker-context-role");
  await worker.withContext({ ...context, roles: [], capabilities: [] }, (tx) => tx.query("SELECT count(*)::int count FROM jobs"));

  stage = "worker-retention-privileges";
  await worker.withContext({ ...context, roles: [], capabilities: [] }, async (tx) => {
    stage = "worker-apply-retention";
    await tx.query("SELECT apply_retention_policies($1,false)", [developmentIds.organizationId]);
    stage = "worker-update-extraction";
    await tx.query("UPDATE document_extractions SET status=status WHERE organization_id=$1 AND false", [developmentIds.organizationId]);
    stage = "worker-delete-fields";
    await tx.query("DELETE FROM visit_field_values WHERE organization_id=$1 AND false", [developmentIds.organizationId]);
    stage = "worker-update-preparation";
    await tx.query("UPDATE visit_preparations SET status=status WHERE organization_id=$1 AND false", [developmentIds.organizationId]);
    stage = "worker-update-drive";
    await tx.query("UPDATE drive_imports SET status=status WHERE organization_id=$1 AND false", [developmentIds.organizationId]);
    stage = "worker-audit-insert";
    await tx.audit("runtime-role.retention", "runtime_role_test", null, "allowed");
  });
  stage = "worker-audit-purge";
  await worker.system("SELECT purge_expired_audit_events($1,1)", [developmentIds.organizationId]);

  stage = "worker-audit-immutability";
  let auditMutationDenied = false;
  try {
    await worker.withContext({ ...context, roles: [], capabilities: [] }, async (tx) => {
      await tx.query("SELECT set_config('app.audit_retention_operation','on',true)");
      await tx.query("UPDATE audit_events SET result=result WHERE organization_id=$1 AND false", [developmentIds.organizationId]);
    });
  } catch { auditMutationDenied = true; }
  if (!auditMutationDenied) throw new Error("worker-audit-mutation-allowed");

  stage = "worker-cross-privilege";
  let workerDenied = false;
  try { await worker.system("SELECT count(*) FROM sessions"); } catch { workerDenied = true; }
  if (!workerDenied) throw new Error("worker-system-overprivileged");

  console.log(JSON.stringify({ status: "PASS", apiContextRole: true, apiSystemRole: true, workerContextRole: true, workerSystemRole: true, retentionPrivileges: true, auditMutationDenied: true, crossPrivilegeDenied: true }));
} catch {
  console.error(`DB repository role test failed at ${stage}. Query values are intentionally not printed.`);
  process.exitCode = 1;
} finally {
  await Promise.all([api.close(), worker.close()]);
}
