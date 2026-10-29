import assert from "node:assert/strict";
import test from "node:test";
import { validateManualManifest, assertReleaseRuntime } from "./manual-alignment-policy.mjs";
const valid = () => ({ version:1, product:"hanamaru", phase:"foundation", repository:"soma-security-lang/hanamaru-shientool-prod",
  sourceSha:"a".repeat(40), baselineSha:"09d6fb1432e85a8bebd5342df078c2baba18e6ad", image:`asia-northeast1-docker.pkg.dev/monocle-503402/hanamaru-pilot/web@sha256:${"c".repeat(64)}`,
  service:"hanamaru-pilot-web", stageService:"hanamaru-alignment-stage-web", publicUrl:"https://monocle-503402.firebaseapp.com/",
  buildId:"00000000-0000-4000-8000-000000000001", buildRegion:"asia-northeast1", ciRunId:1,
  approvalScope:"attendance-stack-20261029", approvalRecord:"current user instruction", expiresAt:new Date(Date.now()+3600_000).toISOString(),
  stage:{sourceSha:"a".repeat(40),image:`asia-northeast1-docker.pkg.dev/monocle-503402/hanamaru-pilot/web@sha256:${"c".repeat(64)}`,revision:"hanamaru-alignment-stage-web-candidate",status:"PASS",failed:0,skipped:0,passed:1,evidenceHash:"d".repeat(64),evidenceFile:".artifacts/stage-receipt.json"},
  rollbackTraffic:[{revision:"hanamaru-pilot-web-baseline",percent:100}] });
test("admits only the fixed, immutable, evidenced product",()=>assert.equal(validateManualManifest(valid()).service,"hanamaru-pilot-web"));
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
