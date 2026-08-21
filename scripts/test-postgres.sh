#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=./local-lib.sh
source "$repo_dir/scripts/local-lib.sh"
hanamaru_use_node22
pg_bin="$(hanamaru_pg_bin)"
pg_tmp="$(mktemp -d "${TMPDIR:-/tmp}/hanamaru-pg.XXXXXX")"
pg_data="$pg_tmp/data"
pg_socket="$pg_tmp/socket"
pg_port="${TEST_POSTGRES_PORT:-55432}"
api_pid=""
worker_pid=""

cleanup() {
  if [[ -n "$api_pid" ]]; then kill "$api_pid" >/dev/null 2>&1 || true; wait "$api_pid" 2>/dev/null || true; fi
  if [[ -n "$worker_pid" ]]; then kill "$worker_pid" >/dev/null 2>&1 || true; wait "$worker_pid" 2>/dev/null || true; fi
  if [[ -f "$pg_data/postmaster.pid" ]]; then "$pg_bin/pg_ctl" -D "$pg_data" -m fast stop >/dev/null 2>&1 || true; fi
  if [[ "$pg_tmp" == "${TMPDIR:-/tmp}"/hanamaru-pg.* ]]; then rm -rf "$pg_tmp"; fi
}
trap cleanup EXIT

if lsof -nP -iTCP:"$pg_port" -sTCP:LISTEN >/dev/null 2>&1; then echo "Port $pg_port is already in use" >&2; exit 1; fi
mkdir -p "$pg_socket"
"$pg_bin/initdb" -D "$pg_data" -A trust --encoding=UTF8 --locale=C >/dev/null
"$pg_bin/pg_ctl" -D "$pg_data" -o "-p $pg_port -k $pg_socket -c listen_addresses=127.0.0.1" -w start >/dev/null
"$pg_bin/createdb" -h "$pg_socket" -p "$pg_port" hanamaru_test
export DATABASE_URL="postgresql://$(id -un)@127.0.0.1:$pg_port/hanamaru_test"
export NODE_ENV=test
export PROVIDER_MODE=local
export ALLOW_DEV_AUTH=true

cd "$repo_dir"
pnpm build:packages
pnpm --filter @hanamaru/database migrate
pnpm --filter @hanamaru/database seed:dev
pnpm --filter @hanamaru/database content:import
pnpm --filter @hanamaru/database test:integration
pnpm --filter @hanamaru/worker test
pnpm --filter @hanamaru/api test
pnpm --filter @hanamaru/api build
pnpm --filter @hanamaru/worker build

LOG_LEVEL=silent API_PORT=53200 node apps/api/dist/server.js >"$pg_tmp/api.log" 2>&1 &
api_pid=$!
LOG_LEVEL=silent WORKER_PORT=53300 node apps/worker/dist/server.js >"$pg_tmp/worker.log" 2>&1 &
worker_pid=$!
for _ in {1..40}; do
  if curl --fail --silent http://127.0.0.1:53200/health/ready >/dev/null && curl --fail --silent http://127.0.0.1:53300/health/ready >/dev/null; then break; fi
  sleep 0.25
done
curl --fail --silent http://127.0.0.1:53200/health/ready | grep -q '"database":"ok"'
curl --fail --silent -H 'x-dev-role: assessor' http://127.0.0.1:53200/api/v1/me | grep -q '"displayName":"佐藤 花子"'
curl --fail --silent http://127.0.0.1:53300/health/ready | grep -q '"database":"ok"'
