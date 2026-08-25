#!/usr/bin/env bash
set -euo pipefail

# Browser-to-DB E2E that intentionally uses deterministic local providers and
# development authentication. It proves the product wiring without claiming
# that Google Identity, Drive, Vertex AI, or Chirp 3 have been accepted.

# shellcheck source=./local-lib.sh
source "$(cd "$(dirname "$0")" && pwd)/local-lib.sh"

hanamaru_use_node22
hanamaru_require_command pnpm
hanamaru_require_command curl
hanamaru_require_command lsof
hanamaru_require_command jq

web_port="${OFFLINE_E2E_WEB_PORT:-3100}"
api_port="${OFFLINE_E2E_API_PORT:-3200}"
worker_port="${OFFLINE_E2E_WORKER_PORT:-3300}"
postgres_port="${OFFLINE_E2E_POSTGRES_PORT:-55433}"
for port in "$web_port" "$api_port" "$worker_port" "$postgres_port"; do
  hanamaru_port_in_use "$port" && hanamaru_fail "offline E2E port $port は使用中です。対象processを確認してください。"
done

pg_bin="$(hanamaru_pg_bin)"
runtime_dir="$(mktemp -d "${TMPDIR:-/tmp}/hanamaru-offline-e2e.XXXXXX")"
pg_data="$runtime_dir/postgres"
pg_socket="$runtime_dir/socket"
storage_dir="$runtime_dir/storage"
evidence_dir="$HANAMARU_REPO_DIR/.artifacts/offline-e2e/$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$pg_socket" "$storage_dir" "$evidence_dir/screenshots"
api_pid=""
worker_pid=""
web_pid=""

cleanup() {
  local result=$?
  for process_id in "$web_pid" "$api_pid" "$worker_pid"; do
    [[ "$process_id" =~ ^[0-9]+$ ]] && kill "$process_id" >/dev/null 2>&1 || true
  done
  for process_id in "$web_pid" "$api_pid" "$worker_pid"; do
    [[ "$process_id" =~ ^[0-9]+$ ]] && wait "$process_id" 2>/dev/null || true
  done
  if [[ -f "$pg_data/postmaster.pid" ]]; then
    "$pg_bin/pg_ctl" -D "$pg_data" -m fast stop >/dev/null 2>&1 || true
  fi
  [[ "$runtime_dir" == "${TMPDIR:-/tmp}"/hanamaru-offline-e2e.* ]] && rm -rf "$runtime_dir"
  if (( result != 0 )); then
    hanamaru_info "offline browser E2E FAILED。証跡: $evidence_dir"
  fi
  exit "$result"
}
trap cleanup EXIT

cd "$HANAMARU_REPO_DIR"
hanamaru_info "offline E2E用の一時PostgreSQL 16を起動します。"
"$pg_bin/initdb" -D "$pg_data" -A trust --encoding=UTF8 --locale=C >"$evidence_dir/postgres-init.log" 2>&1
"$pg_bin/pg_ctl" -D "$pg_data" -o "-p $postgres_port -k $pg_socket -c listen_addresses=127.0.0.1" -l "$evidence_dir/postgres.log" -w start >/dev/null
"$pg_bin/createdb" -h "$pg_socket" -p "$postgres_port" hanamaru_offline_e2e

export DATABASE_URL="postgresql://$(id -un)@127.0.0.1:$postgres_port/hanamaru_offline_e2e"
export DATABASE_SSL=disable
export NODE_ENV=test
export PROVIDER_MODE=local
export ALLOW_DEV_AUTH=true
export LOCAL_STORAGE_DIR="$storage_dir"

migration_count="$(find packages/database/migrations -maxdepth 1 -type f -name '[0-9][0-9][0-9][0-9]_*.sql' | wc -l | tr -d ' ')"
hanamaru_info "${migration_count} migrations、匿名seed、PoC 1,676件を一時DBへ適用します。"
pnpm build:packages >"$evidence_dir/build-packages.log" 2>&1
pnpm --filter @hanamaru/database migrate >"$evidence_dir/migrate.log" 2>&1
pnpm --filter @hanamaru/database seed:dev >"$evidence_dir/seed.log" 2>&1
pnpm --filter @hanamaru/database content:import >"$evidence_dir/content-import.log" 2>&1

hanamaru_info "API、Worker、Webを最新sourceからbuildします。"
pnpm --filter @hanamaru/api build >"$evidence_dir/api-build.log" 2>&1
pnpm --filter @hanamaru/worker build >"$evidence_dir/worker-build.log" 2>&1
NEXT_PUBLIC_API_BASE_URL="http://127.0.0.1:$api_port/api/v1" \
  NEXT_PUBLIC_OFFLINE_E2E_AUTH=enabled \
  NEXT_PUBLIC_PROTOTYPE_MODE=disabled \
  pnpm --filter @hanamaru/web build >"$evidence_dir/web-build.log" 2>&1

LOG_LEVEL=warn API_HOST=127.0.0.1 API_PORT="$api_port" API_RATE_LIMIT_MAX=5000 \
  CORS_ORIGINS="http://127.0.0.1:$web_port" \
  node apps/api/dist/server.js >"$evidence_dir/api.log" 2>&1 &
api_pid=$!
LOG_LEVEL=warn WORKER_HOST=127.0.0.1 WORKER_PORT="$worker_port" \
  node apps/worker/dist/server.js >"$evidence_dir/worker.log" 2>&1 &
worker_pid=$!
pushd "$HANAMARU_REPO_DIR/apps/web" >/dev/null
env -i PATH="$PATH" HOME="$HOME" NODE_ENV=production PORT="$web_port" HOSTNAME=127.0.0.1 \
  NEXT_PUBLIC_API_BASE_URL="http://127.0.0.1:$api_port/api/v1" \
  NEXT_PUBLIC_OFFLINE_E2E_AUTH=enabled \
  NEXT_PUBLIC_PROTOTYPE_MODE=disabled \
  node node_modules/next/dist/bin/next start -H 127.0.0.1 -p "$web_port" >"$evidence_dir/web.log" 2>&1 &
web_pid=$!
popd >/dev/null

hanamaru_wait_url "http://127.0.0.1:$api_port/health/ready" 120 || hanamaru_fail "offline API readinessに失敗しました。"
hanamaru_wait_url "http://127.0.0.1:$worker_port/health/ready" 120 || hanamaru_fail "offline Worker readinessに失敗しました。"
hanamaru_wait_url "http://127.0.0.1:$web_port/login" 120 || hanamaru_fail "offline Web readinessに失敗しました。"

hanamaru_info "全20画面、PDF→準備、音声→文字起こし→振り返り、RBAC、axe、正式60画像＋中核14画像を実走します。"
OFFLINE_STACK_E2E=1 \
  E2E_INCLUDE_WEBKIT=1 \
  E2E_REMOTE=1 \
  E2E_WEB_BASE_URL="http://127.0.0.1:$web_port" \
  E2E_API_BASE_URL="http://127.0.0.1:$api_port/api/v1" \
  OFFLINE_E2E_SCREENSHOT_DIR="$evidence_dir/screenshots" \
  pnpm --filter @hanamaru/web exec playwright test e2e/offline-stack.spec.ts --trace=retain-on-failure \
  2>&1 | tee "$evidence_dir/playwright.log"

screenshot_count="$(find "$evidence_dir/screenshots" -type f -name '*.png' | wc -l | tr -d ' ')"
[[ "$screenshot_count" == "74" ]] || hanamaru_fail "offline E2E screenshotは正式60枚＋中核画面360/430pxの14枚、計74枚必要です（actual: $screenshot_count）。"
jq -n \
  --arg gitSha "$(git rev-parse HEAD)" \
  --arg node "$(node --version)" \
  --arg completedAt "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --argjson screenshots "$screenshot_count" \
  '{status:"PASS",mode:"offline-deterministic-browser-to-db",gitSha:$gitSha,node:$node,screenshots:$screenshots,completedAt:$completedAt,googleAcceptance:false}' \
  >"$evidence_dir/result.json"

hanamaru_info "offline browser E2E PASS: $evidence_dir"
