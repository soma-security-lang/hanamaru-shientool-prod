#!/usr/bin/env bash
set -euo pipefail

# shellcheck source=./local-lib.sh
source "$(cd "$(dirname "$0")" && pwd)/local-lib.sh"

allow_running=false
scope="acceptance"
for argument in "$@"; do
  case "$argument" in
    --allow-running) allow_running=true ;;
    --runtime) scope="runtime" ;;
    *) hanamaru_fail "unknown option: $argument" ;;
  esac
done

hanamaru_use_node22
hanamaru_load_env

for command_name in pnpm brew ffprobe gcloud curl jq openssl lsof; do
  hanamaru_require_command "$command_name"
done
[[ "$scope" != "acceptance" ]] || hanamaru_require_command terraform

node_major="$(node -p 'process.versions.node.split(".")[0]')"
pnpm_major="$(pnpm --version | cut -d. -f1)"
[[ "$node_major" == "22" ]] || hanamaru_fail "Node.js 22.x が必要です。"
[[ "$pnpm_major" == "11" ]] || hanamaru_fail "pnpm 11.x が必要です。"

pg_bin="$(hanamaru_pg_bin)"
[[ "$($pg_bin/postgres --version)" == *" 16."* ]] || hanamaru_fail "PostgreSQL 16.x が必要です。"
ffprobe -version 2>/dev/null | head -1 | grep -q '^ffprobe version ' || hanamaru_fail "ffprobeを実行できません。"

hanamaru_require_env \
  GCP_PROJECT_ID SPEECH_LOCATION SPEECH_MODEL STT_INPUT_BUCKET \
  VERTEX_LOCATION VERTEX_AI_MODEL \
  GOOGLE_DRIVE_CLIENT_ID GOOGLE_DRIVE_CLIENT_SECRET GOOGLE_DRIVE_REDIRECT_URI \
  IDENTITY_PLATFORM_PROJECT_ID NEXT_PUBLIC_IDENTITY_PLATFORM_API_KEY \
  NEXT_PUBLIC_IDENTITY_PLATFORM_AUTH_DOMAIN NEXT_PUBLIC_IDENTITY_PLATFORM_PROJECT_ID \
  NEXT_PUBLIC_GOOGLE_PICKER_API_KEY NEXT_PUBLIC_GOOGLE_CLOUD_PROJECT_NUMBER \
  LOCAL_ALLOWED_GOOGLE_EMAIL LOCAL_ALLOWED_ASSESSOR_GOOGLE_EMAIL \
  TOKEN_ENCRYPTION_KEY_B64 TOKEN_ENCRYPTION_KEY_VERSION

if [[ "$scope" == "acceptance" ]]; then
  hanamaru_require_env \
    LIVE_E2E_DATA_CLASSIFICATION LIVE_E2E_PDF_PATH LIVE_E2E_AUDIO_PATH \
    LIVE_E2E_GOOGLE_DRIVE_FILE_ID LIVE_E2E_GOOGLE_DRIVE_REFRESH_TOKEN \
    LIVE_E2E_GOOGLE_ID_TOKEN LIVE_E2E_ASSESSOR_GOOGLE_ID_TOKEN
fi

[[ "${PROVIDER_MODE:-}" == "local-connected" ]] || hanamaru_fail "PROVIDER_MODE=local-connected が必要です。"
[[ "${ALLOW_DEV_AUTH:-}" == "false" ]] || hanamaru_fail "ALLOW_DEV_AUTH=false が必要です。"
[[ "${NEXT_PUBLIC_DATA_MODE:-}" == "api" ]] || hanamaru_fail "NEXT_PUBLIC_DATA_MODE=api が必要です。"
[[ "$SPEECH_MODEL" == "chirp_3" ]] || hanamaru_fail "SPEECH_MODEL=chirp_3 が必要です。"
[[ "$SPEECH_LOCATION" == "asia-northeast1" || "$SPEECH_LOCATION" == "us" ]] || hanamaru_fail "SPEECH_LOCATIONはasia-northeast1またはusです。"
if [[ "$scope" == "acceptance" ]]; then
  [[ "$LIVE_E2E_DATA_CLASSIFICATION" == "anonymous-approved" ]] || hanamaru_fail "LIVE_E2E_DATA_CLASSIFICATION=anonymous-approved が必要です。実顧客データは使用できません。"
  [[ -r "$LIVE_E2E_PDF_PATH" ]] || hanamaru_fail "承認済み匿名E2E PDFを読み取れません。"
  [[ -r "$LIVE_E2E_AUDIO_PATH" ]] || hanamaru_fail "承認済み匿名E2E音声を読み取れません。"
  node -e 'const pairs=[["LIVE_E2E_GOOGLE_ID_TOKEN","LOCAL_ALLOWED_GOOGLE_EMAIL"],["LIVE_E2E_ASSESSOR_GOOGLE_ID_TOKEN","LOCAL_ALLOWED_ASSESSOR_GOOGLE_EMAIL"]];const emails=[];for(const [tokenName,emailName] of pairs){const token=process.env[tokenName]??"";const parts=token.split(".");if(parts.length!==3)process.exit(1);let payload;try{payload=JSON.parse(Buffer.from(parts[1],"base64url").toString("utf8"));}catch{process.exit(1)}const email=String(payload.email??"").toLowerCase();const expected=String(process.env[emailName]??"").toLowerCase();const exp=Number(payload.exp??0);if(email!==expected||payload.email_verified!==true||exp<=Math.floor(Date.now()/1000)+1800)process.exit(1);emails.push(email)}if(new Set(emails).size!==emails.length)process.exit(1)' \
    || hanamaru_fail "manager/assessor受入アカウントそれぞれの有効なGoogle ID token（残り30分超）が必要です。同一アカウントは使えません。署名検証はlive APIが実施します。"
fi

[[ "$IDENTITY_PLATFORM_PROJECT_ID" == "$GCP_PROJECT_ID" ]] || hanamaru_fail "APIのIdentity Platform project IDがGCP projectと一致していません。"
[[ "$NEXT_PUBLIC_IDENTITY_PLATFORM_PROJECT_ID" == "$GCP_PROJECT_ID" ]] || hanamaru_fail "WebのIdentity Platform project IDがGCP projectと一致していません。"
[[ "$NEXT_PUBLIC_IDENTITY_PLATFORM_API_KEY" =~ ^AIza[0-9A-Za-z_-]{35}$ ]] || hanamaru_fail "Identity Platform用のBrowser API key形式を確認してください。"
[[ "$NEXT_PUBLIC_IDENTITY_PLATFORM_AUTH_DOMAIN" =~ ^[a-z0-9.-]+$ ]] || hanamaru_fail "Identity Platform auth domainを設定してください。"
[[ "$GOOGLE_DRIVE_CLIENT_ID" == *.apps.googleusercontent.com ]] || hanamaru_fail "Google Drive code flowへWeb client IDを設定してください。"
[[ "$NEXT_PUBLIC_GOOGLE_PICKER_API_KEY" =~ ^AIza[0-9A-Za-z_-]{35}$ ]] || hanamaru_fail "Google Picker用のBrowser API key形式を確認してください。"
[[ "$NEXT_PUBLIC_GOOGLE_CLOUD_PROJECT_NUMBER" =~ ^[0-9]{6,20}$ ]] || hanamaru_fail "Google Picker用のnumeric project numberを設定してください。"
[[ "$LOCAL_ALLOWED_GOOGLE_EMAIL" =~ ^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$ ]] || hanamaru_fail "LOCAL_ALLOWED_GOOGLE_EMAILへローカル受入確認に使うGoogleアカウントを設定してください。"
[[ "$LOCAL_ALLOWED_ASSESSOR_GOOGLE_EMAIL" =~ ^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$ ]] || hanamaru_fail "LOCAL_ALLOWED_ASSESSOR_GOOGLE_EMAILへRBAC受入確認に使う別のGoogleアカウントを設定してください。"
manager_email_normalized="$(printf '%s' "$LOCAL_ALLOWED_GOOGLE_EMAIL" | tr '[:upper:]' '[:lower:]')"
assessor_email_normalized="$(printf '%s' "$LOCAL_ALLOWED_ASSESSOR_GOOGLE_EMAIL" | tr '[:upper:]' '[:lower:]')"
[[ "$manager_email_normalized" != "$assessor_email_normalized" ]] || hanamaru_fail "managerとassessorの受入Googleアカウントは分離してください。"
[[ "$GOOGLE_DRIVE_REDIRECT_URI" == "http://127.0.0.1:${LOCAL_WEB_PORT:-3100}" ]] || hanamaru_fail "GIS popup modeのGOOGLE_DRIVE_REDIRECT_URIはローカルWeb originと一致させてください。"

node -e 'const value=process.env.TOKEN_ENCRYPTION_KEY_B64??""; const key=Buffer.from(value,"base64"); if(key.length!==32)process.exit(1)' \
  || hanamaru_fail "TOKEN_ENCRYPTION_KEY_B64は32-byte keyのbase64である必要があります。"

if [[ "$allow_running" != true ]]; then
  for port in "${LOCAL_WEB_PORT:-3100}" "${LOCAL_API_PORT:-3200}" "${LOCAL_WORKER_PORT:-3300}" "${LOCAL_POSTGRES_PORT:-54329}"; do
    hanamaru_port_in_use "$port" && hanamaru_fail "port $port は使用中です。既存プロセスを確認してから再実行してください。"
  done
fi

node "$HANAMARU_REPO_DIR/scripts/local-gcp-preflight.mjs" \
  || hanamaru_fail "ADCでproject/API/STT bucketを確認できません。read権限・API有効化・bucket IAMを確認してください。preflightはGCPを変更しません。"
oidc_jwks_url="${OIDC_JWKS_URL:-https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com}"
curl --fail --silent --show-error --max-time 10 "$oidc_jwks_url" >/dev/null \
  || hanamaru_fail "OIDC JWKS endpointへ接続できません。"
for browser_library_url in "https://accounts.google.com/gsi/client" "https://apis.google.com/js/api.js"; do
  curl --fail --silent --show-error --max-time 10 "$browser_library_url" >/dev/null \
    || hanamaru_fail "Google Identity/Picker browser libraryへ接続できません。"
done

if [[ "$scope" == "acceptance" ]]; then
  hanamaru_info "acceptance preflight PASS: Node 22 / pnpm 11 / PostgreSQL 16 / ffprobe / ADC / required APIs / auth settings / anonymous E2E inputs"
else
  hanamaru_info "runtime preflight PASS: Node 22 / pnpm 11 / PostgreSQL 16 / ffprobe / ADC / required APIs / auth settings"
fi
