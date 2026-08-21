#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root=resolve(import.meta.dirname,"..");
const read=(path)=>readFileSync(resolve(root,path),"utf8");
const main=read("infra/terraform/main.tf");
const variables=read("infra/terraform/variables.tf");
const tfvars=read("infra/terraform/terraform.tfvars.example");
const webDockerfile=read("apps/web/Dockerfile");
const gcpPlatform=read("packages/platform/src/gcp.ts");

const failures=[];
const countEnv=(name)=>[...main.matchAll(new RegExp(`name\\s*=\\s*"${name}"`,"g"))].length;
const expectCount=(name,count)=>{const actual=countEnv(name);if(actual!==count)failures.push(`${name}: expected ${count}, got ${actual}`);};

for(const name of ["VERTEX_AI_MODEL","VERTEX_LOCATION","SPEECH_LOCATION","SPEECH_MODEL","GOOGLE_DRIVE_CLIENT_ID","GOOGLE_DRIVE_CLIENT_SECRET","GOOGLE_DRIVE_REDIRECT_URI","DATABASE_SYSTEM_ROLE","TOKEN_ENCRYPTION_KEY_VERSION"])expectCount(name,2);
expectCount("STT_INPUT_BUCKET",2);
expectCount("IDENTITY_PLATFORM_PROJECT_ID",1);
for(const name of ["NEXT_PUBLIC_API_BASE_URL","NEXT_PUBLIC_IDENTITY_PLATFORM_API_KEY","NEXT_PUBLIC_IDENTITY_PLATFORM_AUTH_DOMAIN","NEXT_PUBLIC_IDENTITY_PLATFORM_PROJECT_ID","NEXT_PUBLIC_GOOGLE_PICKER_API_KEY","NEXT_PUBLIC_GOOGLE_CLOUD_PROJECT_NUMBER"])expectCount(name,2);

for(const forbidden of ["VERTEX_MODEL","GOOGLE_OAUTH_CLIENT_ID","GOOGLE_OAUTH_CLIENT_SECRET","GOOGLE_OAUTH_REDIRECT_URI","SESSION_COOKIE","NEXT_PUBLIC_GOOGLE_CLIENT_ID","NEXT_PUBLIC_DATA_MODE","oauth_client_id"]){
  if(main.includes(forbidden))failures.push(`obsolete Terraform contract remains: ${forbidden}`);
}
if(/name\s*=\s*"GOOGLE_CLIENT_ID"/.test(main))failures.push("obsolete Terraform contract remains: GOOGLE_CLIENT_ID");

for(const service of ["aiplatform.googleapis.com","drive.googleapis.com","picker.googleapis.com","speech.googleapis.com","storage.googleapis.com"]){
  if(!main.includes(`"${service}"`))failures.push(`required service missing: ${service}`);
}

for(const corsContract of ['origin          = distinct(concat(split(",", var.cors_origins), [google_cloud_run_v2_service.stage_web.uri]))','method          = ["GET", "HEAD", "PUT"]','"x-goog-meta-sha256"']){
  if(!main.includes(corsContract))failures.push(`private bucket CORS contract missing: ${corsContract}`);
}
for(const versioningContract of ["versioning {","enabled = true","days_since_noncurrent_time = 1"]){
  if(!main.includes(versioningContract))failures.push(`private bucket version cleanup contract missing: ${versioningContract}`);
}
const noncurrentRule=main.match(/lifecycle_rule\s*\{\s*condition\s*\{[^}]*days_since_noncurrent_time\s*=\s*1[^}]*\}/s)?.[0]??"";
if(!/matches_prefix\s*=\s*\["local-validation\/"\]/.test(noncurrentRule))failures.push("noncurrent version cleanup must not apply to Legal Hold or quarantine business objects");
if(/age\s*=\s*\d+[\s\S]*matches_prefix\s*=\s*\["quarantine\/"\]/.test(main))failures.push("quarantine uploads must be deleted only by the hold-aware application cleanup");
for(const incompleteUploadContract of ['pendingUploadObjectName','`quarantine/uploads/${','"x-goog-if-generation-match":"0"']){
  if(!(main.includes(incompleteUploadContract)||gcpPlatform.includes(incompleteUploadContract)))failures.push(`incomplete upload cleanup contract missing: ${incompleteUploadContract}`);
}
if(!gcpPlatform.includes('dispatchDeadline:{seconds:600}'))failures.push("Cloud Tasks must use a bounded 600 second dispatch deadline");
if(!main.includes('timeout                          = "900s"'))failures.push("Worker Cloud Run timeout must exceed the task dispatch deadline");

for(const variable of ["web_api_base_url","google_client_id","google_cloud_project_number","google_picker_api_key","identity_platform_api_key","identity_platform_auth_domain","google_drive_redirect_uri","speech_location","speech_model","token_encryption_key_version","content_import_owner_membership_id","pilot_content_ai_enabled","allow_public_stage_web"]){
  if(!variables.includes(`variable "${variable}"`))failures.push(`Terraform variable missing: ${variable}`);
  if(!tfvars.includes(`${variable} =`))failures.push(`tfvars example missing: ${variable}`);
}

for(const stageContract of [
  'resource "google_cloud_run_v2_service" "stage_web"',
  'name                 = local.stage_web_service_name',
  'invoker_iam_disabled = var.allow_public_stage_web',
  '[google_cloud_run_v2_service.stage_web.uri]',
])if(!main.includes(stageContract))failures.push(`fixed Stage Web contract missing: ${stageContract}`);

for(const operationsContract of [
  'resource "google_cloud_scheduler_job" "operations_scan"',
  'schedule         = "*/5 * * * *"',
  '/internal/operations-scan',
  'jsonPayload.failureClass=\\"STT_HEARTBEAT_STALE\\"',
  'jsonPayload.failureClass=\\"MODEL_OUTPUT_INVALID\\"',
  'jsonPayload.failureClass=\\"EVIDENCE_INVALID\\"',
  'jsonPayload.failureClass=\\"RETRY_LIMIT_EXCEEDED\\"',
  'jsonPayload.failureClass=\\"RETRY_WAIT_OVERDUE\\"',
])if(!main.includes(operationsContract))failures.push(`operations monitoring contract missing: ${operationsContract}`);

for(const variable of ["database_read_replica_enabled","database_read_replica_tier","database_read_replica_availability_type"]){
  if(!variables.includes(`variable "${variable}"`))failures.push(`Terraform variable missing: ${variable}`);
  if(!tfvars.includes(`${variable} =`))failures.push(`tfvars example missing: ${variable}`);
}
for(const replicaContract of [
  'resource "google_sql_database_instance" "read_replica"',
  'master_instance_name = google_sql_database_instance.app.name',
  'availability_type           = var.database_read_replica_availability_type',
  'deletion_protection  = true',
  'cloudsql.googleapis.com/database/replication/replica_lag',
])if(!main.includes(replicaContract))failures.push(`read replica contract missing: ${replicaContract}`);

for(const buildArg of ["NEXT_PUBLIC_API_BASE_URL","NEXT_PUBLIC_IDENTITY_PLATFORM_API_KEY","NEXT_PUBLIC_IDENTITY_PLATFORM_AUTH_DOMAIN","NEXT_PUBLIC_IDENTITY_PLATFORM_PROJECT_ID","NEXT_PUBLIC_GOOGLE_PICKER_API_KEY","NEXT_PUBLIC_GOOGLE_CLOUD_PROJECT_NUMBER"]){
  if(!webDockerfile.includes(`ARG ${buildArg}`))failures.push(`Web build ARG missing: ${buildArg}`);
}

if(!main.includes('name  = "DATABASE_SYSTEM_ROLE"\n        value = "hanamaru_api_system"'))failures.push("API system role mismatch");
if(!main.includes('name  = "DATABASE_SYSTEM_ROLE"\n        value = "hanamaru_worker_system"'))failures.push("Worker system role mismatch");
for(const contentImportEnv of [
  'name  = "CONTENT_IMPORT_OWNER_MEMBERSHIP_ID"',
  'value = var.content_import_owner_membership_id',
  'name  = "PILOT_CONTENT_AI_ENABLED"',
  'value = tostring(var.pilot_content_ai_enabled)',
])if(!main.includes(contentImportEnv))failures.push(`content import runtime contract missing: ${contentImportEnv}`);

if(failures.length){
  for(const failure of failures)console.error(`runtime contract: ${failure}`);
  process.exit(1);
}

console.log(JSON.stringify({status:"PASS",terraformRuntimeEnv:28,webBuildArgs:6,fixedStageOrigin:true,operationsMonitoring:true,bucketCors:true,noncurrentVersionLifecycle:true,incompleteUploadLifecycle:true,obsoleteContracts:0}));
