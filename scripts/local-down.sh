#!/usr/bin/env bash
set -euo pipefail

# shellcheck source=./local-lib.sh
source "$(cd "$(dirname "$0")" && pwd)/local-lib.sh"

quiet=false
[[ "${1:-}" == "--quiet" ]] && quiet=true

stop_process() {
  local component="$1" pid_file="$HANAMARU_PID_DIR/$1.pid" pid index
  [[ -f "$pid_file" ]] || return 0
  pid="$(<"$pid_file")"
  if hanamaru_pid_alive "$pid"; then
    kill -TERM "$pid" >/dev/null 2>&1 || true
    for ((index=1; index<=50; index+=1)); do
      hanamaru_pid_alive "$pid" || break
      sleep 0.2
    done
    if hanamaru_pid_alive "$pid"; then
      kill -KILL "$pid" >/dev/null 2>&1 || true
    fi
    [[ "$quiet" == true ]] || hanamaru_info "$component: stopped"
  fi
  rm -f -- "$pid_file"
}

stop_process web
stop_process api
stop_process worker

pg_bin="$(hanamaru_pg_bin)"
if [[ -f "$HANAMARU_PG_DATA/PG_VERSION" ]] && "$pg_bin/pg_ctl" -D "$HANAMARU_PG_DATA" status >/dev/null 2>&1; then
  "$pg_bin/pg_ctl" -D "$HANAMARU_PG_DATA" -m fast -w stop >/dev/null
  [[ "$quiet" == true ]] || hanamaru_info "postgres: stopped (data preserved)"
fi
rm -f -- "$HANAMARU_RUNTIME_DIR/status.json"
[[ "$quiet" == true ]] || hanamaru_info "ローカル本番相当runtimeを停止しました。DBと検証logは保持しています。"
