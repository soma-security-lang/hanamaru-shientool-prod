#!/usr/bin/env bash
set -euo pipefail

# shellcheck source=./local-lib.sh
source "$(cd "$(dirname "$0")" && pwd)/local-lib.sh"

skip_build=false
open_browser=true
for argument in "$@"; do
  case "$argument" in
    --skip-build) skip_build=true ;;
    --no-open) open_browser=false ;;
    *) hanamaru_fail "unknown option: $argument" ;;
  esac
done

hanamaru_use_node22
hanamaru_load_env
"$HANAMARU_REPO_DIR/scripts/local-preflight.sh" --runtime

mkdir -p "$HANAMARU_PID_DIR" "$HANAMARU_LOG_DIR" "$HANAMARU_PG_SOCKET" "$HANAMARU_STORAGE_DIR"
chmod 700 "$HANAMARU_RUNTIME_DIR" "$HANAMARU_STORAGE_DIR"

web_port="${LOCAL_WEB_PORT:-3100}"
api_port="${LOCAL_API_PORT:-3200}"
worker_port="${LOCAL_WORKER_PORT:-3300}"
postgres_port="${LOCAL_POSTGRES_PORT:-54329}"
pg_bin="$(hanamaru_pg_bin)"
postgres_started=false
services_started=false

cleanup_failed_start() {
  local status=$?
  if (( status != 0 )); then
    hanamaru_info "起動に失敗しました。開始済みのローカルprocessを安全に停止します。"
    "$HANAMARU_REPO_DIR/scripts/local-down.sh" --quiet >/dev/null 2>&1 || true
  fi
  exit "$status"
}
trap cleanup_failed_start EXIT

cd "$HANAMARU_REPO_DIR"
if [[ "$skip_build" != true ]]; then
  hanamaru_info "lockfile通りに依存関係を確認します。"
  pnpm install --frozen-lockfile
  hanamaru_info "Web/API/Workerをproduction buildします。"
  env -u GOOGLE_DRIVE_CLIENT_SECRET -u TOKEN_ENCRYPTION_KEY_B64 -u GOOGLE_APPLICATION_CREDENTIALS \
  -u LIVE_E2E_GOOGLE_ID_TOKEN -u LIVE_E2E_ASSESSOR_GOOGLE_ID_TOKEN \
  -u LIVE_E2E_GOOGLE_DRIVE_REFRESH_TOKEN -u LIVE_E2E_GOOGLE_DRIVE_FILE_ID \
  -u LIVE_E2E_PDF_PATH -u LIVE_E2E_AUDIO_PATH \
  -u LOCAL_ALLOWED_GOOGLE_EMAIL -u LOCAL_ALLOWED_ASSESSOR_GOOGLE_EMAIL -u LOCAL_ALLOWED_SYSTEM_ADMIN_EMAIL \
  NEXT_PUBLIC_DATA_MODE=api \
  NEXT_PUBLIC_API_BASE_URL="http://127.0.0.1:$api_port/api/v1" \
  pnpm build
fi

if [[ ! -f "$HANAMARU_PG_DATA/PG_VERSION" ]]; then
  mkdir -p "$HANAMARU_PG_DATA"
  "$pg_bin/initdb" -D "$HANAMARU_PG_DATA" --auth-local=trust --auth-host=scram-sha-256 --encoding=UTF8 --locale=C >"$HANAMARU_LOG_DIR/postgres-init.log" 2>&1
fi

grep -Eq '^host[[:space:]]+all[[:space:]]+all[[:space:]]+127\.0\.0\.1/32[[:space:]]+scram-sha-256' "$HANAMARU_PG_DATA/pg_hba.conf" \
  || hanamaru_fail "local PostgreSQL host authがSCRAMではありません。既存runtime DBを退避して再初期化してください。"

"$pg_bin/pg_ctl" -D "$HANAMARU_PG_DATA" \
  -o "-p $postgres_port -k $HANAMARU_PG_SOCKET -c listen_addresses=127.0.0.1" \
  -l "$HANAMARU_LOG_DIR/postgres.log" -w start >/dev/null
postgres_started=true

database_name="hanamaru"
database_user="$(id -un)"
[[ "$database_user" =~ ^[A-Za-z0-9_.-]+$ ]] || hanamaru_fail "local database user nameを安全に扱えません。"
if ! "$pg_bin/psql" -h "$HANAMARU_PG_SOCKET" -p "$postgres_port" -d postgres -Atqc "SELECT 1 FROM pg_database WHERE datname='$database_name'" | grep -qx 1; then
  "$pg_bin/createdb" -h "$HANAMARU_PG_SOCKET" -p "$postgres_port" "$database_name"
fi
migrator_database_password="$(openssl rand -hex 32)"
HANAMARU_LOCAL_MIGRATOR_DB_ROLE="$database_user" HANAMARU_LOCAL_MIGRATOR_DB_PASSWORD="$migrator_database_password" \
"$pg_bin/psql" -h "$HANAMARU_PG_SOCKET" -p "$postgres_port" -d postgres -v ON_ERROR_STOP=1 \
  -f "$HANAMARU_REPO_DIR/scripts/local-db-migrator-role.sql" >"$HANAMARU_LOG_DIR/migrator-role.log" 2>&1
export DATABASE_URL="postgresql://$database_user:$migrator_database_password@127.0.0.1:$postgres_port/$database_name"
export DATABASE_SSL=disable
export LOCAL_STORAGE_DIR="${LOCAL_STORAGE_DIR:-$HANAMARU_STORAGE_DIR}"
api_database_password="$(openssl rand -hex 32)"
worker_database_password="$(openssl rand -hex 32)"

hanamaru_info "migration、匿名seed、PoC 1,676件content importを適用します。"
NODE_ENV=development DATABASE_CONTEXT_ROLE= pnpm --filter @hanamaru/database migrate >"$HANAMARU_LOG_DIR/migrate.log" 2>&1
HANAMARU_LOCAL_API_DB_PASSWORD="$api_database_password" HANAMARU_LOCAL_WORKER_DB_PASSWORD="$worker_database_password" \
"$pg_bin/psql" -h "$HANAMARU_PG_SOCKET" -p "$postgres_port" -d "$database_name" -v ON_ERROR_STOP=1 \
  -f "$HANAMARU_REPO_DIR/scripts/local-db-runtime-roles.sql" >"$HANAMARU_LOG_DIR/runtime-roles.log" 2>&1
NODE_ENV=development DATABASE_CONTEXT_ROLE= pnpm --filter @hanamaru/database seed:dev >"$HANAMARU_LOG_DIR/seed.log" 2>&1
NODE_ENV=development DATABASE_CONTEXT_ROLE= pnpm --filter @hanamaru/database content:import >"$HANAMARU_LOG_DIR/content-import.log" 2>&1

api_database_url="postgresql://hanamaru_local_api:$api_database_password@127.0.0.1:$postgres_port/$database_name"
worker_database_url="postgresql://hanamaru_local_worker:$worker_database_password@127.0.0.1:$postgres_port/$database_name"

export NODE_ENV=production
export PROVIDER_MODE=local-connected
export ALLOW_DEV_AUTH=false
export API_HOST=127.0.0.1
export API_PORT="$api_port"
export WORKER_HOST=127.0.0.1
export WORKER_PORT="$worker_port"
export CORS_ORIGINS="http://127.0.0.1:$web_port"
export NEXT_PUBLIC_DATA_MODE=api
export NEXT_PUBLIC_API_BASE_URL="http://127.0.0.1:$api_port/api/v1"

env -u LIVE_E2E_GOOGLE_ID_TOKEN -u LIVE_E2E_ASSESSOR_GOOGLE_ID_TOKEN \
  -u LIVE_E2E_GOOGLE_DRIVE_REFRESH_TOKEN -u LIVE_E2E_GOOGLE_DRIVE_FILE_ID \
  -u LIVE_E2E_PDF_PATH -u LIVE_E2E_AUDIO_PATH \
  -u LOCAL_ALLOWED_GOOGLE_EMAIL -u LOCAL_ALLOWED_ASSESSOR_GOOGLE_EMAIL -u LOCAL_ALLOWED_SYSTEM_ADMIN_EMAIL \
  NODE_ENV=production DATABASE_URL="$api_database_url" DATABASE_CONTEXT_ROLE=hanamaru_api DATABASE_SYSTEM_ROLE=hanamaru_api_system \
  nohup node apps/api/dist/server.js </dev/null >>"$HANAMARU_LOG_DIR/api.log" 2>&1 &
api_pid=$!
printf '%s\n' "$api_pid" > "$HANAMARU_PID_DIR/api.pid"

env -u LIVE_E2E_GOOGLE_ID_TOKEN -u LIVE_E2E_ASSESSOR_GOOGLE_ID_TOKEN \
  -u LIVE_E2E_GOOGLE_DRIVE_REFRESH_TOKEN -u LIVE_E2E_GOOGLE_DRIVE_FILE_ID \
  -u LIVE_E2E_PDF_PATH -u LIVE_E2E_AUDIO_PATH \
  -u LOCAL_ALLOWED_GOOGLE_EMAIL -u LOCAL_ALLOWED_ASSESSOR_GOOGLE_EMAIL -u LOCAL_ALLOWED_SYSTEM_ADMIN_EMAIL \
  NODE_ENV=production DATABASE_URL="$worker_database_url" DATABASE_CONTEXT_ROLE=hanamaru_worker DATABASE_SYSTEM_ROLE=hanamaru_worker_system \
  nohup node apps/worker/dist/server.js </dev/null >>"$HANAMARU_LOG_DIR/worker.log" 2>&1 &
worker_pid=$!
printf '%s\n' "$worker_pid" > "$HANAMARU_PID_DIR/worker.pid"

pushd "$HANAMARU_REPO_DIR/apps/web" >/dev/null
nohup env -i PATH="$PATH" HOME="$HOME" NODE_ENV=production PORT="$web_port" HOSTNAME=127.0.0.1 \
  NEXT_PUBLIC_DATA_MODE=api NEXT_PUBLIC_API_BASE_URL="http://127.0.0.1:$api_port/api/v1" \
  node node_modules/next/dist/bin/next start -H 127.0.0.1 -p "$web_port" </dev/null >>"$HANAMARU_LOG_DIR/web.log" 2>&1 &
web_pid=$!
popd >/dev/null
printf '%s\n' "$web_pid" > "$HANAMARU_PID_DIR/web.pid"
services_started=true

hanamaru_wait_url "http://127.0.0.1:$api_port/health/ready" 120 \
  || hanamaru_fail "API readinessに失敗しました。秘密を表示しないログ: $HANAMARU_LOG_DIR/api.log"
hanamaru_wait_url "http://127.0.0.1:$worker_port/health/ready" 120 \
  || hanamaru_fail "Worker readinessに失敗しました。秘密を表示しないログ: $HANAMARU_LOG_DIR/worker.log"
hanamaru_wait_url "http://127.0.0.1:$web_port/login" 120 \
  || hanamaru_fail "Web readinessに失敗しました。秘密を表示しないログ: $HANAMARU_LOG_DIR/web.log"

git_sha="$(git rev-parse HEAD)"
jq -n \
  --arg startedAt "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --arg gitSha "$git_sha" \
  --arg node "$(node --version)" \
  --arg pnpm "$(pnpm --version)" \
  --arg url "http://127.0.0.1:$web_port/login" \
  '{startedAt:$startedAt,gitSha:$gitSha,node:$node,pnpm:$pnpm,url:$url,mode:"production-build/local-connected"}' \
  > "$HANAMARU_RUNTIME_DIR/status.json"

trap - EXIT
hanamaru_info "READY: http://127.0.0.1:$web_port/login"
hanamaru_info "API/Worker/PostgreSQLはlocalhostだけで待受中です。停止: pnpm local:down"
if [[ "$open_browser" == true && "$(uname -s)" == "Darwin" ]]; then
  open "http://127.0.0.1:$web_port/login"
fi
