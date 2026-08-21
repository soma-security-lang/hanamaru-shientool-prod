#!/usr/bin/env bash
set -euo pipefail

# shellcheck source=./local-lib.sh
source "$(cd "$(dirname "$0")" && pwd)/local-lib.sh"

hanamaru_use_node22
hanamaru_load_env

evidence_dir="$HANAMARU_REPO_DIR/.artifacts/local-verify/$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$evidence_dir/screenshots"
results_file="$evidence_dir/results.tsv"
printf 'stage\tstatus\tstarted_at\tfinished_at\n' > "$results_file"
git_dirty=false
[[ -n "$(git -C "$HANAMARU_REPO_DIR" status --porcelain)" ]] && git_dirty=true
jq -n \
  --arg startedAt "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --arg gitSha "$(git -C "$HANAMARU_REPO_DIR" rev-parse HEAD)" \
  --argjson gitDirty "$git_dirty" \
  --arg node "$(node --version)" \
  --arg pnpm "$(pnpm --version)" \
  '{startedAt:$startedAt,gitSha:$gitSha,gitDirty:$gitDirty,node:$node,pnpm:$pnpm,mode:"production-build/local-connected"}' \
  > "$evidence_dir/run-metadata.json"
runtime_started=false

cleanup() {
  local status=$?
  if [[ "$runtime_started" == true ]]; then
    "$HANAMARU_REPO_DIR/scripts/local-down.sh" --quiet >/dev/null 2>&1 || true
  fi
  if (( status != 0 )); then
    hanamaru_info "verification FAILED。実行済みstageと非秘密log: $evidence_dir"
  fi
  exit "$status"
}
trap cleanup EXIT

run_stage() {
  local name="$1" started finished
  shift
  started="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  hanamaru_info "verify: $name"
  # Stream each stage to the operator while retaining the exact same output as
  # evidence. `pipefail` keeps the stage result authoritative rather than
  # accidentally accepting a successful `tee` after the command failed.
  if "$@" 2>&1 | tee "$evidence_dir/$name.log"; then
    finished="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    printf '%s\tPASS\t%s\t%s\n' "$name" "$started" "$finished" >> "$results_file"
  else
    finished="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    printf '%s\tFAIL\t%s\t%s\n' "$name" "$started" "$finished" >> "$results_file"
    hanamaru_fail "$name に失敗しました。log: $evidence_dir/$name.log"
  fi
}

cd "$HANAMARU_REPO_DIR"
run_stage preflight "$HANAMARU_REPO_DIR/scripts/local-preflight.sh"
run_stage install pnpm install --frozen-lockfile
run_stage lint pnpm lint
run_stage typecheck pnpm typecheck
run_stage unit pnpm test
run_stage database_integration pnpm test:db
run_stage database_runtime_roles pnpm test:db:roles
run_stage production_build pnpm build
run_stage terraform_validate pnpm infra:validate
run_stage secret_pii_scan pnpm test:security
run_stage documentation_drift pnpm docs:validate

run_stage local_up "$HANAMARU_REPO_DIR/scripts/local-up.sh" --skip-build --no-open
runtime_started=true
run_stage live_identity_session pnpm local:e2e:auth
run_stage google_live_e2e pnpm local:e2e:google

export REAL_STACK_E2E=1
export HITL_SCREENSHOT_DIR="$evidence_dir/screenshots"
export E2E_AUDIO_FIXTURE_PATH="$LIVE_E2E_AUDIO_PATH"
run_stage playwright pnpm --filter @hanamaru/web exec playwright test --trace=off

screenshot_count="$(find "$evidence_dir/screenshots" -type f -name '*.png' 2>/dev/null | wc -l | tr -d ' ')"
if (( screenshot_count < 60 )); then
  hanamaru_fail "HITL screenshotは60枚以上必要です（actual: $screenshot_count）。"
fi
printf '%s\n' "$screenshot_count" > "$evidence_dir/screenshot-count.txt"

run_stage final_health curl --fail --silent --show-error "http://127.0.0.1:${LOCAL_API_PORT:-3200}/health/ready"
run_stage final_worker_health curl --fail --silent --show-error "http://127.0.0.1:${LOCAL_WORKER_PORT:-3300}/health/ready"
run_stage final_web_health curl --fail --silent --show-error "http://127.0.0.1:${LOCAL_WEB_PORT:-3100}/login"

runtime_started=false
"$HANAMARU_REPO_DIR/scripts/local-down.sh" --quiet
trap - EXIT
hanamaru_info "verification PASS: $evidence_dir"
