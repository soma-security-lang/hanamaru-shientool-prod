#!/usr/bin/env bash
set -euo pipefail
repo_dir="$(cd "$(dirname "$0")/.." && pwd)"
if [[ "${ALIGNMENT_REAL_SSO_TESTS:-false}" == "true" ]]; then
  node -e 'const s=require("node:fs").statfsSync(process.cwd());if(s.bavail*s.bsize<5*1024**3)throw new Error("LOCAL_TEST_REQUIRES_5_GIB_FREE")'
fi
source "$repo_dir/scripts/local-lib.sh"
hanamaru_use_node22
pg_bin="$(hanamaru_pg_bin)"
alignment_tmp="$(mktemp -d "${TMPDIR:-/tmp}/hanamaru-alignment.XXXXXX")"
port=55646
cleanup() {
  if [[ -f "$alignment_tmp/data/postmaster.pid" ]]; then "$pg_bin/pg_ctl" -D "$alignment_tmp/data" -m fast stop >/dev/null; fi
  if [[ "$alignment_tmp" == "${TMPDIR:-/tmp}"/hanamaru-alignment.* ]]; then rm -rf "$alignment_tmp"; fi
}
trap cleanup EXIT
if lsof -nP -iTCP:$port -sTCP:LISTEN >/dev/null 2>&1; then echo "Isolated alignment port is busy" >&2; exit 1; fi
mkdir "$alignment_tmp/socket"
"$pg_bin/initdb" -D "$alignment_tmp/data" -A trust --encoding=UTF8 --locale=C >/dev/null
"$pg_bin/pg_ctl" -D "$alignment_tmp/data" -o "-p $port -k $alignment_tmp/socket -c listen_addresses=127.0.0.1" -w start >/dev/null
"$pg_bin/createdb" -h "$alignment_tmp/socket" -p "$port" hanamaru_alignment_test
export DATABASE_URL="postgresql://$(id -un)@127.0.0.1:$port/hanamaru_alignment_test"
export ALIGNMENT_DATABASE_URL="$DATABASE_URL"
export NODE_ENV=test PROVIDER_MODE=local ALLOW_DEV_AUTH=true
export LOCAL_STORAGE_DIR="$alignment_tmp/objects"
cd "$repo_dir"
pnpm build:packages
pnpm --filter @hanamaru/api build
pnpm --filter @hanamaru/alignment build
pnpm --filter @hanamaru/database migrate
pnpm --filter @hanamaru/database seed:dev
"$pg_bin/psql" "$DATABASE_URL" -v ON_ERROR_STOP=1 -f packages/alignment/local-schema.sql
pnpm --filter @hanamaru/alignment test
pnpm --filter @hanamaru/web exec vitest run src/server/native-api.integration.test.ts src/server/server-sso.integration.test.ts --no-file-parallelism
if [[ "${ALIGNMENT_FULL_CONTRACTS:-false}" == "true" ]]; then
  pnpm --filter @hanamaru/database content:import
  pnpm --filter @hanamaru/worker exec vitest run src/alignment.integration.test.ts
  HANAMARU_PRISMA_WORKER_TEST=true pnpm --filter @hanamaru/worker exec vitest run --config ../../packages/alignment/vitest.worker.config.ts
  HANAMARU_NATIVE_CONTRACT_TEST=true pnpm --filter @hanamaru/api exec vitest run --config vitest.native.config.ts
fi
if [[ "${ALIGNMENT_BROWSER_TESTS:-false}" == "true" || "${ALIGNMENT_REAL_SSO_TESTS:-false}" == "true" ]]; then
  export ALIGNMENT_SESSION_KEY="$(node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("hex"))')"
  export SSO_INTERNAL_SECRET="$(node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("hex"))')"
  export TOKEN_ENCRYPTION_KEY_B64="$(node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("base64"))')"
  export NODE_ENV=production ALLOW_DEV_AUTH=false HANAMARU_SESSION_STORE=postgres
  export HANAMARU_ALIGNMENT_LOW_DISK=true
  pnpm --filter @hanamaru/web build
  if [[ "${ALIGNMENT_BROWSER_TESTS:-false}" == "true" ]]; then
    pnpm --filter @hanamaru/web exec playwright test --config playwright.session.config.ts
    pnpm --filter @hanamaru/web exec playwright test --config playwright.persistent.config.ts
  fi
  if [[ "${ALIGNMENT_REAL_SSO_TESTS:-false}" == "true" ]]; then
    : "${SOUMU_LOCAL_REPO:?SOUMU_LOCAL_REPO must select the dedicated Soumu worktree}"
    for test_port in 3381 3382 3383 3386; do
      if lsof -nP -iTCP:$test_port -sTCP:LISTEN >/dev/null 2>&1; then echo 'Real local SSO test port is busy' >&2; exit 1; fi
    done
    "$pg_bin/createdb" -h "$alignment_tmp/socket" -p "$port" soumu_alignment_test
    export SOUMU_ALIGNMENT_DATABASE_URL="postgresql://$(id -un)@127.0.0.1:$port/soumu_alignment_test"
    "$pg_bin/psql" "$SOUMU_ALIGNMENT_DATABASE_URL" -v ON_ERROR_STOP=1 -c 'CREATE ROLE cloudsqlsuperuser NOLOGIN; CREATE ROLE soumu_bootstrap LOGIN CREATEROLE CREATEDB; GRANT cloudsqlsuperuser TO soumu_bootstrap; ALTER DATABASE soumu_alignment_test OWNER TO cloudsqlsuperuser; ALTER SCHEMA public OWNER TO cloudsqlsuperuser;' >/dev/null
    sed 's/database soumu/database soumu_alignment_test/g' "$SOUMU_LOCAL_REPO/db/bootstrap/roles.sql" |
      "$pg_bin/psql" "postgresql://soumu_bootstrap@127.0.0.1:$port/soumu_alignment_test" -v ON_ERROR_STOP=1 >/dev/null
    (
      cd "$SOUMU_LOCAL_REPO"
      DATABASE_URL="$SOUMU_ALIGNMENT_DATABASE_URL" pnpm --filter @soumu/jobs exec tsx ../../scripts/prepare-prisma-fixture.mts
    )
    export SYNTHETIC_SSO_PASSWORD="$(node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("hex"))')"
    pnpm --filter @hanamaru/web exec playwright test --config playwright.real-sso.config.ts
  fi
fi
