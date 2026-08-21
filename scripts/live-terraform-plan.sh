#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

project_id="${GCP_PROJECT_ID:-monocle-503402}"
region="${GCP_REGION:-asia-northeast1}"
environment="${ENVIRONMENT:-pilot}"
state_bucket="${TF_STATE_BUCKET:-monocle-503402-tfstate}"
state_prefix="${TF_STATE_PREFIX:-hanamaru/pilot}"
plan_path="${TF_PLAN_PATH:-.artifacts/current-release/tfplan}"
alert_email="${ALERT_EMAIL:?ALERT_EMAIL must be provided by the release environment}"

: "${API_IMAGE:?API_IMAGE must be a digest-pinned Artifact Registry URI}"
: "${WORKER_IMAGE:?WORKER_IMAGE must be a digest-pinned Artifact Registry URI}"
: "${WEB_IMAGE:?WEB_IMAGE must be a digest-pinned Artifact Registry URI}"
for image in "$API_IMAGE" "$WORKER_IMAGE" "$WEB_IMAGE"; do
  [[ "$image" == *"@sha256:"* ]] || { echo "digest-pinned image required" >&2; exit 2; }
done

gcloud_cmd=(gcloud --configuration=default --project="$project_id")
export GOOGLE_OAUTH_ACCESS_TOKEN="$("${gcloud_cmd[@]}" auth print-access-token)"
terraform -chdir=infra/terraform init -reconfigure \
  -backend-config="bucket=$state_bucket" \
  -backend-config="prefix=$state_prefix" >/dev/null
state_json="$(terraform -chdir=infra/terraform show -json)"

resource_env(){
  local address="$1" name="$2" path="$3"
  jq -er --arg address "$address" --arg name "$name" ".values.root_module.resources[]|select(.address==\$address)|$path[]|select(.name==\$name)|.value" <<<"$state_json"
}
bootstrap_env(){ resource_env google_cloud_run_v2_job.database_bootstrap "$1" '.values.template[0].template[0].containers[0].env'; }
api_env(){ resource_env google_cloud_run_v2_service.api "$1" '.values.template[0].containers[0].env'; }
web_env(){ resource_env google_cloud_run_v2_service.web "$1" '.values.template[0].containers[0].env'; }

export TF_VAR_project_id="$project_id"
export TF_VAR_region="$region"
export TF_VAR_environment="$environment"
export TF_VAR_api_image="$API_IMAGE"
export TF_VAR_worker_image="$WORKER_IMAGE"
export TF_VAR_web_image="$WEB_IMAGE"
export TF_VAR_initial_organization_id="$(bootstrap_env BOOTSTRAP_ORGANIZATION_ID)"
export TF_VAR_content_import_owner_membership_id="$(bootstrap_env BOOTSTRAP_INITIAL_MANAGER_MEMBERSHIP_ID)"
export TF_VAR_initial_branch_id="$(bootstrap_env BOOTSTRAP_BRANCH_ID)"
export TF_VAR_initial_manager_user_id="$(bootstrap_env BOOTSTRAP_INITIAL_MANAGER_USER_ID)"
export TF_VAR_initial_organization_key="$(bootstrap_env BOOTSTRAP_ORGANIZATION_KEY)"
export TF_VAR_initial_organization_name="$(bootstrap_env BOOTSTRAP_ORGANIZATION_NAME)"
export TF_VAR_initial_branch_key="$(bootstrap_env BOOTSTRAP_BRANCH_KEY)"
export TF_VAR_initial_branch_name="$(bootstrap_env BOOTSTRAP_BRANCH_NAME)"
export TF_VAR_initial_manager_display_name="$(bootstrap_env BOOTSTRAP_INITIAL_MANAGER_DISPLAY_NAME)"
export TF_VAR_pilot_content_ai_enabled="$(bootstrap_env PILOT_CONTENT_AI_ENABLED)"
export TF_VAR_cors_origins="$(api_env CORS_ORIGINS)"
export TF_VAR_web_api_base_url="$(web_env NEXT_PUBLIC_API_BASE_URL)"
export TF_VAR_google_client_id="$(api_env GOOGLE_DRIVE_CLIENT_ID)"
export TF_VAR_google_cloud_project_number="$("${gcloud_cmd[@]}" projects describe "$project_id" --format='value(projectNumber)')"
export TF_VAR_google_picker_api_key="$("${gcloud_cmd[@]}" secrets versions access latest --secret=hanamaru-pilot-picker-api-key)"
export TF_VAR_identity_platform_api_key="$("${gcloud_cmd[@]}" secrets versions access latest --secret=hanamaru-pilot-identity-platform-api-key)"
export TF_VAR_identity_platform_auth_domain="$(web_env NEXT_PUBLIC_IDENTITY_PLATFORM_AUTH_DOMAIN)"
export TF_VAR_google_drive_redirect_uri="$(api_env GOOGLE_DRIVE_REDIRECT_URI)"
export TF_VAR_worker_task_url="$(api_env WORKER_TASK_URL)"
export TF_VAR_token_encryption_key_version="$(api_env TOKEN_ENCRYPTION_KEY_VERSION)"
export TF_VAR_vertex_model="$(api_env VERTEX_AI_MODEL)"
export TF_VAR_vertex_location="$(api_env VERTEX_LOCATION)"
export TF_VAR_speech_location="$(api_env SPEECH_LOCATION)"
export TF_VAR_speech_model="$(api_env SPEECH_MODEL)"
export TF_VAR_retention_days="$(jq -cn \
  --argjson pdf "$(bootstrap_env BOOTSTRAP_RETENTION_PDF_DAYS)" \
  --argjson audio "$(bootstrap_env BOOTSTRAP_RETENTION_AUDIO_DAYS)" \
  --argjson transcript "$(bootstrap_env BOOTSTRAP_RETENTION_TRANSCRIPT_DAYS)" \
  --argjson review "$(bootstrap_env BOOTSTRAP_RETENTION_REVIEW_DAYS)" \
  --argjson audit "$(bootstrap_env BOOTSTRAP_RETENTION_AUDIT_DAYS)" \
  '{pdf:$pdf,audio:$audio,video:365,transcript:$transcript,review:$review,audit:$audit}')"
export TF_VAR_allow_public_web=true
export TF_VAR_allow_public_stage_web=true
export TF_VAR_allow_public_api=true
export TF_VAR_schedulers_paused=false
export TF_VAR_deletion_protection=true
export TF_VAR_database_availability_type="${DATABASE_AVAILABILITY_TYPE:-ZONAL}"
export TF_VAR_database_tier="${DATABASE_TIER:-db-custom-1-3840}"
export TF_VAR_database_read_replica_enabled="${DATABASE_READ_REPLICA_ENABLED:-true}"
export TF_VAR_database_read_replica_tier="${DATABASE_READ_REPLICA_TIER:-db-custom-1-3840}"
export TF_VAR_database_read_replica_availability_type="${DATABASE_READ_REPLICA_AVAILABILITY_TYPE:-REGIONAL}"
export TF_VAR_database_ssl_mode="${DATABASE_SSL_MODE:-ENCRYPTED_ONLY}"
export TF_VAR_database_settings_deletion_protection_enabled="${DATABASE_SETTINGS_DELETION_PROTECTION_ENABLED:-true}"
export TF_VAR_database_maintenance_window_enabled="${DATABASE_MAINTENANCE_WINDOW_ENABLED:-true}"
export TF_VAR_monthly_budget_jpy="${MONTHLY_BUDGET_JPY:-30000}"
export TF_VAR_billing_account_id="$("${gcloud_cmd[@]}" billing projects describe "$project_id" --format='value(billingAccountName.basename())')"
export TF_VAR_alert_notification_emails="$(jq -cn --arg email "$alert_email" '[$email]')"

mkdir -p "$(dirname "$plan_path")"
chmod 700 "$(dirname "$plan_path")"
set +e
terraform -chdir=infra/terraform plan -detailed-exitcode -out="$(cd "$(dirname "$plan_path")" && pwd)/$(basename "$plan_path")"
exit_code=$?
set -e
if [[ $exit_code -eq 0 ]]; then
  echo "No infrastructure changes."
elif [[ $exit_code -eq 2 ]]; then
  echo "Plan created: $plan_path"
else
  exit "$exit_code"
fi
