#!/usr/bin/env bash
set -euo pipefail

# shellcheck source=./local-lib.sh
source "$(cd "$(dirname "$0")" && pwd)/local-lib.sh"
hanamaru_use_node22

pg_bin="$(hanamaru_pg_bin)"
test_root="$(mktemp -d "${TMPDIR:-/tmp}/hanamaru-runtime-roles.XXXXXX")"
pg_data="$test_root/data"
pg_socket="$test_root/socket"
pg_port="55434"
api_database_password="$(openssl rand -hex 32)"
worker_database_password="$(openssl rand -hex 32)"
migrator_database_password="$(openssl rand -hex 32)"

cleanup() {
  if [[ -f "$pg_data/postmaster.pid" ]]; then
    "$pg_bin/pg_ctl" -D "$pg_data" -m fast stop >/dev/null 2>&1 || true
  fi
  case "$test_root" in
    "${TMPDIR:-/tmp}"/hanamaru-runtime-roles.*) rm -rf -- "$test_root" ;;
    *) hanamaru_info "unexpected temp path preserved: $test_root" ;;
  esac
}
trap cleanup EXIT

hanamaru_port_in_use "$pg_port" && hanamaru_fail "role test port $pg_port is in use"
mkdir -p "$pg_socket"
"$pg_bin/initdb" -D "$pg_data" --auth-local=trust --auth-host=scram-sha-256 --encoding=UTF8 --locale=C >/dev/null
"$pg_bin/pg_ctl" -D "$pg_data" -o "-p $pg_port -k $pg_socket -c listen_addresses=127.0.0.1" -w start >/dev/null
"$pg_bin/createdb" -h "$pg_socket" -p "$pg_port" hanamaru_roles_test
grep -Eq '^host[[:space:]]+all[[:space:]]+all[[:space:]]+127\.0\.0\.1/32[[:space:]]+scram-sha-256' "$pg_data/pg_hba.conf"

database_user="$(id -un)"
[[ "$database_user" =~ ^[A-Za-z0-9_.-]+$ ]] || hanamaru_fail "local database user name cannot be handled safely"
HANAMARU_LOCAL_MIGRATOR_DB_ROLE="$database_user" HANAMARU_LOCAL_MIGRATOR_DB_PASSWORD="$migrator_database_password" \
"$pg_bin/psql" -h "$pg_socket" -p "$pg_port" -d postgres -v ON_ERROR_STOP=1 \
  -f "$HANAMARU_REPO_DIR/scripts/local-db-migrator-role.sql" >/dev/null
export DATABASE_URL="postgresql://$database_user:$migrator_database_password@127.0.0.1:$pg_port/hanamaru_roles_test"
export NODE_ENV=test
export DATABASE_SSL=disable
cd "$HANAMARU_REPO_DIR"
pnpm --filter @hanamaru/database migrate >/dev/null
pnpm --filter @hanamaru/database seed:dev >/dev/null
pnpm --filter @hanamaru/database build >/dev/null
HANAMARU_LOCAL_API_DB_PASSWORD="$api_database_password" HANAMARU_LOCAL_WORKER_DB_PASSWORD="$worker_database_password" \
"$pg_bin/psql" -h "$pg_socket" -p "$pg_port" -d hanamaru_roles_test -v ON_ERROR_STOP=1 \
  -f "$HANAMARU_REPO_DIR/scripts/local-db-runtime-roles.sql" >/dev/null

role_flags="$($pg_bin/psql -h "$pg_socket" -p "$pg_port" -d hanamaru_roles_test -Atqc "SELECT rolname||':'||rolsuper||':'||rolinherit||':'||rolbypassrls FROM pg_roles WHERE rolname IN ('hanamaru_local_api','hanamaru_local_worker') ORDER BY rolname")"
grep -qx 'hanamaru_local_api:false:false:false' <<<"$role_flags"
grep -qx 'hanamaru_local_worker:false:false:false' <<<"$role_flags"
if PGPASSWORD="not-the-generated-password" "$pg_bin/psql" -h 127.0.0.1 -p "$pg_port" -U hanamaru_local_api -d hanamaru_roles_test -Atqc "SELECT 1" >/dev/null 2>&1; then
  hanamaru_fail "API login accepted an invalid SCRAM password"
fi

PGPASSWORD="$api_database_password" "$pg_bin/psql" -h 127.0.0.1 -p "$pg_port" -U hanamaru_local_api -d hanamaru_roles_test -v ON_ERROR_STOP=1 \
  -c "SET ROLE hanamaru_api; SELECT current_role; RESET ROLE; SET ROLE hanamaru_api_system; SELECT count(*) FROM organizations;" >/dev/null
if PGPASSWORD="$api_database_password" "$pg_bin/psql" -h 127.0.0.1 -p "$pg_port" -U hanamaru_local_api -d hanamaru_roles_test -v ON_ERROR_STOP=1 \
  -c "SET ROLE hanamaru_worker" >/dev/null 2>&1; then
  hanamaru_fail "API login can enter worker role"
fi

PGPASSWORD="$worker_database_password" "$pg_bin/psql" -h 127.0.0.1 -p "$pg_port" -U hanamaru_local_worker -d hanamaru_roles_test -v ON_ERROR_STOP=1 \
  -c "SET ROLE hanamaru_worker; SELECT current_role; RESET ROLE; SET ROLE hanamaru_worker_system; SELECT count(*) FROM jobs; SELECT count(*) FROM claim_outbox(1,1);" >/dev/null
if PGPASSWORD="$worker_database_password" "$pg_bin/psql" -h 127.0.0.1 -p "$pg_port" -U hanamaru_local_worker -d hanamaru_roles_test -v ON_ERROR_STOP=1 \
  -c "SET ROLE hanamaru_api" >/dev/null 2>&1; then
  hanamaru_fail "Worker login can enter API role"
fi

TEST_API_DATABASE_URL="postgresql://hanamaru_local_api:$api_database_password@127.0.0.1:$pg_port/hanamaru_roles_test" \
TEST_WORKER_DATABASE_URL="postgresql://hanamaru_local_worker:$worker_database_password@127.0.0.1:$pg_port/hanamaru_roles_test" \
NODE_ENV=production node "$HANAMARU_REPO_DIR/scripts/test-local-db-repository.mjs" >/dev/null

hanamaru_info "DB runtime role boundary PASS: SCRAM-authenticated separate NOINHERIT/NOBYPASSRLS API and Worker logins"
