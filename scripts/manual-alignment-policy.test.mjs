import assert from "node:assert/strict";
import test from "node:test";
import { validateManualManifest, validateDatabaseReceipt, assertReleaseRuntime, validateCloudQuality } from "./manual-alignment-policy.mjs";
const valid = () => ({ version:1, product:"hanamaru", phase:"foundation", repository:"soma-security-lang/hanamaru-shientool-prod",
  sourceSha:"a".repeat(40), baselineSha:"09d6fb1432e85a8bebd5342df078c2baba18e6ad", image:`asia-northeast1-docker.pkg.dev/monocle-503402/hanamaru-pilot/web@sha256:${"c".repeat(64)}`,
  service:"hanamaru-pilot-web", stageService:"hanamaru-alignment-stage-web", publicUrl:"https://monocle-503402.firebaseapp.com/",
  buildId:"00000000-0000-4000-8000-000000000001", buildRegion:"asia-northeast1", ciRunId:1,
  approvalScope:"attendance-stack-20261029", approvalRecord:"current user instruction", expiresAt:new Date(Date.now()+3600_000).toISOString(),
  stage:{sourceSha:"a".repeat(40),image:`asia-northeast1-docker.pkg.dev/monocle-503402/hanamaru-pilot/web@sha256:${"c".repeat(64)}`,revision:"hanamaru-alignment-stage-web-candidate",status:"PASS",failed:0,skipped:0,passed:1,evidenceHash:"d".repeat(64),evidenceFile:".artifacts/stage-receipt.json"},
  rollbackTraffic:[{revision:"hanamaru-pilot-web-baseline",percent:100}] });
test("admits only the fixed, immutable, evidenced product",()=>assert.equal(validateManualManifest(valid()).service,"hanamaru-pilot-web"));
test("audited Cloud Build is an alternative to paid Actions, not a CI bypass",()=>{
  const quality={provider:"cloud-build",buildId:"00000000-0000-4000-8000-000000000002",region:"asia-northeast1",workflowSha256:"e".repeat(64),configSha256:"f".repeat(64),approvalScope:"github-no-additional-billing-20261030"};
  const value={...valid(),ciRunId:undefined,quality};
  assert.doesNotThrow(()=>validateManualManifest(value));
  const build={id:quality.buildId,status:"SUCCESS",substitutions:{_RELEASE_SHA:value.sourceSha,_WORKFLOW_SHA256:quality.workflowSha256},steps:[{id:"workflow-verify",status:"SUCCESS"}],sourceProvenance:{resolvedStorageSource:{bucket:"reviewed-source",object:"immutable.tgz",generation:"1234"}}};
  assert.doesNotThrow(()=>validateCloudQuality(value,build,quality.workflowSha256,quality.configSha256));
  for(const mutate of[b=>b.status="FAILURE",b=>b.status="WORKING",b=>b.steps[0].status="SKIPPED",b=>b.steps[0].id="noop",b=>b.substitutions._RELEASE_SHA="b".repeat(40),b=>b.substitutions._WORKFLOW_SHA256="0".repeat(64),b=>delete b.sourceProvenance]){
    const bad=structuredClone(build);mutate(bad);assert.throws(()=>validateCloudQuality(value,bad,quality.workflowSha256,quality.configSha256));
  }
  assert.throws(()=>validateCloudQuality(value,build,"0".repeat(64),quality.configSha256));
  assert.throws(()=>validateCloudQuality(value,build,quality.workflowSha256,"0".repeat(64)));
});
for (const [name, change] of Object.entries({ wrongUrl:{publicUrl:"https://other.example.invalid"}, wrongService:{service:"soumu-web"},
  mutableImage:{image:"web:latest"}, missingCI:{ciRunId:0}, expired:{expiresAt:new Date(0).toISOString()}, wrongSource:{sourceSha:"latest"},
  missingBackup:{phase:"session"}, wrongApproval:{approvalScope:"other"} }))
  test(`rejects ${name}`,()=>assert.throws(()=>validateManualManifest({...valid(),...change})));
test("rejects failed/skipped/mismatched Stage evidence",()=>{
  for(const change of [{status:"NOT_RUN"},{failed:1},{skipped:1},{sourceSha:"f".repeat(40)},{image:"web:latest"}])
    assert.throws(()=>validateManualManifest({...valid(),stage:{...valid().stage,...change}}));
});
test("foundation cannot silently activate the local or production migration",()=>{
  const manifest=valid();assertReleaseRuntime(manifest,{spec:{template:{spec:{containers:[{env:[]}]}}}});
  assert.throws(()=>assertReleaseRuntime(manifest,{spec:{template:{spec:{containers:[{env:[{name:"HANAMARU_PRODUCTION_SESSION",value:"true"}]}]}}}}));
});
test("recovery accepts a recorded manifest after the promotion window has expired",()=>{
  const value={...valid(),expiresAt:new Date(0).toISOString()};
  assert.throws(()=>validateManualManifest(value));
  assert.equal(validateManualManifest(value,{forRollback:true}).service,"hanamaru-pilot-web");
});
const databaseReceipt = value => ({ environment:"stage",product:value.product,sourceSha:value.sourceSha,image:value.image,
  status:"PASS",passed:12,failed:0,skipped:0,migrationMode:"existing-sql-only",
  checks:Object.fromEntries(["ids","rowCounts","amounts","timestamps","nulls","audit","evidenceReferences",
    "newWriteOldRead","oldWriteNewRead","rls","runtimeRoleIsolation","restoreReadBack"].map(key=>[key,true])),
  backup:{instance:"hanamaru-pilot-postgres",id:"123456789",status:"SUCCESSFUL"},
  restore:{instance:"alignment-restore-synthetic",operationId:"synthetic-operation-id",verified:true} });
test("non-foundation release requires a private database receipt, not summary booleans",()=>{
  const value={...valid(),phase:"session",database:{compatible:true,backupStatus:"SUCCESSFUL",restoreVerified:true,evidenceHash:"d".repeat(64)}};
  assert.throws(()=>validateManualManifest(value));
  assert.doesNotThrow(()=>validateManualManifest({...value,database:{...value.database,evidenceFile:".artifacts/db.json"}}));
});
test("database receipt binds recovery and old/new writer compatibility to the exact candidate",()=>{
  const value=valid(),receipt=databaseReceipt(value);
  assert.doesNotThrow(()=>validateDatabaseReceipt(value,receipt));
  for(const change of [{sourceSha:"f".repeat(40)},{image:"web:latest"},{skipped:1},{migrationMode:"prisma-db-push"},
    {checks:{...receipt.checks,newWriteOldRead:false}},{backup:{...receipt.backup,instance:"sso-review-pg16"}},
    {restore:{...receipt.restore,instance:"hanamaru-pilot-postgres"}}])
    assert.throws(()=>validateDatabaseReceipt(value,{...receipt,...change}));
});
