#!/usr/bin/env bash
set -Eeuo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$script_dir/release-guard.sh"
source "$script_dir/release-tag.sh"

project_id="${GCP_PROJECT_ID:-monocle-503402}"
region="${GCP_REGION:-asia-northeast1}"
release_id="${RELEASE_ID:-$(date -u +%Y%m%dT%H%M%SZ)}"
build_id="${BUILD_ID:-manual}"
source_commit="${GIT_COMMIT_SHA:-$(git rev-parse HEAD)}"
latest_migration_file="$(find packages/database/migrations -maxdepth 1 -type f -name '*.sql' -print | sort | tail -n 1)"
[[ -n "$latest_migration_file" ]] || { echo "migration manifest is empty" >&2; exit 2; }
latest_migration_version="${latest_migration_file##*/}"
latest_migration_version="${latest_migration_version%.sql}"
migration_version="${MIGRATION_VERSION:-$latest_migration_version}"
[[ "$migration_version" == "$latest_migration_version" ]] || {
  echo "MIGRATION_VERSION must match the filesystem manifest: expected=$latest_migration_version" >&2
  exit 2
}
observe_seconds="${OBSERVE_SECONDS:-900}"
observe_half_seconds="${OBSERVE_HALF_SECONDS:-1800}"
resume_existing="${RESUME_EXISTING_GREEN:-false}"
api_image="${API_IMAGE:?API_IMAGE must be a digest-pinned Artifact Registry URI}"
worker_image="${WORKER_IMAGE:?WORKER_IMAGE must be a digest-pinned Artifact Registry URI}"
web_image="${WEB_IMAGE:?WEB_IMAGE must be a digest-pinned Artifact Registry URI}"
identity_file_mode(){
  stat -c '%a' "$1" 2>/dev/null || stat -f '%Lp' "$1"
}
read_identity_file(){
  local file="$1"
  local key="$2"
  [[ -r "$file" ]] || { echo "Identity evidence file is not readable" >&2; exit 2; }
  [[ "$(identity_file_mode "$file")" == 600 ]] || { echo "Identity evidence file must have mode 0600" >&2; exit 2; }
  jq -er --arg key "$key" '.[$key] | select(type == "string" and length > 0)' "$file"
}
manager_identity_file="${LIVE_E2E_MANAGER_IDENTITY_FILE:-}"
assessor_identity_file="${LIVE_E2E_ASSESSOR_IDENTITY_FILE:-}"
if [[ -n "$manager_identity_file" ]]; then
  manager_token="$(read_identity_file "$manager_identity_file" idToken)"
  manager_refresh_token="$(read_identity_file "$manager_identity_file" refreshToken)"
  manager_local_id="$(read_identity_file "$manager_identity_file" localId)"
else
  manager_token="${LIVE_E2E_IDENTITY_PLATFORM_ID_TOKEN:?LIVE_E2E_IDENTITY_PLATFORM_ID_TOKEN is required}"
  manager_refresh_token="${LIVE_E2E_IDENTITY_PLATFORM_REFRESH_TOKEN:?LIVE_E2E_IDENTITY_PLATFORM_REFRESH_TOKEN is required}"
  manager_local_id="${LIVE_E2E_IDENTITY_PLATFORM_LOCAL_ID:?LIVE_E2E_IDENTITY_PLATFORM_LOCAL_ID is required}"
fi
if [[ -n "$assessor_identity_file" ]]; then
  assessor_token="$(read_identity_file "$assessor_identity_file" idToken)"
  assessor_refresh_token="$(read_identity_file "$assessor_identity_file" refreshToken)"
  assessor_local_id="$(read_identity_file "$assessor_identity_file" localId)"
else
  assessor_token="${LIVE_E2E_ASSESSOR_IDENTITY_PLATFORM_ID_TOKEN:?LIVE_E2E_ASSESSOR_IDENTITY_PLATFORM_ID_TOKEN is required}"
  assessor_refresh_token="${LIVE_E2E_ASSESSOR_IDENTITY_PLATFORM_REFRESH_TOKEN:?LIVE_E2E_ASSESSOR_IDENTITY_PLATFORM_REFRESH_TOKEN is required}"
  assessor_local_id="${LIVE_E2E_ASSESSOR_IDENTITY_PLATFORM_LOCAL_ID:?LIVE_E2E_ASSESSOR_IDENTITY_PLATFORM_LOCAL_ID is required}"
fi
assessor_membership_id="${LIVE_E2E_ASSESSOR_MEMBERSHIP_ID:?LIVE_E2E_ASSESSOR_MEMBERSHIP_ID is required}"
identity_api_key_file="${IDENTITY_PLATFORM_API_KEY_FILE:-}"
if [[ -n "$identity_api_key_file" ]]; then
  [[ -r "$identity_api_key_file" ]] || { echo "Identity API key file is not readable" >&2; exit 2; }
  [[ "$(identity_file_mode "$identity_api_key_file")" == 600 ]] || { echo "Identity API key file must have mode 0600" >&2; exit 2; }
  identity_api_key="$(tr -d '\r\n' < "$identity_api_key_file")"
  [[ -n "$identity_api_key" ]] || { echo "Identity API key file is empty" >&2; exit 2; }
else
  identity_api_key="${NEXT_PUBLIC_IDENTITY_PLATFORM_API_KEY:?NEXT_PUBLIC_IDENTITY_PLATFORM_API_KEY is required}"
fi
identity_auth_domain="${NEXT_PUBLIC_IDENTITY_PLATFORM_AUTH_DOMAIN:?NEXT_PUBLIC_IDENTITY_PLATFORM_AUTH_DOMAIN is required}"
audio_path="${LIVE_E2E_AUDIO_PATH:?LIVE_E2E_AUDIO_PATH is required}"
[[ -r "$audio_path" && -s "$audio_path" ]] || { echo "LIVE_E2E_AUDIO_PATH must be a readable non-empty anonymous fixture" >&2; exit 2; }
web_service="${WEB_SERVICE:-hanamaru-pilot-web}"
stage_web_service="${STAGE_WEB_SERVICE:-hanamaru-pilot-stage-web}"
api_service="${API_SERVICE:-hanamaru-pilot-api}"
worker_service="${WORKER_SERVICE:-hanamaru-pilot-worker}"
[[ "$project_id" == monocle-503402 && "$region" == asia-northeast1 ]] || {
  echo "release target must be monocle-503402 / asia-northeast1" >&2
  exit 2
}
[[ "$web_service" == hanamaru-pilot-web && "$stage_web_service" == hanamaru-pilot-stage-web && "$api_service" == hanamaru-pilot-api && "$worker_service" == hanamaru-pilot-worker ]] || {
  echo "release may target only the approved hanamaru-pilot services" >&2
  exit 2
}
tag="$(release_tag_from_commit "$source_commit")"
validate_release_tag "$tag" "$web_service" "$api_service" "$worker_service"
build_label="$(printf '%s' "$build_id" | tr '[:upper:]_' '[:lower:]-' | cut -c1-63)"
release_label="$(printf '%s' "$release_id" | tr '[:upper:]_' '[:lower:]-' | cut -c1-63)"
release_labels="release-id=$release_label,build-id=$build_label,migration-version=$migration_version,source-commit=$source_commit"

for image in "$api_image" "$worker_image" "$web_image"; do
  [[ "$image" == *"@sha256:"* ]] || { echo "digest-pinned image required" >&2; exit 2; }
done

if [[ "${RELEASE_INPUT_PREFLIGHT_ONLY:-false}" == true ]]; then
  echo "Release input preflight: PASS"
  exit 0
fi

[[ "$(git rev-parse HEAD)" == "$source_commit" ]] || {
  echo "GIT_COMMIT_SHA must match the checked-out HEAD" >&2
  exit 2
}
git diff --quiet && git diff --cached --quiet && [[ -z "$(git ls-files --others --exclude-standard)" ]] || {
  echo "release requires a clean tracked and untracked Git worktree" >&2
  exit 2
}
remote_main_commit="$(git ls-remote origin refs/heads/main | awk 'NR==1{print $1}')"
[[ "$remote_main_commit" == "$source_commit" ]] || {
  echo "release requires origin/main to equal GIT_COMMIT_SHA" >&2
  exit 2
}

gcloud_cmd=(gcloud --configuration=default --project="$project_id")
traffic_revision(){
  "${gcloud_cmd[@]}" run services describe "$1" --region="$region" --format=json |
    jq -er '.status.traffic[] | select(.percent == 100) | .revisionName'
}
latest_revision(){
  "${gcloud_cmd[@]}" run services describe "$1" --region="$region" --format='value(status.latestReadyRevisionName)'
}
latest_created_revision(){
  "${gcloud_cmd[@]}" run services describe "$1" --region="$region" --format='value(status.latestCreatedRevisionName)'
}
service_tag_url(){ "${gcloud_cmd[@]}" run services describe "$1" --region="$region" --format=json | jq -er --arg tag "$tag" '.status.traffic[]|select(.tag==$tag)|.url'; }
service_tag_revision(){ "${gcloud_cmd[@]}" run services describe "$1" --region="$region" --format=json | jq -er --arg tag "$tag" '.status.traffic[]|select(.tag==$tag)|.revisionName'; }
revision_image(){ "${gcloud_cmd[@]}" run revisions describe "$1" --region="$region" --format=json | jq -er '.status.imageDigest // .spec.containers[0].image'; }
assert_revision_image(){
  local revision="$1"
  local expected_image="$2"
  local actual expected_digest
  actual="$(revision_image "$revision")"
  expected_digest="${expected_image##*@}"
  [[ "$actual" == *"$expected_digest"* ]] || {
    echo "revision image digest mismatch" >&2
    return 1
  }
}
refresh_identity(){
  local refresh_token="$1"
  local web_referrer="$2"
  curl --fail --silent --show-error -X POST \
    -H "content-type: application/x-www-form-urlencoded" \
    -H "Referer: $web_referrer" \
    --data-urlencode "grant_type=refresh_token" \
    --data-urlencode "refresh_token=$refresh_token" \
    "https://securetoken.googleapis.com/v1/token?key=${identity_api_key}" | jq -er '.id_token'
}
wait_http(){
  local url="$1"
  local attempts="${2:-60}"
  local delay="${3:-5}"
  local required_consecutive="${4:-3}"
  local consecutive=0
  local i
  for ((i=1; i<=attempts; i++)); do
    if curl --fail --silent --show-error "$url" >/dev/null; then
      consecutive=$((consecutive+1))
      if (( consecutive >= required_consecutive )); then
        return 0
      fi
    else
      consecutive=0
    fi
    (( i < attempts )) && sleep "$delay"
  done
  echo "health check did not converge: $url" >&2
  return 1
}
wait_revision(){
  local url="$1"
  local expected="$2"
  local attempts="${3:-90}"
  local delay="${4:-5}"
  local required_consecutive="${5:-6}"
  local consecutive=0
  local body revision i
  for ((i=1; i<=attempts; i++)); do
    body="$(curl --fail --silent --show-error "$url" 2>/dev/null || true)"
    revision="$(jq -r '.revision // empty' <<<"$body" 2>/dev/null || true)"
    if [[ "$revision" == "$expected" ]]; then
      consecutive=$((consecutive+1))
      if (( consecutive >= required_consecutive )); then
        return 0
      fi
    else
      consecutive=0
    fi
    (( i < attempts )) && sleep "$delay"
  done
  echo "revision did not become stable: expected=$expected url=$url" >&2
  return 1
}

main_web_url=""
main_api_url=""

blue_web="$(traffic_revision "$web_service")"
blue_stage_web="$(traffic_revision "$stage_web_service")"
blue_api="$(traffic_revision "$api_service")"
blue_worker="$(traffic_revision "$worker_service")"
state_dir=".artifacts/releases/$release_id"
mkdir -p "$state_dir"
chmod 700 "$state_dir"
jq -n --arg release "$release_id" --arg commit "$source_commit" --arg web "$blue_web" --arg stageWeb "$blue_stage_web" --arg api "$blue_api" --arg worker "$blue_worker" \
  '{release:$release,sourceCommit:$commit,blue:{web:$web,stageWeb:$stageWeb,api:$api,worker:$worker}}' > "$state_dir/blue.json"

rollback_retry(){
  local description="$1"
  shift
  local attempt
  for attempt in 1 2 3; do
    if "$@"; then
      return 0
    fi
    echo "rollback step failed: $description (attempt $attempt/3)" >&2
    (( attempt < 3 )) && sleep 5
  done
  return 1
}

rollback(){
  local failed=0
  set +e
  rollback_retry "Stage Web Blue traffic" "${gcloud_cmd[@]}" run services update-traffic "$stage_web_service" --region="$region" --to-revisions="$blue_stage_web=100" --quiet || failed=1
  rollback_retry "API Blue traffic" "${gcloud_cmd[@]}" run services update-traffic "$api_service" --region="$region" --to-revisions="$blue_api=100" --quiet || failed=1
  rollback_retry "Web Blue traffic" "${gcloud_cmd[@]}" run services update-traffic "$web_service" --region="$region" --to-revisions="$blue_web=100" --quiet || failed=1
  rollback_retry "Worker Blue traffic" "${gcloud_cmd[@]}" run services update-traffic "$worker_service" --region="$region" --to-revisions="$blue_worker=100" --quiet || failed=1
  if (( failed != 0 )); then
    jq -n --arg release "$release_id" --arg recordedAt "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
      '{release:$release,status:"ROLLBACK_INCOMPLETE",recordedAt:$recordedAt}' > "$state_dir/ROLLBACK_INCOMPLETE.json"
    chmod 600 "$state_dir/ROLLBACK_INCOMPLETE.json"
    echo "CRITICAL: rollback is incomplete; manual recovery is required" >&2
    return 1
  fi
  return 0
}
release_guard_install

if [[ "$resume_existing" == true ]]; then
  [[ -f "$state_dir/state.json" ]] || { echo "resume state was not found: $state_dir/state.json" >&2; exit 3; }
  backup_id="$(jq -er '.backupId' "$state_dir/state.json")"
  green_worker="$(service_tag_revision "$worker_service")"
  green_api="$(service_tag_revision "$api_service")"
  green_web="$(service_tag_revision "$web_service")"
else
  "${gcloud_cmd[@]}" sql backups create --instance=hanamaru-pilot-postgres --description="pre-release-$release_id" --quiet
  backup_id="$("${gcloud_cmd[@]}" sql backups list --instance=hanamaru-pilot-postgres --filter="description=pre-release-$release_id AND status=SUCCESSFUL" --sort-by=~startTime --limit=1 --format='value(id)')"
  [[ -n "$backup_id" ]] || { echo "successful pre-release backup was not found" >&2; exit 3; }
  jq --arg backup "$backup_id" '. + {backupId:$backup}' "$state_dir/blue.json" > "$state_dir/state.json"

  "${gcloud_cmd[@]}" run deploy "$worker_service" --region="$region" --image="$worker_image" --labels="$release_labels" --no-traffic --tag="$tag" --quiet
  "${gcloud_cmd[@]}" run deploy "$api_service" --region="$region" --image="$api_image" --labels="$release_labels" --no-invoker-iam-check --no-traffic --tag="$tag" --quiet
  "${gcloud_cmd[@]}" run deploy "$web_service" --region="$region" --image="$web_image" --labels="$release_labels" --no-invoker-iam-check --no-traffic --tag="$tag" --quiet
  green_worker="$(latest_revision "$worker_service")"
  green_api="$(latest_revision "$api_service")"
  green_web="$(latest_revision "$web_service")"
fi
api_green_url="$(service_tag_url "$api_service")"
web_green_url="$(service_tag_url "$web_service")"
main_web_url="$("${gcloud_cmd[@]}" run services describe "$web_service" --region="$region" --format='value(status.url)')"
wait_http "$api_green_url/health/ready"
wait_http "$web_green_url/login"

if [[ "$resume_existing" != true ]]; then
  "${gcloud_cmd[@]}" run jobs update hanamaru-pilot-database-migrate --region="$region" --image="$api_image" --command=node --args=apps/api/node_modules/@hanamaru/database/dist/cli-migrate.js --quiet
  "${gcloud_cmd[@]}" run jobs execute hanamaru-pilot-database-migrate --region="$region" --wait --quiet
  "${gcloud_cmd[@]}" run jobs update hanamaru-pilot-database-provision-roles --region="$region" --image="$api_image" --command=node --args=apps/api/node_modules/@hanamaru/database/dist/cli-provision-runtime-roles.js --quiet
  "${gcloud_cmd[@]}" run jobs execute hanamaru-pilot-database-provision-roles --region="$region" --wait --quiet
  "${gcloud_cmd[@]}" run jobs update hanamaru-pilot-database-bootstrap --region="$region" --image="$api_image" --command=node --args=apps/api/node_modules/@hanamaru/database/dist/cli-bootstrap-production.js,--apply --quiet
  "${gcloud_cmd[@]}" run jobs execute hanamaru-pilot-database-bootstrap --region="$region" --wait --quiet
  "${gcloud_cmd[@]}" run jobs update hanamaru-pilot-content-import --region="$region" --image="$api_image" --command=node --args=apps/api/node_modules/@hanamaru/database/dist/cli-import-content.js --update-env-vars=POC_CONTENT_PATH=/app/apps/web/src/mocks/poc-content.json --quiet
  "${gcloud_cmd[@]}" run jobs execute hanamaru-pilot-content-import --region="$region" --wait --quiet
fi

assert_revision_image "$green_worker" "$worker_image"
assert_revision_image "$green_api" "$api_image"
assert_revision_image "$green_web" "$web_image"

"${gcloud_cmd[@]}" run services update-traffic "$worker_service" --region="$region" --to-revisions="$green_worker=100" --quiet
for percent in 1 10 50 100; do
  blue=$((100-percent))
  target="$green_api=$percent"
  (( blue > 0 )) && target="$target,$blue_api=$blue"
  "${gcloud_cmd[@]}" run services update-traffic "$api_service" --region="$region" --to-revisions="$target" --quiet
  wait_http "$("${gcloud_cmd[@]}" run services describe "$api_service" --region="$region" --format='value(status.url)')/health/ready"
  if (( percent == 50 )); then
    sleep "$observe_half_seconds"
  elif (( percent != 100 )); then
    sleep "$observe_seconds"
  fi
done

main_api_url="$("${gcloud_cmd[@]}" run services describe "$api_service" --region="$region" --format='value(status.url)')"
wait_revision "$main_api_url/health/ready" "$green_api"

# The fixed Stage Web is the only browser-authenticated Green origin. It must
# already be registered by `configure-fixed-stage-origin.sh`; no release may
# temporarily widen Identity, API-key or Storage origin boundaries.
"${gcloud_cmd[@]}" run deploy "$stage_web_service" --region="$region" --image="$web_image" \
  --labels="$release_labels" --no-invoker-iam-check --quiet
green_stage_web="$(latest_created_revision "$stage_web_service")"
[[ -n "$green_stage_web" && "$green_stage_web" != "$blue_stage_web" ]] || {
  echo "fixed Stage did not create a new revision" >&2
  exit 5
}
assert_revision_image "$green_stage_web" "$web_image"
"${gcloud_cmd[@]}" run services update-traffic "$stage_web_service" --region="$region" \
  --to-revisions="$green_stage_web=100" --quiet
stage_web_url="$("${gcloud_cmd[@]}" run services describe "$stage_web_service" --region="$region" --format='value(status.url)')"
wait_http "$stage_web_url/login" 90 5 3

manager_token="$(refresh_identity "$manager_refresh_token" "$stage_web_url/")"
assessor_token="$(refresh_identity "$assessor_refresh_token" "$stage_web_url/")"
role_status="$(curl --silent --show-error -o "$state_dir/assessor-role.json" -w '%{http_code}' -X PUT \
  -H "Authorization: Bearer $manager_token" -H 'content-type: application/json' \
  -H "Idempotency-Key: ${release_id}-assessor-role" --data '{"roles":["assessor"]}' \
  "$main_api_url/api/v1/admin/users/$assessor_membership_id/roles")"
[[ "$role_status" == 200 ]] || { echo "assessor role preparation failed" >&2; exit 5; }
run_live_e2e(){
  # Remote acceptance is intentionally serial: the workstation/network path is
  # part of the gate and must not be saturated by parallel browser contexts.
  # Playwright can include request headers in failures, so redact bearer values
  # before anything reaches release evidence or the terminal.
  pnpm --filter @hanamaru/web exec playwright test \
    e2e/routes.spec.ts e2e/real-stack.spec.ts --workers=1 2>&1 |
    sed -E 's/(authorization: Bearer )[A-Za-z0-9._-]+/\1[REDACTED]/g'
}
REAL_STACK_E2E=1 E2E_REMOTE=1 \
  E2E_WEB_BASE_URL="$stage_web_url" E2E_API_BASE_URL="$main_api_url/api/v1" \
  NEXT_PUBLIC_IDENTITY_PLATFORM_API_KEY="$identity_api_key" \
  NEXT_PUBLIC_IDENTITY_PLATFORM_AUTH_DOMAIN="$identity_auth_domain" \
  LIVE_E2E_IDENTITY_PLATFORM_ID_TOKEN="$manager_token" \
  LIVE_E2E_IDENTITY_PLATFORM_REFRESH_TOKEN="$manager_refresh_token" \
  LIVE_E2E_IDENTITY_PLATFORM_LOCAL_ID="$manager_local_id" \
  LIVE_E2E_ASSESSOR_GOOGLE_ID_TOKEN="$assessor_token" \
  LIVE_E2E_ASSESSOR_IDENTITY_PLATFORM_ID_TOKEN="$assessor_token" \
  LIVE_E2E_ASSESSOR_IDENTITY_PLATFORM_REFRESH_TOKEN="$assessor_refresh_token" \
  LIVE_E2E_ASSESSOR_IDENTITY_PLATFORM_LOCAL_ID="$assessor_local_id" \
  LIVE_E2E_AUDIO_PATH="$audio_path" \
  run_live_e2e

for percent in 1 10 50 100; do
  blue=$((100-percent))
  target="$green_web=$percent"
  (( blue > 0 )) && target="$target,$blue_web=$blue"
  "${gcloud_cmd[@]}" run services update-traffic "$web_service" --region="$region" --to-revisions="$target" --quiet
  wait_http "$("${gcloud_cmd[@]}" run services describe "$web_service" --region="$region" --format='value(status.url)')/login"
  if (( percent == 50 )); then
    sleep "$observe_half_seconds"
  elif (( percent != 100 )); then
    sleep "$observe_seconds"
  fi
done

manager_token="$(refresh_identity "$manager_refresh_token" "$main_web_url/")"
assessor_token="$(refresh_identity "$assessor_refresh_token" "$main_web_url/")"
REAL_STACK_E2E=1 E2E_REMOTE=1 \
  E2E_WEB_BASE_URL="$main_web_url" E2E_API_BASE_URL="$main_api_url/api/v1" \
  NEXT_PUBLIC_IDENTITY_PLATFORM_API_KEY="$identity_api_key" \
  NEXT_PUBLIC_IDENTITY_PLATFORM_AUTH_DOMAIN="$identity_auth_domain" \
  LIVE_E2E_IDENTITY_PLATFORM_ID_TOKEN="$manager_token" \
  LIVE_E2E_IDENTITY_PLATFORM_REFRESH_TOKEN="$manager_refresh_token" \
  LIVE_E2E_IDENTITY_PLATFORM_LOCAL_ID="$manager_local_id" \
  LIVE_E2E_ASSESSOR_GOOGLE_ID_TOKEN="$assessor_token" \
  LIVE_E2E_ASSESSOR_IDENTITY_PLATFORM_ID_TOKEN="$assessor_token" \
  LIVE_E2E_ASSESSOR_IDENTITY_PLATFORM_REFRESH_TOKEN="$assessor_refresh_token" \
  LIVE_E2E_ASSESSOR_IDENTITY_PLATFORM_LOCAL_ID="$assessor_local_id" \
  LIVE_E2E_AUDIO_PATH="$audio_path" \
  run_live_e2e

release_guard_clear
jq -n \
  --arg release "$release_id" --arg commit "$source_commit" --arg build "$build_id" --arg migration "$migration_version" \
  --arg web "$green_web" --arg webImage "$web_image" --arg stageWeb "$green_stage_web" \
  --arg api "$green_api" --arg apiImage "$api_image" --arg worker "$green_worker" --arg workerImage "$worker_image" \
  --arg backup "$backup_id" \
  '{release:$release,sourceCommit:$commit,buildId:$build,migrationVersion:$migration,backupId:$backup,green:{web:{revision:$web,image:$webImage},stageWeb:{revision:$stageWeb,image:$webImage},api:{revision:$api,image:$apiImage},worker:{revision:$worker,image:$workerImage}},traffic:100,status:"promoted"}' > "$state_dir/result.json"
echo "Blue retained for rollback. Release $release_id promoted to 100%."
