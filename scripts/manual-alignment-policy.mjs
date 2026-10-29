const sha = /^[a-f0-9]{40}$/;
const digest = /^[a-f0-9]{64}$/;
export const releaseTargets = {
  hanamaru: { repository: "soma-security-lang/hanamaru-shientool-prod", service: "hanamaru-pilot-web",
    baseline: "09d6fb1432e85a8bebd5342df078c2baba18e6ad",
    stage: "hanamaru-alignment-stage-web", registry: "hanamaru-pilot/web", publicUrl: "https://monocle-503402.firebaseapp.com/" },
  soumu: { repository: "soma-security-lang/soumu-tool-prd", service: "soumu-web",
    baseline: "204a4791a7f1abf7d726a0e89a58e816d6156cd4",
    stage: "soumu-alignment-stage-web", registry: "soumu/web", publicUrl: "https://soumu-web-tpqjzqidwa-an.a.run.app/login" },
};
const require = (ok, message) => { if (!ok) throw new Error(message); };
export function releaseBuildSource(build) {
  const values = [build?.substitutions?._RELEASE_SHA, build?.substitutions?._GIT_SHA].filter(value => value !== undefined);
  require(values.length > 0 && values.every(value => sha.test(value) && value === values[0]), "Conflicting or missing immutable build source");
  return values[0];
}
export function assertImageRuntimeConfiguration(manifest, build, service) {
  if (manifest.product !== "soumu") return;
  const values = Object.fromEntries((service.spec?.template?.spec?.containers?.[0]?.env ?? []).map(entry => [entry.name, entry.value]));
  const client = build.substitutions?._GOOGLE_CLIENT_ID;
  require(typeof client === "string" && /^[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com$/.test(client) &&
    client === values.GOOGLE_CLIENT_ID && values.SOUMU_AUTH_MODE === "app",
  "Built Google client does not match the preserved production authentication configuration");
}
export function validateManualManifest(value, { forRollback = false } = {}) {
  require(value?.version === 1 && Object.hasOwn(releaseTargets, value?.product ?? ""), "Unsupported release manifest");
  const target = releaseTargets[value.product];
  require(sha.test(value.sourceSha ?? "") && sha.test(value.baselineSha ?? ""), "Immutable source and baseline are required");
  require(value.baselineSha === target.baseline, "Baseline differs from the reviewed product");
  require(["foundation", "session", "native", "sso"].includes(value.phase), "Explicit release phase required");
  require(value.repository === target.repository && value.publicUrl === target.publicUrl &&
    value.service === target.service && value.stageService === target.stage, "Release target differs from the fixed product");
  const expected = `asia-northeast1-docker.pkg.dev/monocle-503402/${target.registry}@sha256:`;
  require(typeof value.image === "string" && value.image.startsWith(expected) && digest.test(value.image.slice(expected.length)), "A product-scoped immutable image is required");
  require(/^[a-f0-9-]{36}$/.test(value.buildId ?? "") && ["asia-northeast1", "global"].includes(value.buildRegion), "Cloud Build evidence required");
  if (value.quality?.provider === "cloud-build") {
    require(/^[a-f0-9-]{36}$/.test(value.quality.buildId ?? "") && value.quality.region === "asia-northeast1" &&
      digest.test(value.quality.workflowSha256 ?? "") && digest.test(value.quality.configSha256 ?? "") &&
      typeof value.quality.sourceStorage?.bucket === "string" && value.quality.sourceStorage.bucket.length > 10 &&
      typeof value.quality.sourceStorage?.object === "string" && value.quality.sourceStorage.object.startsWith("source/") &&
      /^[1-9][0-9]*$/.test(String(value.quality.sourceStorage?.generation ?? "")) &&
      value.quality.approvalScope === "github-no-additional-billing-20261030", "Pinned audited Cloud Build quality evidence required");
  } else require(!value.quality && Number.isSafeInteger(value.ciRunId) && value.ciRunId > 0, "A completed CI run is required");
  require(value.approvalScope === "attendance-stack-20261029" && typeof value.approvalRecord === "string" && value.approvalRecord.length >= 10, "Task-specific approval record required");
  require(sha.test(value.stage?.sourceSha ?? "") && value.stage.sourceSha === value.sourceSha &&
    value.stage.image === value.image && value.stage.status === "PASS" && value.stage.failed === 0 &&
    value.stage.skipped === 0 && Number.isSafeInteger(value.stage.passed) && value.stage.passed > 0 &&
    digest.test(value.stage.evidenceHash ?? "") && typeof value.stage.evidenceFile === "string" &&
    value.stage.evidenceFile.startsWith(".artifacts/"), "Matching, completed Stage evidence required");
  if (value.phase !== "foundation") require(value.database?.compatible === true &&
    value.database.backupStatus === "SUCCESSFUL" && value.database.restoreVerified === true &&
    digest.test(value.database.evidenceHash ?? "") && typeof value.database.evidenceFile === "string" &&
    value.database.evidenceFile.startsWith(".artifacts/"), "Database compatibility and recovery evidence required");
  require(Array.isArray(value.rollbackTraffic) && value.rollbackTraffic.length > 0 &&
    value.rollbackTraffic.every(row => new RegExp(`^${target.service}-[a-z0-9-]+$`).test(row.revision) && Number.isInteger(row.percent) && row.percent > 0) &&
    value.rollbackTraffic.reduce((sum, row) => sum + row.percent, 0) === 100, "Exact prior traffic required");
  require(Number.isFinite(Date.parse(value.expiresAt)) && (forRollback || (Date.parse(value.expiresAt) > Date.now() &&
    Date.parse(value.expiresAt) - Date.now() <= 24 * 3600_000)), "Release evidence must be current");
  return target;
}

/** Only the separately reviewed no-additional-GitHub-billing pipeline qualifies.
 * The config hash binds the actual executed commands, not a summary PASS flag.
 * The operator reviews that immutable config against the source workflow.
 */
export function validateCloudQuality(manifest, build, actualWorkflowHash, actualConfigHash) {
  const quality = manifest.quality;
  const source = releaseBuildSource(build);
  const requiredSteps = manifest.product === "hanamaru" ? ["workflow-verify"] :
    ["quality-db-infra-private-checkout-cross-product", "original-sso-container-runtime"];
  require(quality?.provider === "cloud-build" && build.id === quality.buildId && build.status === "SUCCESS" &&
    source === manifest.sourceSha && build.substitutions?._WORKFLOW_SHA256 === quality.workflowSha256 &&
    quality.workflowSha256 === actualWorkflowHash && quality.configSha256 === actualConfigHash &&
    Array.isArray(build.steps) && build.steps.length > 0 && build.steps.every(step => step.status === "SUCCESS") &&
    requiredSteps.every(id => build.steps.some(step => step.id === id)) &&
    build.sourceProvenance?.resolvedStorageSource?.bucket === quality.sourceStorage.bucket &&
    build.sourceProvenance.resolvedStorageSource.object === quality.sourceStorage.object &&
    String(build.sourceProvenance.resolvedStorageSource.generation) === String(quality.sourceStorage.generation),
  "Exact workflow/source/config Cloud Build quality has not passed");
}

export function validateDatabaseReceipt(manifest, receipt) {
  const checks = ["ids", "rowCounts", "amounts", "timestamps", "nulls", "audit", "evidenceReferences",
    "newWriteOldRead", "oldWriteNewRead", "rls", "runtimeRoleIsolation", "restoreReadBack"];
  const instance = manifest.product === "hanamaru" ? "hanamaru-pilot-postgres" : "soumu";
  require(receipt?.environment === "stage" && receipt.product === manifest.product &&
    receipt.sourceSha === manifest.sourceSha && receipt.image === manifest.image &&
    receipt.status === "PASS" && receipt.failed === 0 && receipt.skipped === 0 &&
    Number.isSafeInteger(receipt.passed) && receipt.passed > 0 &&
    receipt.migrationMode === "existing-sql-only" && checks.every(key => receipt.checks?.[key] === true) &&
    receipt.backup?.instance === instance && /^[1-9][0-9]*$/.test(String(receipt.backup?.id ?? "")) &&
    receipt.backup.status === "SUCCESSFUL" && receipt.restore?.verified === true &&
    typeof receipt.restore.instance === "string" && receipt.restore.instance.startsWith("alignment-restore-") &&
    receipt.restore.instance !== instance && typeof receipt.restore.operationId === "string" &&
    receipt.restore.operationId.length >= 10, "Database receipt does not prove exact-candidate compatibility and isolated recovery");
}

export function assertReleaseRuntime(manifest, service) {
  const values = Object.fromEntries((service.spec?.template?.spec?.containers?.[0]?.env ?? []).map(entry => [entry.name, entry.value]));
  if (manifest.product === "hanamaru") {
    if (manifest.phase === "foundation") require(values.HANAMARU_PRODUCTION_SESSION !== "true" &&
      values.HANAMARU_PRODUCTION_NATIVE_API !== "true" && values.HANAMARU_SERVER_SSO !== "true", "Foundation cannot activate authentication or API migration");
    else require(values.HANAMARU_PRODUCTION_SESSION === "true", "Production session is not configured");
    if (["native", "sso"].includes(manifest.phase)) require(values.HANAMARU_PRODUCTION_NATIVE_API === "true", "Native writer is not configured");
    if (manifest.phase === "sso") require(values.HANAMARU_SERVER_SSO === "true", "SSO is not configured");
  } else if (manifest.phase === "foundation") require(values.SOUMU_DATABASE_DRIVER !== "prisma" && !values.SSO_ISSUER,
    "Foundation cannot activate Prisma or SSO");
  if (manifest.phase !== "foundation") {
    const secrets = service.spec?.template?.spec?.containers?.[0]?.env ?? [];
    for (const name of manifest.product === "hanamaru" ? ["HANAMARU_SESSION_DATABASE_URL", "HANAMARU_SESSION_KEYS_JSON"] : ["DATABASE_URL"])
      require(secrets.some(entry => entry.name === name && /^[1-9][0-9]*$/.test(entry.valueFrom?.secretKeyRef?.key ?? "")), "Migrated secrets must use pinned numeric versions");
  }
}
