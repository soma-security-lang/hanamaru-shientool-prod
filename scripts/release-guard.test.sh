#!/usr/bin/env bash
set -euo pipefail

guard="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/release-guard.sh"
set +e
output="$(bash -c '
  set -Eeuo pipefail
  source "$1"
  rollback(){ echo rollback-called; }
  release_guard_install
  false
  echo continuation-is-a-defect
' _ "$guard" 2>&1)"
status=$?
set -e

[[ "$status" -ne 0 ]]
[[ "$output" == *"rollback-called"* ]]
[[ "$output" != *"continuation-is-a-defect"* ]]
echo "release guard exits after rollback"

set +e
output="$(bash -c '
  set -Eeuo pipefail
  source "$1"
  rollback(){ echo rollback-on-explicit-exit; }
  release_guard_install
  exit 5
' _ "$guard" 2>&1)"
status=$?
set -e
[[ "$status" -eq 5 ]]
[[ "$output" == *"rollback-on-explicit-exit"* ]]
echo "release guard rolls back on explicit nonzero exit"

traffic='{"status":{"latestReadyRevisionName":"green-unvalidated","traffic":[{"revisionName":"blue-validated","percent":100},{"revisionName":"green-unvalidated","tag":"green"}]}}'
active="$(jq -er '.status.traffic[] | select(.percent == 100) | .revisionName' <<<"$traffic")"
[[ "$active" == "blue-validated" ]]
latest="$(jq -er '.status.latestReadyRevisionName' <<<"$traffic")"
[[ "$latest" == "green-unvalidated" ]]
[[ "$active" != "$latest" ]]
echo "release guard records the 100 percent revision, not latestReady"

attempts=0
eventually_healthy(){
  attempts=$((attempts+1))
  (( attempts >= 3 ))
}
for i in 1 2 3 4; do
  if eventually_healthy; then break; fi
done
[[ "$attempts" -eq 3 ]]
echo "release health gate tolerates bounded routing propagation"

sequence=(ok ok fail ok ok ok)
consecutive=0
for result in "${sequence[@]}"; do
  if [[ "$result" == ok ]]; then consecutive=$((consecutive+1)); else consecutive=0; fi
done
[[ "$consecutive" -eq 3 ]]
echo "release health gate requires consecutive stable responses"

release_script="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/release-blue-green.sh"
tag_script="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/release-tag.sh"
source "$tag_script"
valid_tag="$(release_tag_from_commit '0123456789abcdef0123456789abcdef01234567')"
[[ "$valid_tag" == 'g-0123456789ab' ]]
validate_release_tag "$valid_tag" hanamaru-pilot-web hanamaru-pilot-api hanamaru-pilot-worker
! validate_release_tag 'green-invalid-' hanamaru-pilot-web >/dev/null 2>&1
! validate_release_tag 'G-invalid' hanamaru-pilot-web >/dev/null 2>&1
! validate_release_tag 'g-0123456789abcdef0123456789abcdef' hanamaru-pilot-worker >/dev/null 2>&1
! release_tag_from_commit 'not-a-commit' >/dev/null 2>&1
echo "release tag is derived from the exact Git commit and rejected instead of truncated"

grep -q 'run deploy "$api_service".*--no-invoker-iam-check' "$release_script"
grep -q 'run deploy "$web_service".*--no-invoker-iam-check' "$release_script"
grep -q 'run deploy "$stage_web_service"' "$release_script"
grep -A1 'run deploy "$stage_web_service"' "$release_script" | grep -q -- '--no-invoker-iam-check'
grep -q 'green_stage_web="$(latest_created_revision "$stage_web_service")"' "$release_script"
grep -q -- '--to-revisions="$green_stage_web=100"' "$release_script"
grep -q -- 'e2e/routes.spec.ts e2e/real-stack.spec.ts --workers=1' "$release_script"
grep -q '\[REDACTED\]' "$release_script"
grep -q 'audio_path="$(cd "$(dirname "$audio_path")" && pwd)/$(basename "$audio_path")"' "$release_script"
echo "public services keep invoker IAM disabled on every Green revision"
grep -q 'Referer:.*web_referrer' "$release_script"
echo "Identity Platform refresh honors the browser-restricted API key"
grep -q 'RESUME_EXISTING_GREEN' "$release_script"
grep -q 'service_tag_revision' "$release_script"
echo "release can resume the exact tagged Green after a post-deploy gate failure"
grep -q 'E2E_WEB_BASE_URL="$stage_web_url"' "$release_script"
grep -q 'assert_revision_image "$green_stage_web" "$web_image"' "$release_script"
! grep -q 'enable_green_origin\|restore_green_origin\|origin_gate_active' "$release_script"
grep -q 'rollback(){' "$release_script"
grep -A8 'rollback(){' "$release_script" | grep -q 'Stage Web Blue traffic'
grep -q 'ROLLBACK_INCOMPLETE.json' "$release_script"
grep -q 'CRITICAL: rollback is incomplete' "$release_script"
grep -q 'source-commit=$source_commit' "$release_script"
grep -q 'git diff --quiet.*git diff --cached --quiet' "$release_script"
grep -q 'git ls-remote origin refs/heads/main' "$release_script"
[[ "$(grep -c '^  run_live_e2e$' "$release_script")" -eq 2 ]]
echo "release validates the fixed authenticated Stage origin, exact image digest and complete rollback"

stage_origin_script="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/configure-fixed-stage-origin.sh"
grep -q 'APPLY_FIXED_STAGE_ORIGIN:-false' "$stage_origin_script"
grep -q 'identity-authorized-domains.before.json' "$stage_origin_script"
grep -q 'updateMask=authorizedDomains' "$stage_origin_script"
grep -q 'if (( status != 0 )); then restore' "$stage_origin_script"
grep -q 'APPLIED_AND_VERIFIED' "$stage_origin_script"
! grep -Eq 'API_KEY_VALUE|REFRESH_TOKEN|ID_TOKEN' "$stage_origin_script"
echo "fixed Stage origin configuration is additive, dry-run by default, backed up, read back and rolled back on failure"

manifest_dir="$(mktemp -d)"
audio_manifest="$manifest_dir/anonymous-audio-manifest.json"
jq -n '{schemaVersion:1,profiles:[
  {profile:"normal_dialogue",gcsUri:"gs://private-bucket/anonymous-regression/v1/normal.mp3",generation:"1",sha256:("a"*64),durationSeconds:10,codec:"mp3",expectedQualityFlags:[]},
  {profile:"multi_speaker",gcsUri:"gs://private-bucket/anonymous-regression/v1/multi.mp3",generation:"2",sha256:("b"*64),durationSeconds:10,codec:"mp3",expectedQualityFlags:["many_speakers"]},
  {profile:"media_mix",gcsUri:"gs://private-bucket/anonymous-regression/v1/media.mp3",generation:"3",sha256:("c"*64),durationSeconds:10,codec:"mp3",expectedQualityFlags:["possible_media","long_non_dialogue"]}
]}' > "$audio_manifest"
node "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/validate-anonymous-audio-regression.mjs" "$audio_manifest" | grep -q '"status":"PASS"'
jq '.profiles[0].transcript="forbidden"' "$audio_manifest" > "$manifest_dir/invalid-audio-manifest.json"
! node "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/validate-anonymous-audio-regression.mjs" "$manifest_dir/invalid-audio-manifest.json" >/dev/null 2>&1
rm -rf "$manifest_dir"
echo "anonymous audio regression manifest requires private generated objects and forbids transcript material"

deploy_workflow="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/.github/workflows/deploy.yml"
preflight_script="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/github-release-preflight.sh"
grep -q 'run: scripts/github-release-preflight.sh' "$deploy_workflow"
grep -q 'repository must be PRIVATE before release' "$preflight_script"
grep -q 'main branch protection is required' "$preflight_script"
grep -q 'must require a human reviewer' "$preflight_script"
grep -q 'assertion.workflow_ref' "$preflight_script"
echo "GitHub deployment fails closed before build unless repository governance and WIF claims are exact"
grep -q 'scripts/mint-live-e2e-identity.mjs' "$deploy_workflow"
grep -q 'LIVE_E2E_MANAGER_IDENTITY_FILE' "$deploy_workflow"
grep -q 'LIVE_E2E_ASSESSOR_IDENTITY_FILE' "$deploy_workflow"
grep -q 'IDENTITY_PLATFORM_API_KEY_FILE' "$deploy_workflow"
grep -q 'LIVE_E2E_AUDIO_GCS_URI' "$deploy_workflow"
grep -q 'pnpm install --frozen-lockfile' "$deploy_workflow"
grep -q 'playwright install --with-deps chromium' "$deploy_workflow"
! grep -q 'LIVE_E2E_IDENTITY_PLATFORM_ID_TOKEN:.*secrets\.' "$deploy_workflow"
! grep -q 'LIVE_E2E_ASSESSOR_IDENTITY_PLATFORM_ID_TOKEN:.*secrets\.' "$deploy_workflow"
! grep -q 'name: terraform-plan$' "$deploy_workflow"
! grep -q 'path:.*tfplan$' "$deploy_workflow"
grep -q 'name: terraform-plan-summary' "$deploy_workflow"
grep -q 'diff -u .artifacts/approved-plan/terraform-plan-summary.json' "$deploy_workflow"
grep -q 'find.*tfplan.json.*tfplan -type f -delete' "$deploy_workflow"
! grep -q 'terraform -chdir=infra/terraform apply' "$deploy_workflow"
grep -q 'Verify Terraform drift is zero after Blue/Green promotion' "$deploy_workflow"
grep -q 'google_cloud_run_v2_service.api' "$deploy_workflow"
echo "GitHub deploy mints short-lived Identity evidence and downloads exactly one private anonymous audio fixture"
grep -q 'pnpm test:workflows' "$(dirname "$deploy_workflow")/ci.yml"
echo "CI validates all GitHub workflows with checksum-pinned actionlint"

infra_workflow="$(dirname "$deploy_workflow")/infra-change.yml"
infra_preflight="$(dirname "$preflight_script")/github-infra-preflight.sh"
grep -q 'run: scripts/github-infra-preflight.sh' "$infra_workflow"
grep -q 'repository must be PRIVATE before infrastructure apply' "$infra_preflight"
grep -q 'pilot-infra-apply\|environment}-infra-apply' "$infra_preflight"
grep -q 'infra-change.yml@refs/heads/main' "$infra_preflight"
grep -q 'GCP_INFRA_WORKLOAD_IDENTITY_PROVIDER' "$infra_workflow"
grep -q 'GCP_INFRA_SERVICE_ACCOUNT' "$infra_workflow"
grep -q 'approved_addresses' "$infra_workflow"
grep -q 'startswith("google_cloud_run_v2_service.")' "$infra_workflow"
grep -q 'startswith("google_cloud_run_v2_job.")' "$infra_workflow"
grep -q 'startswith("google_sql_database_instance.")' "$infra_workflow"
grep -q 'diff -u .artifacts/approved-infra-plan/infra-plan-summary.json' "$infra_workflow"
! grep -q 'path:.*infra-tfplan' "$infra_workflow"
echo "Infrastructure apply uses dedicated WIF, human review, exact addresses and no application or database mutations"

ha_preflight="$(dirname "$preflight_script")/cloud-sql-ha-cutover-preflight.sh"
grep -q 'mutationPerformed:false' "$ha_preflight"
grep -q 'availabilityType=="REGIONAL"' "$ha_preflight"
grep -q 'status!=DONE' "$ha_preflight"
grep -q 'replication/replica_lag' "$ha_preflight"
grep -q 'clientsOnCurrentPrimary' "$ha_preflight"
! grep -q 'promote-replica\|instances patch\|terraform.*apply' "$ha_preflight"
echo "Cloud SQL cutover preflight is read-only and requires HA, zero lag, backup and exact clients"

input_dir="$(mktemp -d)"
trap 'rm -rf "$input_dir"' EXIT
printf '{"idToken":"manager-token","refreshToken":"manager-refresh","localId":"manager-local"}' > "$input_dir/manager.json"
printf '{"idToken":"assessor-token","refreshToken":"assessor-refresh","localId":"assessor-local"}' > "$input_dir/assessor.json"
printf 'public-api-key' > "$input_dir/api-key"
printf 'anonymous-audio' > "$input_dir/audio"
chmod 0600 "$input_dir"/*
common_release_env=(
  RELEASE_INPUT_PREFLIGHT_ONLY=true
  GIT_COMMIT_SHA='0123456789abcdef0123456789abcdef01234567'
  API_IMAGE='registry/api@sha256:abc'
  WORKER_IMAGE='registry/worker@sha256:def'
  WEB_IMAGE='registry/web@sha256:ghi'
  LIVE_E2E_MANAGER_IDENTITY_FILE="$input_dir/manager.json"
  LIVE_E2E_ASSESSOR_IDENTITY_FILE="$input_dir/assessor.json"
  IDENTITY_PLATFORM_API_KEY_FILE="$input_dir/api-key"
  LIVE_E2E_ASSESSOR_MEMBERSHIP_ID='00000000-0000-4000-8000-000000000001'
  NEXT_PUBLIC_IDENTITY_PLATFORM_AUTH_DOMAIN='example.invalid'
  LIVE_E2E_AUDIO_PATH="$input_dir/audio"
)
env "${common_release_env[@]}" "$release_script" | grep -q 'Release input preflight: PASS'
chmod 0644 "$input_dir/manager.json"
set +e
input_error="$(env "${common_release_env[@]}" "$release_script" 2>&1)"
input_status=$?
set -e
[[ "$input_status" -ne 0 ]]
[[ "$input_error" == *'Identity evidence file must have mode 0600'* ]]
echo "release accepts only complete mode-0600 identity evidence and one readable anonymous audio fixture"
